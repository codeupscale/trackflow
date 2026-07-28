# Idle alert still disappears ~10 minutes after it opens (idle watchdog closes it)

**Status:** ✅ FIXED (2026-07-28)
**Severity:** P1 — the alert is the only way to answer Keep/Discard; when it vanishes the timer
has already been hard-stopped and the user's idle decision is taken for them.
**Scope:** `desktop/src/main/index.js` — `_idleWatchdogTick()`.

## Symptom (QA, 2026-07-28)

> "after 10 minutes idle window, but it is closed again after 10 minutes"

The idle popup appears at the idle threshold and then closes on its own roughly ten minutes
later — even though the 2026-07-23 product decision was that it must **never** auto-dismiss.

## Why the earlier "never auto-dismiss" fix didn't cover this

That fix ([idle-alert-autostop-cannot-disable.md](idle-alert-autostop-cannot-disable.md),
follow-up section) disabled both timers **inside `IdleDetector`**: `_applyConfig()` forces
`alertAutoStopSec = 0` and `hardStopGraceSec = 0`, and `_checkAutoStop()` guards both with `> 0`.
That part is correct and still holds.

But the desktop has a **second, independent** layer — the idle *watchdog* — added by the "12h
phantom" work. It is deliberately decoupled from the idle detector (it exists to stop phantom
tracking when idle detection is turned off or the detector is wedged), so disabling the
detector's caps did nothing to it:

```js
const IDLE_WATCHDOG_GRACE_SEC = 10 * 60;
function getIdleWatchdogCapSec() {
    return thresholdSec + IDLE_WATCHDOG_GRACE_SEC + 120;   // 10min + 10min + 2min = 22 min
}
```

`_idleWatchdogTick()` only checked `isTimerRunning` (which stays **true** during an idle pause —
`pauseTimerForIdle()` sets `isTimerPaused`, not `isTimerRunning`), so once system idle passed
1320 s it ran:

```js
screenshotService?.stop();
activityMonitor?.stop();
idleDetector?.stop();
dismissIdleAlert();                                   // ← the popup disappears
await autoStopTimerForPowerEvent("idle-watchdog", stopAtMs);
```

With the default 10-minute idle threshold the alert appears at minute 10 and the watchdog fires
at minute 22 — the "closed again after ~10 minutes" QA observed.

## Fix

Stand the watchdog down while an alert is genuinely on screen, and re-push the idle pause instead:

```js
if (isIdleAlertActive()) {
    retryIdlePauseIfUnsynced();
    return;
}
```

Safe for the same reason the never-dismiss decision is safe: the entry is server-paused at
idle **detection**, so an unanswered alert credits no additional time — and if that pause never
landed (offline), the retry pushes it back-dated to `idleStartedAt` rather than hard-stopping.
The watchdog keeps doing its real job: idle detection disabled, detector wedged, or no alert on
screen at all.

## Key files

- `desktop/src/main/index.js` — `_idleWatchdogTick()` guard.
- `desktop/test/idle-lock-and-timer-adoption.test.js` — "idle watchdog: never closes a live idle
  alert" (asserts the old 1320 s cap, that it no longer fires with an alert up, and that it still
  fires without one).

## Related

- [idle-alert-autostop-cannot-disable.md](idle-alert-autostop-cannot-disable.md) — the detector-side
  never-dismiss decision this completes.
- [desktop-idle-alert-timer-resumes-on-reconnect.md](desktop-idle-alert-timer-resumes-on-reconnect.md)
- [desktop-timer-phantom-stop-during-idle.md](desktop-timer-phantom-stop-during-idle.md)
