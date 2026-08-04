# Desktop — "Continue tracking" on the idle alert leaves the timer paused

**Area:** Desktop agent — idle resolution
**Severity:** P1 (user believes tracking resumed; it silently did not)
**Status:** ✅ FIXED (2026-08-03, `develop`)

## Symptom

QA on dev build 9: after clicking **Continue tracking** on the idle alert, the idle
gap was correctly NOT added — but **the timer did not resume**. It sat paused (display
frozen at the idle-start elapsed) even though the alert had been dismissed, so the user
thought they were tracking when they were not.

## Root cause

`handleIdleAction()` (`desktop/src/main/index.js`) resolves the idle state before acting:

```js
const resolved = idleDetector?.resolveIdle(actionId);
if (!resolved && idleDetector?.state !== IDLE_STATE.STOPPED) {
    // sent an error to the alert window, then RETURNED — without resuming
    return;
}
```

`idleDetector.resolveIdle(actionId)` returns `null` whenever the passed `actionId` does
not match the detector's current `_actionId` (`idle-detector.js:282`). `_actionId` is
**incremented every time idle is re-detected** (`idle-detector.js:445`) and every time
the alert is re-shown with a fresh id (the "closed without action → re-show in 3s"
path, `index.js:~5374`). So if the detector re-ticked or the alert was re-shown while
the window was open, the renderer was holding a **stale actionId**. On click:

1. `resolveIdle(staleId)` → `null` (ignored),
2. `handleIdleAction` hit the abort branch and **returned before
   `resumeTimerAfterIdle()` / `startTrayTimer()`**,
3. `dismissIdleAlert()` still ran (`index.js`, in the `resolve-idle` IPC handler).

Net: alert closed, pause never lifted → the timer stayed paused. A race lost to
**auto-stop** looks identical at this guard, but auto-stop leaves the timer STOPPED —
so the two cases must be told apart.

## Fix

The abort branch now distinguishes the two cases. If the detector is not STOPPED and
the timer is still **running and paused for idle**, this is a genuine user click on a
live timer that merely lost the actionId race — so it re-resolves against the CURRENT
action id and falls through to the resume below. Only a truly-already-resolved state
(auto-stop won, or the timer is no longer running) keeps the original abort. This
guarantees the pause is always lifted on a Continue click, regardless of actionId drift.

## Verification

- Existing idle suites green (`idle-detector`, `idle-discard-split`, `idle-alert-*`).
- Manual: trigger idle, let the detector re-tick / the alert re-show, then click
  Continue — timer resumes and the tray counter starts climbing again.

## Related

- [[desktop-idle-continue-still-bills-the-idle-gap]] — the sibling idle-continue bug
  (gap billed) fixed earlier; this one is the resume half.
