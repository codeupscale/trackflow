# No notification (or sound) when an employee returns from a break to a stopped timer

**Status:** fixed
**Reported:** 2026-08-20 (owner, from employees)
**Severity:** P1 — silent loss of tracked time; employees work untracked without knowing

## Symptom

Employees came back from a break, saw nothing, and carried on working. The timer had been
auto-stopped while they were away, and the first they knew of it was noticing the tray
much later — by which point the intervening work was never recorded.

## Why every existing path missed them

The failure needs one specific (and completely ordinary) setup: **a machine that never
sleeps and never locks** — on charger, external display, screensaver off. That is the
normal office desktop.

1. The idle detector fires and the idle alert appears — with a beep — but nobody is at
   the desk to hear it.
2. The alert goes unanswered. The **idle watchdog** hard-stops the timer and calls
   `dismissIdleAlert()`, so the modal is gone too.
3. `autoStopTimerForPowerEvent()` shows the "Timer auto-stopped" toast **at the moment of
   the stop** — into an empty room. It is long gone from the screen by the time anyone
   returns.
4. `notifyTrackingState()` — the function whose whole job is "tell the user their current
   state" — is only ever called on `wake`, `unlock`, and `startup`. A machine that never
   slept and never locked emits **none of those events**.
5. The idle watchdog itself self-gates on `isTimerRunning`, so the instant it stops the
   timer it also stops looking. Nothing was watching for the user coming back.

The result is a desktop that looks completely normal and a timer that is off.

## Fix

A return-from-break watcher: the mirror image of the idle watchdog, with the opposite
gate. It runs while the timer is **stopped**, polls `powerMonitor.getSystemIdleTime()`
every 15s, and fires when the user has been away past the org's idle threshold and is
now active again.

Decision logic is pure and unit-tested in `desktop/src/main/return-to-work.js`:

- **Peak-tracked absence.** The poll that observes the return sees `systemIdleSec === 0`,
  because the OS counter resets on the first keystroke. Keying on the last reading would
  make every absence invisible, so the longest reading of the absence is retained.
- **Announce on the return, never during the absence** — that is the entire point; the
  auto-stop toast already covers the moment of the stop.
- **Fails silent, not spurious.** A `NaN` from `getSystemIdleTime()` (some Wayland
  sessions throw) must not read as "away for ages".
- Defers to a live idle alert, never fires signed-out, one announcement per absence.

### Three cues, deliberately

Each one alone is routinely swallowed, so the alert uses all three:

1. **System notification** with `silent: false` and a unique id — Windows Action Center
   dedups back-to-back toasts, and this one must not be merged with the auto-stop toast
   that fired hours earlier.
2. **In-renderer WebAudio beep** — macOS Focus and Windows Action Center drop notification
   sound with no fallback, which is exactly why the idle alert already carries its own.
   Three *descending* tones, distinct from the idle alert's two rising ones, so
   "you are not being tracked" never sounds like "are you still there?". No external
   resource, so the strict CSP (`default-src 'none'; script-src 'self'`) is unchanged.
3. **The window itself**, surfaced with a red banner. This is the cue no notification
   policy can suppress, and it is still there if the user was out of earshot.

The banner clears the moment tracking resumes.

## Regression tests

`desktop/test/return-to-work.test.js` — 24 tests covering the decision function
(return vs still-away, short break, idle-alert deference, signed-out, cooldown, NaN
handling, org threshold), peak-idle tracking, the notification copy, and the wiring
(stopped-gate, session lifecycle, all three cues, contextBridge-only channel, CSP-safe
beep, banner cleared on start).

## Lessons

- **A self-gating watchdog only covers half a transition.** `isTimerRunning` made the
  idle watchdog correct and made it blind the instant it acted. Anything that changes
  state on the user's behalf needs a matching watcher for the state it moved *to*.
- **A notification delivered to an empty room has not been delivered.** The auto-stop
  toast was firing correctly and was worth nothing — the timing was the bug.
- The three notification paths that already existed all keyed off OS power events, so a
  machine that never sleeps had no coverage at all. Worth asking of any user-facing
  signal: what hardware setup makes this never fire?
