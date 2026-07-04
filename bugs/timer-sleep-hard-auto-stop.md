# Timer counts overnight during sleep/shutdown

**Status:** ✅ FIXED 2026-06-19 (develop)
**Severity:** P0 — reported on Windows production builds
**Scope:** Desktop power events + startup gap detection

## Symptom

User starts timer at ~8 PM, sleeps or shuts down laptop without stopping. Next morning timer shows ~15 hours elapsed including all offline time.

## Root cause

`handleSuspend` only paused screenshots/activity; `isTimerRunning` and `_cachedStartedAtMs` kept advancing. Long sleeps routed into idle keep/discard instead of stopping.

## Fix

- **Hard auto-stop on suspend/lock** via [`desktop/src/main/power-manager.js`](../desktop/src/main/power-manager.js) — calls `stopTimer({ endedAtMs })` at sleep moment + OS notification.
- **`lastActiveAt` heartbeat** persisted in `user-prefs.json`; startup `detectAndCloseStaleSessionOnStartup()` closes orphan sessions after gap > 3 min (crash/kill path).
- **`before-quit` / update install / logout** now record real `duration_seconds` in SQLite.

## Key files

- `desktop/src/main/power-manager.js`
- `desktop/src/main/index.js` — `autoStopTimerForPowerEvent`, `detectAndCloseStaleSessionOnStartup`
- `desktop/test/power-sleep-auto-stop.test.js`
