# Desktop "app stops working" during a break (idle pause) — error-path gaps

**Status:** 🟡 INVESTIGATED — deferred (2026-06-30). Owner chose not to work on this yet; documented for later.

**Scope:** Desktop idle detection ↔ timer pause/resume ↔ idle alert. `desktop/src/main/index.js`, `idle-detector.js`, `power-manager.js`.

**Severity:** P2 — by-design pause is correct; the gap is a failure to auto-resume after an error.

## Symptom

User report: "if we are not working like a break, the app stops working." On a break the timer stops/pauses and tracking appears to halt.

## Findings

- This is **mostly by design**: default idle policy is `prompt`. On idle the timer is paused, capture services (screenshot, activity, tray tick) stop, and an idle alert (Keep / Discard / Reassign) is shown. `keep_idle_time: "always"` resumes immediately; `"never"` discards & stops. (Idle threshold default 5 min.)
- **Real gaps (not yet fixed):**
  1. If `showIdleAlert()` fails to create the window (e.g. `await loadProjects()` throws), the timer is already paused but the alert never appears → stuck paused, `isTimerPaused = true`, user must restart manually. No auto-resume on returning activity while the alert is pending.
  2. In `handleIdleAction()` "keep", `activityMonitor?.start()` / `screenshotService?.start()` are **not** wrapped in try/catch; a throw exits early and skips `idleDetector?.start()` + `startTrayTimer()`, leaving tracking half-resumed.

## Recommended fix (when picked up)

- Wrap service `start()` calls in the resume path with try/catch so one failure doesn't abort the rest of the resume sequence.
- Add a safety net: if activity returns while an idle alert is pending but the alert window failed to open, auto-resume tracking.
- Confirm desired break UX with product (pause+prompt vs keep-running) before changing default policy.

## Key files

- `desktop/src/main/index.js` — idle handler (~1804–1874), `pauseTimerForIdle()`/`resumeTimerAfterIdle()`, `handleIdleAction()` (~4454–4764), `showIdleAlert()`
- `desktop/src/main/idle-detector.js`, `desktop/src/main/power-manager.js`
