# Desktop — duplicate "Timer auto-stopped" notification on lid-close

**Area:** Desktop power events (`power-manager.js`, `index.js`)
**Severity:** P2 (cosmetic + user-confusing; no data impact)
**Status:** ✅ FIXED (2026-06-23) — branch `fix/desktop-duplicate-autostop-notification`, merged to `develop`

## Symptom
Closing the laptop lid (or locking the screen) while a timer is running showed **two** "TrackFlow — Timer auto-stopped" toasts — one "due to system sleep" and one "due to screen lock" — both reporting the same time (e.g. "up to 20:32"). Users read this as two stops / lost time.

## Scope
macOS (and any OS that emits both `lock-screen` and `suspend` on lid-close). Timer data was **never** duplicated — the DB showed a single saved entry.

## Root cause
A lid-close fires both `powerMonitor` events `lock-screen` and `suspend` a tick apart. Each ran `handleSuspend()` → `autoStopTimerForPowerEvent()`. `isTimerRunning` only flips to `false` deep inside the async `stopTimer()` (after the network call), so when the second event arrives the guard still passes and a **second toast** is shown. The `_stopTimerInProgress` mutex correctly blocked the second *save*, but the notification was not behind that mutex.

Evidence: `desktop/src/main/power-manager.js` `handleSuspend()`; `desktop/src/main/index.js` `autoStopTimerForPowerEvent()` (showed toast unconditionally after `await stopTimer()`).

## Fix
1. `power-manager.js`: coalesce the paired events with an `_autoStopInFlight` guard (reset on resume/unlock + 10s fallback + logout) so only the first event performs the stop + toast.
2. `index.js`: `autoStopTimerForPowerEvent()` now only shows the toast when `stopTimer()` actually performed the stop (skips when the mutex returned an error) — data-layer backstop.
3. Wording clarified: *"Timer stopped at HH:MM because your computer was locked/went to sleep. All time tracked before then was saved."*

Tests: `test/power-sleep-auto-stop.test.js` — paired lock+suspend coalesces to one auto-stop; fresh sleep cycle after resume stops again.
