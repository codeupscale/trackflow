# Desktop idle window — multi-screen surfacing + idle-time loss on sleep

**Status:** ✅ FIXED (2026-07-07, `fix/idle-window-and-manual-time-entry`) — owner testing.

**Scope:** Desktop idle detection/alert + power events. `desktop/src/main/index.js`, `desktop/src/main/power-manager.js`, `desktop/src/renderer/idle-alert.js`.

**Severity:** P1 — two employee-reported defects: (A) the idle alert sometimes does not appear and/or makes no sound on multi-screen / multi-virtual-desktop setups, so the user never gets the Keep/Discard/Reassign choice; (B) locking or sleeping while the idle alert is showing makes the window vanish AND silently discards ALL accumulated idle time.

This report covers two related idle-window defects. They ship together.

---

## BUG A — Idle alert sometimes doesn't appear / no sound (multi-screen + multiple virtual desktops)

### Symptom

Employees on macOS/Windows with several monitors and/or several virtual desktops (macOS Spaces / fullscreen apps, Windows virtual desktops) report that when they go idle:

- the idle alert sometimes never surfaces (especially when working in a fullscreen app or on a virtual desktop other than the one the alert was born on), and/or
- there is no sound, so even when the window is somewhere off-screen they get no cue.

### Root cause (file:line at time of fix)

1. **Sound had a single fragile path.** The only sound was a raw Electron `Notification({ silent:false })` in `showIdleAlert()` (`index.js` ~4593–4607). It had **no unique toast id**, so Windows Action Center dedups/suppresses back-to-back idle toasts; macOS Focus/DND and Linux libnotify frequently drop the sound entirely. There was **no in-app sound fallback anywhere** (grep confirmed: no `shell.beep`, no `AudioContext`, no `flashFrame` in `src/`).
2. **macOS fullscreen Spaces.** `_createIdleWindowOnDisplay()` opts (`index.js` ~4650–4666) did **not** set `fullScreenable:false`. In Electron 28 a `fullScreenable:true` window frequently fails to overlay another app's dedicated fullscreen Space even with `setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true})` — so the alert is created on the default Space and never surfaces.
3. **Windows foreground-lock.** There was no `flashFrame()` anywhere; `win.show()+win.focus()` (`index.js` ~4739–4740) is subject to the Windows foreground-lock, so the window can open **behind** the active app, unfocused, with no taskbar flash. `setVisibleOnAllWorkspaces` is a documented no-op on Windows (virtual desktops are not displays).
4. **Show-race.** The early-return guard (`index.js` ~4568–4584) — if a prior idle window object existed but never actually became visible (its `show()` never landed) — only called `focus()/moveTop()` on the invisible window, so it stayed invisible.

### Fix

- **A1 — reliable sound.** Added an in-renderer WebAudio beep (`OscillatorNode`, two short rising tones) in `desktop/src/renderer/idle-alert.js`, fired the moment the window receives its first `idle-data` (becomes visible) and again on an explicit `playSound:true` replay (post-wake re-show). WebAudio needs no external resource, so the strict idle-alert CSP (`default-src 'none'; script-src 'self'`) is satisfied with **no CSP change**. This guarantees sound the moment ANY alert window (primary or mirror) is visible, independent of OS notification policy. The system `Notification` is kept as a secondary path but is now routed through `showSystemNotification()` (`system-notifications.js`) so it gets a **unique id** (`trackflow-idle-<actionId>` — fixes Windows dedup) plus the branded icon and AppUserModelID.
- **A2 — macOS.** `_createIdleWindowOnDisplay()` opts now set `fullScreenable:false` (darwin only). A new `_revealIdleAlertWindow()` re-asserts `setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true})` **after** `show()`, matching the tray-popup pattern. `setAlwaysOnTop(true,'screen-saver')` is still applied at creation.
- **A3 — Windows.** After `show()`, `_revealIdleAlertWindow()` calls `win.flashFrame(true)` + `win.moveTop()` (win32 only) to defeat foreground-lock and flash the taskbar button.
- **A4 — show-race guard.** The early-return branch now detects a window that exists but never became visible (`!win._shown || !win.isVisible()`) and **force-reveals** it (and any mirror) via `_revealIdleAlertWindow()` instead of only focusing an invisible window.
- **A5 — platform guards.** `fullScreenable:false` + `setVisibleOnAllWorkspaces` re-assert are `process.platform==='darwin'`; `flashFrame` is `process.platform==='win32'`; Linux/Wayland placement stays advisory (existing comments retained).

