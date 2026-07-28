# Desktop timer restarts itself behind an open idle alert when the network comes back

**Status:** ✅ FIXED (2026-07-28)
**Severity:** P1 — tracking (and billing) resumes without any user action; the user is credited
time they never agreed to keep, and the idle window's Keep/Discard decision is bypassed.
**Scope:** `desktop/src/main/index.js` (timer sync + server-state adoption), popup renderer, tray.

## Symptom (QA, 2026-07-28)

1. Wi-Fi off.
2. Timer was tracking; tracking stopped.
3. The idle window appeared.
4. Wi-Fi back on.
5. **The timer started again on the desktop app** — without anyone clicking *Continue Tracking*.

## Root cause

The idle pause is **best-effort**. `pauseTimerForIdle()` sets `isTimerPaused = true` locally and
then calls `POST /timer/pause`; when idle is detected while offline that POST fails and is only
logged (`"Server pause failed (will retry on reconcile)"` — but nothing ever retried it). The
server therefore still has the entry as **running**.

On reconnect the 10-second sync tick fetched `/timer/status` and hit:

```js
} else if (isServerTimerOpen(status) && isTimerRunning &&
           isServerTimerPaused(status) !== isTimerPaused) {
    syncOpenTimerFromServerStatus(status, { notify: "start" });   // ← adopts "running"
}
```

`syncOpenTimerFromServerStatus()` took the not-paused branch and restarted everything:
`activityMonitor.start()`, `screenshotService.start()`, `startTrayTimer()`, and a
`timer-started` notification to the popup. `applyRunningStatusFromServer()` also assigned
`isTimerPaused = serverPaused` (false), so the local pause was erased while the alert window was
still on screen. The sibling branch `isServerTimerOpen(status) && !isTimerRunning` could re-open
the timer the same way.

`reconcileTimerState()` already had an `isIdleAlertActive()` guard — the sync tick's own
adoption path did not.

Secondary defect: the popup's **Stop** button, the project select and the tray's *Stop Timer*
item all stayed live behind the alert, so the user could drive the timer from two places while
an idle decision was pending.

## Fix

1. **Local pause outranks server state while an idle decision is pending.** New
   `isIdlePauseAuthoritative()` (`_isHandlingIdleAction || isIdleAlertActive()`):
   - `syncOpenTimerFromServerStatus()` returns early instead of adopting anything;
   - `applyRunningStatusFromServer()` keeps `isTimerPaused = true` rather than copying the
     server's stale `running`.
2. **The pause is retried instead of abandoned.** `_idlePauseSynced` records whether
   `POST /timer/pause` actually landed. `retryIdlePauseIfUnsynced()` re-pushes it — back-dated to
   `idleStartedAt`, so server elapsed is still frozen at the true idle start — from the
   NetworkMonitor `online` handler, from every sync tick that reaches the server, and from the
   idle watchdog tick. Self-gating (already-synced / in-flight / offline / `local-` entry id).
3. **The popup and tray are locked for the life of the alert.** `idle-lock` IPC (plus
   `idleLocked` on `get-timer-state`, so a re-opened popup renders locked) disables Start / Stop /
   project select and shows a banner; `start-timer` / `stop-timer` IPC handlers reject with
   *"Respond to the idle prompt first"*; the tray shows a disabled *"Waiting for idle response…"*
   item instead of Start/Stop.

## Why this is billing-safe

The entry is paused at the instant idle is **detected**, so no time accrues while the alert waits
(the same argument that made "never auto-dismiss" safe — see
[idle-alert-autostop-cannot-disable.md](idle-alert-autostop-cannot-disable.md)). The retry closes
the one hole in that argument: an idle pause raised offline now converges to the server rather
than leaving the entry running there.

## Key files

- `desktop/src/main/index.js` — `isIdlePauseAuthoritative()`, `retryIdlePauseIfUnsynced()`,
  `syncOpenTimerFromServerStatus()`, `applyRunningStatusFromServer()`, `pauseTimerForIdle()`,
  `notifyIdleLockState()`, `buildTrayContextMenu()`, start/stop IPC guards.
- `desktop/src/preload/index.js` — `onIdleLock`.
- `desktop/src/renderer/index-renderer.js` / `index.html` — `applyIdleLock()` + lock banner.
- `desktop/test/idle-lock-and-timer-adoption.test.js` — regression tests.

## Related

- [desktop-idle-alert-closed-by-idle-watchdog.md](desktop-idle-alert-closed-by-idle-watchdog.md)
  — the same QA round; the alert was also being closed by the watchdog.
- [desktop-timer-self-restart-after-stop-on-slow-network.md](desktop-timer-self-restart-after-stop-on-slow-network.md)
  — same failure family (stale server state adopted over authoritative local state).
