# Desktop notifications show 24-hour time instead of 12-hour

**Status:** ✅ FIXED (2026-07-07) · **Severity:** P3 (UX) · **Area:** Desktop notifications

## Symptom

OS toasts rendered times in 24-hour format, e.g.:

> **TrackFlow — Timer auto-stopped**
> Timer stopped at **14:39** because your computer was locked. All time tracked before then was saved.

Users expect 12-hour clock (`2:39 PM`), matching the web dashboard (attendance list already shows `11:50 AM`).

## Root cause

Two independent copies of `formatTimeShortLocal()` hardcode `HH:mm`:

- `desktop/src/main/power-manager.js` — used by the auto-stop toasts (lock/sleep stop at `index.js` `autoStopTimerForPowerEvent()`, startup-gap stale-session close).
- `desktop/src/main/system-notifications.js` — used by screenshot-capture toasts (`screenshot-service.js`).

## Fix

Both formatters now emit `h:mm AM/PM` (`2:39 PM`, `12:00 AM` midnight, `12:00 PM` noon). All notification call
sites pick this up automatically since they interpolate the helper's output. Tests updated in
`desktop/test/power-sleep-auto-stop.test.js`, `desktop/test/system-notifications.test.js`,
`desktop/test/screenshot-service.test.js`, with new midnight/noon boundary cases.
