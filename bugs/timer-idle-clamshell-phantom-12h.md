# 12-hour phantom on a lid-closed-but-awake (clamshell) / walked-away Mac

**Status:** ✅ FIXED (2026-07-23)
**Severity:** P0 — over-billed a real user; company blamed the employee
**Scope:** Desktop `idle-detector.js`, `power-manager.js`, `index.js`

## Symptom

A Mac started a timer at ~2 AM and had its lid closed with no activity. The next
day it showed **12 hours** of tracked time. The idle auto-stop never fired and no
sleep-gap correction ran, so the entry counted straight through from `started_at`.

## The two failure modes (both closed)

Per the agreed policy (owner, 2026-07-16): short sleeps keep running; any
no-activity gap **longer than the idle threshold** hard-stops the timer,
**back-dated to the last real activity** — sleep/idle time is never credited.
`shouldAutoStopOnSuspend` stays `false` (no blanket stop-on-suspend); the
correction happens by gap evaluation, not by stopping on the suspend event.

### Mode 1 — true sleep, resume path (already handled; verified)

On resume, `autoStopAfterSleepGap(sleepSec, suspendedAtMs)` closes the entry when
the sleep gap exceeds `getSleepGapThresholdSec()` (= `config.idle_timeout`),
back-dated to `loadLastActiveAt()`. The anchor is stamped at the suspend instant
by `onSuspendCleanup` (`index.js` — `touchLastActiveAt(...)` in the
`else if (isTimerRunning)` branch). Verified correct and covered by tests. No
change needed here beyond confirming it fires.

### Mode 2 — never-sleeps / clamshell / sat-idle (the actual bug)

When the lid is closed but the machine stays **awake** (on charger or with an
external display), or the user simply walks away, macOS emits **no `suspend`
event**, so `autoStopAfterSleepGap` never runs. Nothing else guaranteed a stop:

- **Root cause A (idle detector):** With `idle_alert_auto_stop_min = 0`
  (interactive auto-stop disabled), the idle detector transitioned to `ALERTING`
  but started **no check interval** (`if (this.alertAutoStopSec > 0)`), so the
  alert sat open forever and the timer never stopped. Even with a non-zero value,
  nothing fired if the alert window couldn't be shown/answered.
- **Root cause B (no independent backstop):** If idle detection was disabled
  entirely (`idle_detection = false`) or the detector was wedged, there was **no**
  other mechanism watching an awake-but-idle machine. Combined with no `suspend`
  event, the entry accrued the full 12 h.

## Fix — defense-in-depth (two independent layers, either alone prevents the phantom)

### Layer 1 — idle detector always terminates `ALERTING` (`idle-detector.js`)

- The auto-stop/hard-cap check interval now **always** runs in `ALERTING`
  (`_check()`, `setAlertState()`, and the `updateConfig` ALERTING branch), not
  only when interactive auto-stop is enabled.
- `_checkAutoStop()` fires on **either** the interactive countdown
  (`alertDurationSec >= alertAutoStopSec`, when configured) **or** an absolute
  hard-stop grace (`alertDurationSec >= hardStopGraceSec`). So `ALERTING`
  deterministically terminates even when `idle_alert_auto_stop_min = 0`.
- The stop callback (`onAutoStop → handleIdleAction("stop")`) back-dates the entry
  to `idleStartedAt` (true last activity), so idle is never credited.

**Decoupling (per coordinator):** `hardStopGraceSec` is a **fixed** bound
(`DEFAULT_HARD_STOP_GRACE_SEC = 10 min`), **not** derived from `alertAutoStopSec`.
`alertAutoStopSec`/`MAX_AUTO_STOP_MIN` (≤ 4 h) remain the ceiling for the
user-facing interactive countdown only. Previously the hard cap was
`max(alertAutoStopSec, grace)`, so an org near the 240-min cap could still sit
open ~4.5 h — that scaling is removed. Worst-case idle exposure is now
`idle_timeout (≤30m) + 10m` regardless of org config.