---

## BUG B — Lock/sleep while idle window showing: window vanishes + ALL accumulated idle time discarded

### Symptom

Employee goes idle (alert showing), then locks the screen or closes the lid. On return: the idle window is gone and the timer was hard-stopped — but the entire idle period that was pending a Keep/Discard/Reassign decision is silently gone. The user never got to choose.

### Root cause (file:line at time of fix)

- `onSuspendCleanup` (`index.js` ~2121, from `power-manager.js` ~68) called `idleDetector.stop()` (which nulls `idleStartedAt`) **and** `dismissIdleAlert()` (which destroys the window and sets `_dismissedProgrammatically=true` so it never re-shows).
- Then `handleSuspend` (`power-manager.js` ~62–96) hard auto-stopped the timer (`autoStopForPowerEvent → stopTimer`). Because idle had **already server-paused** the entry at `idleStartedAt` via `pauseTimerForIdle()` (`index.js` ~984–988) and the stop path never calls `resumeTimer()`, the paused interval `[idleStartedAt..stop]` was dropped → idle time silently discarded.
- `idle-detector.js` already shipped `suspend()/resume()/setAlertState()` (built to preserve idle across sleep) but they were referenced **only in tests**, never wired from `index.js`. `onResumeAfterSleep` only reconciled + flushed; it never re-showed the alert.

### Fix

Preserve the idle decision across lock/sleep **only when an idle alert is genuinely pending**, without regressing the hard-auto-stop-on-sleep policy for the normal non-idle case:

- **B1 — predicate.** New `isIdleAlertActive()` = `idleDetector.isIdleActive() || (idle window exists & not destroyed)`. (`idle-detector.js` already had `isIdleActive()`.)
- **B2 — suspend.** In `onSuspendCleanup`: if idle alert active → `idleDetector.suspend()` (preserves `idleStartedAt`, clears the auto-stop interval → `SUSPENDED`) and **HIDE** the windows (keep the objects) via `hideIdleAlertWindows()`; do **not** `dismissIdleAlert()`. Otherwise keep the existing `idleDetector.stop()` + `dismissIdleAlert()` teardown. The snapshot is captured **exactly once** so a paired lock-screen+suspend can't clobber it.
- **B3 — suppress hard auto-stop.** New `shouldAutoStopOnSuspend()` callback returns `false` when idle alert active; `handleSuspend` (`power-manager.js`) gates the auto-stop block on it (checked before the `_autoStopInFlight` coalescing guard). The timer stays server-paused at `idleStartedAt`; it is not stopped. The normal non-idle lid-close (predicate `true`) still hard-stops.
- **B4 — resume.** In `onResumeAfterSleep`: if idle was preserved and the timer is still running → `idleDetector.resume()` then `idleDetector.setAlertState(idleStartedAt)` to re-enter `ALERTING` with the SAME `idleStartedAt` (so `getIdleDuration()` spans the sleep gap) and `alertShownAt=now` (avoids instant auto-stop on wake). `reshowIdleAlertAfterResume()` reveals the hidden windows (or rebuilds if they were lost) and broadcasts fresh `idle-data` (extended idle seconds, new actionId, `playSound:true` so the renderer re-beeps) so the user can still choose Keep/Discard/Reassign on the full away duration. The existing `reconcileTimerState().then(flush)` still runs.
- **B5 — pause invariant.** `isTimerPaused` stays `true` throughout the preserved window, so the reconcile resume self-heal (`index.js` ~4117, guarded by `!isTimerPaused`) does not un-pause the entry during the idle decision.

### Regressions protected

1. Non-idle lid-close still hard-stops at the suspend instant — the B3 gate fires ONLY when the idle alert is genuinely active.
2. Paired lock-screen+suspend is idempotent — the snapshot is captured once; `idleDetector.suspend()` from `SUSPENDED` is safe.
3. `reconcileTimerState` + offline-queue flush after resume still run; the replay-resume self-heal stays suppressed while `isTimerPaused=true`.
4. Offline-on-wake: the Keep/Discard/Reassign decision goes through the existing `handleIdleAction` offline path (`_pendingOfflineReassignIdleSec` / offline queue) unchanged.
5. `'never'` / `'always'` idle policies (no dialog/window) are untouched — all Bug-B logic is gated strictly on `isIdleAlertActive()`, which is false for those paths.

