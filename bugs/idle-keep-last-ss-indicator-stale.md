# Desktop — "Last SS …" indicator goes stale/empty after idle "Keep" (and on app-startup resume)

**Status:** 🟢 FIXED — root cause confirmed; minimal fix applied; regression test added.
**Reported:** 2026-06-18 (QA, production instance)
**Investigated / Fixed:** 2026-06-18
**Scope:** Desktop agent (Electron) — screenshot-captured → renderer "Last SS …" indicator wiring across all `screenshotService.start()` paths.
**Severity:** P2 — cosmetic/observability only (no data loss, no missed captures). The indicator misrepresents capture activity, which erodes user trust in monitoring.

## Symptom (as reported)

> "The idle window appears after the idle threshold. The user clicks **Keep idle time**. After that, the desktop app no longer shows the 'Last SS — <N>s ago' indicator in the main popup window."

After resolving idle via **Keep**, the "Last SS …" string in the popup footer goes stale or empty and never refreshes to reflect fresh post-idle captures, even though screenshots are still being captured and uploaded normally.

## Root cause

The "Last SS …" indicator is driven by a single callback on the `screenshotService` instance, `_onScreenshotCaptured`, which fires on every successful upload (`screenshot-service.js:981`) and every offline-queue fallback (`screenshot-service.js:1015`). The main process registers that callback via `setScreenshotCapturedCallback(...)`; the callback sets the main-side `_lastScreenshotAt` (`index.js:489`) and pushes a live `activity-update` IPC to the popup, which the renderer consumes in `onActivityUpdate` (`index-renderer.js:120`) to refresh `updateConnStatus()` (`index-renderer.js:102`).

**The defect:** `setScreenshotCapturedCallback(...)` was registered in exactly ONE place — inside `afterStartTimer()` — while `screenshotService.start()` is invoked from at least **five** distinct code paths:

| # | `start()` call site | Path | Callback registered there? |
|---|---|---|---|
| 1 | `index.js` (afterStartTimer) | Normal user-initiated start | ✅ yes (was the only place) |
| 2 | `index.js:1178` | App-startup resume (server reports timer already running) | ❌ no |
| 3 | `index.js:986` | Idle policy=`always` auto-keep | ❌ no |
| 4 | `index.js:1116`/`:1184` (keep / discard / reassign in `handleIdleAction`) | Idle resolution resume | ❌ no |
| 5 | `index.js:1239`/`:1272` | Sleep/wake resume | ❌ no |

Because `screenshotService.stop()` deliberately does NOT clear `_onScreenshotCaptured` (`screenshot-service.js:215+`), paths 3–5 *normally inherit* the callback that path 1 registered — **but only if the timer was started via `afterStartTimer()` in the current process session.**

The indicator therefore breaks whenever the running timer was *not* started through `afterStartTimer()` this session — the canonical case being **path 2, app-startup resume**: TrackFlow launches, finds a timer already running on the server, and resumes capture at `index.js:1178` without ever registering the callback. From that point `_lastScreenshotAt` is never assigned by any capture, so no `activity-update` carrying a fresh `lastScreenshotAt` is ever pushed and the indicator stays empty. Run an idle → **Keep** cycle in that same session and the symptom persists exactly as QA described: captures keep happening, but the callback is absent, so "Last SS …" never updates.

This also refutes two of the leading hypotheses:
- (b) The renderer only nulls its own `_lastScreenshotAt` inside `updateDisplay(false)` (`index-renderer.js:173`), which runs on `timer-stopped` / a stopped `syncTimerState`. The Keep path never sends `timer-stopped`, so the renderer stays `isRunning = true` and does NOT null the value — not the cause.
- (a) partially: the callback is not *lost* by `stop()`; it was simply *never registered* on the resume-based start paths.

## Fix

Register `setScreenshotCapturedCallback(...)` **once at service creation** (`index.js:946`), alongside the other persistent service callbacks (`setRestartStateSaver`, `setWallpaperDetectedCallback`), and remove the duplicate per-start registration inside `afterStartTimer()`. The callback now applies to every `start()` path — normal start, app-startup resume, idle keep/discard/reassign, policy=`always`, and sleep/wake resume — so `_lastScreenshotAt` updates and a live `activity-update` is pushed on every capture regardless of how the timer was (re)started.

This is minimal, cross-platform (no platform-specific code touched), and consistent with the local-first architecture: the callback fires on both the upload-success path and the offline-queue path, so the indicator reflects reality whether online or offline.

## Regression test

Added `describe('setScreenshotCapturedCallback()')` in `desktop/test/screenshot-service.test.js`:
- callback fires on a successful upload capture,
- callback fires on the offline-queue fallback (`_queueForOffline`),
- **callback survives a `stop()` → `start()` cycle and fires on captures after an idle→keep resume** (the core regression),
- `capture()` does not throw when no callback is registered.

Full desktop suite green after the change: **24 suites, 445 tests passing.**

## Files cited (verified on branch `develop`, 2026-06-18)

| What | Location |
|---|---|
| Main-side `_lastScreenshotAt` declaration | `desktop/src/main/index.js:489` |
| Callback now registered once at service creation (FIX) | `desktop/src/main/index.js:946` |
| Duplicate per-start registration removed (FIX) | `desktop/src/main/index.js` (`afterStartTimer`, formerly ~`:2114`) |
| App-startup resume `start()` — lacked callback (path 2) | `desktop/src/main/index.js:1178` |
| Idle policy=`always` resume `start()` (path 3) | `desktop/src/main/index.js:986` |
| `handleIdleAction` keep/discard/reassign resume `start()` (path 4) | `desktop/src/main/index.js:1116`, `:1184` |
| Sleep/wake resume `start()` (path 5) | `desktop/src/main/index.js:1239`, `:1272` |
| `_lastScreenshotAt` reset on stop (correct) | `desktop/src/main/index.js:2419` |
| `setScreenshotCapturedCallback` setter | `desktop/src/main/screenshot-service.js:105-107` |
| Callback fired on upload success | `desktop/src/main/screenshot-service.js:981` |
| Callback fired on offline-queue fallback | `desktop/src/main/screenshot-service.js:1015` |
| `stop()` does NOT clear the callback (by design) | `desktop/src/main/screenshot-service.js:215+` |
| Renderer indicator render | `desktop/src/renderer/index-renderer.js:102-113` |
| Renderer consumes `activity-update` | `desktop/src/renderer/index-renderer.js:120-125` |
| Renderer nulls `_lastScreenshotAt` only on stop (not keep) | `desktop/src/renderer/index-renderer.js:173` |
| Regression test | `desktop/test/screenshot-service.test.js` (`describe('setScreenshotCapturedCallback()')`) |