**Basis = `alertShownAt`, not `idleStartedAt`:** the hard-stop grace measures the
real time the alert has sat **unanswered** (from when it appeared), so a preserved
idle alert re-shown after a long sleep still gets the grace window from the moment
it re-appears instead of hard-stopping on the first tick. Billing is bounded
either way because the stop back-dates to `idleStartedAt`.

### Layer 2 — always-on idle watchdog (`index.js` + `power-manager.js`)

An interval (`startIdleWatchdog`, 30 s cadence) that runs whenever the timer is
running and is **independent** of the idle-detection feature toggle and of the
idle detector's state. Each tick reads the OS idle counter
(`powerMonitor.getSystemIdleTime()`) and, via the pure
`PowerManager.evaluateIdleHardStop(...)`, hard-stops the timer — back-dated to the
true last input (`now - systemIdleSec`, clamped to an earlier `lastActiveAt` if
known) — once idle exceeds a **fixed, bounded** cap
(`idle_timeout + 10m + 2m margin`, also decoupled from `alertAutoStopSec`). The
+2m margin means the idle detector's own hard cap wins in the normal case; this
layer only fires when idle detection is off or the detector never ran. The stop
goes through the shared `autoStopTimerForPowerEvent → stopTimer({ endedAtMs })`
path so the server gets the correct `ended_at` and reconcile can't resurrect it.

Lifecycle: started in `initializeApp` after `registerPowerHandlers`; torn down in
`removeSessionListeners()` (both logout paths).

**Policy respect:** the watchdog no-ops when `config.keep_idle_time === "always"`
(those orgs intentionally credit presence). True sleep is still stopped by
`autoStopAfterSleepGap` regardless of policy. It also fails open (does nothing) if
`getSystemIdleTime()` throws — see residual risk.

## Convergence

Both modes converge on: **timer stops, credited only up to the last real activity
timestamp.** Guarded by the `stopTimer` mutex (`_stopTimerInProgress`) and the
idle-action mutex (`_idleActionInProgress`) so the layers never double-close.
`MAX_PAST_SKEW` / `MAX_ENTRY_DURATION` unchanged.

## Cross-platform

`getSystemIdleTime()` and `getMediaAccessStatus`-free logic work on macOS,
Windows, and Linux/X11. The watchdog and idle detector are platform-agnostic; the
only platform branch touched is the notification wording in
`autoStopTimerForPowerEvent`.

## Residual risk

- **Linux/Wayland:** `powerMonitor.getSystemIdleTime()` can be unreliable / return
  0 on some Wayland sessions. The watchdog fails open there (no false stop); the
  idle detector's `ALERTING` hard cap still applies once idle is detected. As
  shipped, the Linux build forces X11/XWayland (see `index.js` Linux block), under
  which `getSystemIdleTime()` uses the X11 ScreenSaver extension and returns real
  idle — so this gap is not reached on the current architecture. A separate
  Wayland-idle-source effort is tracked outside this fix and gated on the owner's
  native-Wayland decision.
- **`keep_idle_time = "always"` + awake-idle:** intentionally not stopped (policy).
  Documented above; only true sleep is stopped for those orgs.
- The interactive idle countdown display may show a value larger than the fixed
  hard-stop grace (e.g. an org-configured 240 min); the timer will hard-stop at the
  fixed grace regardless. This is the intended decoupling, not a defect.

## Key files

- `desktop/src/main/idle-detector.js` — `hardStopGraceSec`, `_checkAutoStop`,
  always-on `ALERTING` interval
- `desktop/src/main/power-manager.js` — `evaluateIdleHardStop` (pure)
- `desktop/src/main/index.js` — `startIdleWatchdog` / `stopIdleWatchdog` /
  `_idleWatchdogTick` / `getIdleWatchdogCapSec`, watchdog lifecycle,
  `autoStopTimerForPowerEvent` notification wording
- `desktop/test/idle-detector.test.js`, `desktop/test/power-sleep-auto-stop.test.js`
