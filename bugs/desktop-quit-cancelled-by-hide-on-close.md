# "Quit TrackFlow" did nothing — unless a timer was running

**Status:** ✅ FIXED (2026-07-30)
**Severity:** P1 — the app could not be quit at all in its most ordinary state (signed in, idle).
**Scope:** `desktop/src/main/index.js` (`before-quit` handler, `popupWindow.on("close")`).

## Symptom (owner, 2026-07-30)

> "im clicking on quit trackflow it is not quitting but when i click sign out and then click on
> quit then the app quits"

and, when asked:

> "i was not running any timer man"

That detail is the diagnosis, not a contradiction: **idle was the broken case, tracking was the
working one** — the opposite of what anyone would guess, which is why it looked arbitrary.

## Root cause

Introduced by the tray-popup → real-window rework
([desktop-tray-popup-to-real-window.md](desktop-tray-popup-to-real-window.md)). That change made the
window's close button *hide* rather than destroy, so tidying the desktop can never kill a running
timer:

```js
popupWindow.on("close", (e) => {
    if (isQuitting) return;   // real quit: let it through and tear down
    e.preventDefault();
    popupWindow.hide();
});
```

The escape hatch is `isQuitting`. But `before-quit` set that flag **only inside its timer-running
branch**:

```js
app.on("before-quit", async (e) => {
    if (isQuitting) return;
    if (isTimerRunning && apiClient) {
        e.preventDefault();
        isQuitting = true;        // ← only here
        …
        app.exit(0);
    } else {
        idleDetector?.stop();     // ← flag never set on this path
        …
    }
});
```

So quitting with no timer running:

1. Tray → Quit → `app.quit()` → `before-quit` fires, takes the `else` branch, flag stays `false`.
2. The `else` branch does not `preventDefault()`, so Electron proceeds and asks the window to close.
3. The close handler sees `isQuitting === false` → `preventDefault()` + `hide()`.
4. The window refuses to close, so **the quit is cancelled**. The app merely hid.

Sign Out appeared to fix it only because `performLogout()` destroys `popupWindow` and creates the
login window, which has no hide-on-close rule — so the next Quit had nothing left to veto.

## Fix

`before-quit` commits to the quit before either branch can bail out:

```js
app.on("before-quit", async (e) => {
    if (isQuitting) return;   // re-entry guard
    isQuitting = true;        // ← commit first
    if (isTimerRunning && apiClient) { … }
    else { … }
});
```

A plain window close with no quit in progress still hides, so the original guarantee — a running
timer is never killed by closing the window — is unchanged.

Setting the flag earlier also reaches `startSelfRemovalWatcher()`, which uses `isQuitting` to
suppress mistaking an updater file-swap for an uninstall. Suppressing marginally earlier during a
quit is correct: we are quitting either way.

## Tests

`desktop/test/quit-with-hide-on-close.test.js` models the two handlers' interaction (index.js pulls
in better-sqlite3, built for Electron's ABI, which cannot load under Jest — hence the
logic-replication style used throughout this suite):

- the bug: idle + signed in with the flag set late → quit cancelled by our own window
- fixed: same case with the flag set early → window closes, app quits
- a running timer still quits (the branch that always worked)
- signed out quits — why "Sign Out then Quit" appeared to work
- a plain close with no quit in progress still HIDES, and a running timer survives it
- `before-quit` is re-entrant-safe

## Related: what a quit does to tracked time (verified, unchanged by this fix)

`before-quit`'s timer branch closes the live session in SQLite **synchronously** via
`closeLocalSession()` — the stop is durable before any network work — then runs a bounded 2500 ms
`sessionSyncWorker.syncNow("quit", {ignoreBackoff: true})` plus an offline-queue flush, inside a 6 s
force-exit. `performLogout()` does the same with a 6 s budget (`LOGOUT_SYNC_BUDGET_MS`).

Anything not uploaded inside the budget stays in SQLite — `clearForLogout()` deliberately keeps
every unconfirmed row — and uploads at next launch or sign-in. There is **no server-side cron** for
this: upload is entirely the desktop's `SessionSyncWorker` (60 s interval, `online` event,
post-stop, launch, logout/quit). A true force-kill runs no JS at all; recovery is local-first
SQLite replayed by the sync worker.