---

## Affected platforms

| Platform | Bug A behavior after fix | Bug B behavior after fix |
| --- | --- | --- |
| **macOS** (Intel + Apple Silicon) | `fullScreenable:false` + post-show `setVisibleOnAllWorkspaces({visibleOnFullScreen:true})` + `'screen-saver'` level → alert surfaces on every Space and over fullscreen apps; WebAudio beep + unique-id toast independent of Focus/DND | Idle preserved across lock/sleep; timer stays paused, alert re-shows on wake with full away duration |
| **Windows** (10/11) | `flashFrame(true)` + `moveTop()` defeat foreground-lock; WebAudio beep + unique toast id defeats Action Center dedup. **Residual:** cannot mirror onto every Windows virtual desktop — the alert opens on the ACTIVE virtual desktop (no per-app "show on all virtual desktops" API) | Same as macOS — idle preserved across lock/sleep |
| **Linux** (X11) | `'screen-saver'` → `_NET_WM_STATE_ABOVE`; workspace pinning best-effort via EWMH; WebAudio beep works | Same — idle preserved across lock/sleep |
| **Linux** (Wayland) | Placement/stacking compositor-owned (advisory); alert appears on the active output; WebAudio beep works | Same — idle preserved across lock/sleep |

All Electron security settings (`contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, `contextBridge` preload) are preserved on every alert window. No CSP change was required (WebAudio needs no external resource).

## Key files

- `desktop/src/main/index.js` — new `_revealIdleAlertWindow()`, `isIdleAlertActive()`, `hideIdleAlertWindows()`, `reshowIdleAlertAfterResume()`, `_idleSuspendState`; `fullScreenable:false` (darwin) in `_createIdleWindowOnDisplay()`; unique-id `showSystemNotification()` for the idle toast; show-race force-reveal in the early-return guard; power handlers now pass `shouldAutoStopOnSuspend` and the preserve/re-show `onSuspendCleanup`/`onResumeAfterSleep` bodies.
- `desktop/src/main/power-manager.js` — `handleSuspend` gates the hard auto-stop on `shouldAutoStopOnSuspend()`.
- `desktop/src/renderer/idle-alert.js` — WebAudio `playIdleBeep()` fired on first `idle-data` / `playSound:true`.
- `desktop/test/__mocks__/electron.js` — mock `BrowserWindow` gains `flashFrame` + `setAlwaysOnTop`.

## Test coverage

- `desktop/test/idle-window-multiscreen-sound.test.js` (Bug A): unique-id notification path (real `system-notifications.js`); `_revealIdleAlertWindow` per-platform (`flashFrame` on win32, `setVisibleOnAllWorkspaces` re-assert on darwin, `moveTop`+`focus` everywhere); `_createIdleWindowOnDisplay` opts set `fullScreenable:false` only on darwin with security hardening preserved; show-race force-reveal of an existing-but-never-shown window.
- `desktop/test/idle-sleep-preservation.test.js` (Bug B): wires the REAL `IdleDetector` into the REAL `PowerManager` — suspend while idle-active does NOT stop the timer and does NOT null `idleStartedAt` (detector → `SUSPENDED`, window hidden not destroyed); resume re-enters `ALERTING` with the same `idleStartedAt` and idle duration spans the gap; `alertShownAt` resets on wake (no instant auto-stop); non-idle suspend still hard auto-stops; paired lock-screen+suspend idempotency; `'never'`/`'always'` fall through to hard-stop.

## Verification

- `cd desktop && npx jest` → **568/568 passing** (was 548; +20 new assertions across the two new suites). No pre-existing failures.

## Follow-up / QA note

Verified statically + via unit tests (mocked BrowserWindow/Notification, real IdleDetector + PowerManager). Recommend targeted manual QA: (A) go idle while on a different macOS Space, inside a macOS fullscreen app, and on a different Windows/Linux virtual desktop — confirm the alert surfaces and beeps in all cases; (B) go idle, then lock/sleep, wait past the idle threshold, and wake — confirm the alert re-appears showing the full away duration and the timer never lost the paused interval.

**Residual limitation (Windows):** there is no per-app API to mirror a window onto every Windows virtual desktop, so on Windows the alert appears on the ACTIVE virtual desktop only (documented in-code). On Wayland, workspace/output placement is compositor-owned and remains advisory.
