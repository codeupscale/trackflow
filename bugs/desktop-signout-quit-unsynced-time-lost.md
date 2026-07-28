# Sign-out wiped unsynced tracked time; quit didn't upload it

**Status:** ✅ FIXED (2026-07-28)
**Severity:** P1 — signing out while offline permanently destroyed tracked time that had not
reached the server.
**Scope:** `desktop/src/main/index.js` — `performLogout()`, `before-quit`, local `timer_sessions`.

## Requirement (owner, 2026-07-28)

> "if a user signs out of the app or force closes the app, the time tracked should be stopped and
> the tracked time should be uploaded"

## What was already correct

- **Sign-out** stopped the timer (`performLogout()` → `stopTimer()`), which records the stop in
  SQLite first and then calls the API.
- **Quit** (`before-quit`) recorded a local stop, then best-effort `POST /timer/stop` inside a 2 s
  race, with a hard 3 s force-exit.

## The two gaps

1. **Sign-out DELETED unsynced time.** `performLogout()` called `clearLocalTimerSessions()`, which
   was `DELETE FROM timer_sessions` — the table had no owner column, so a wholesale wipe was the
   only way to stop a stale open row from being restored on the next login as a phantom
   "Tracking HH:MM:SS" timer. But it also deleted rows whose start/stop had never reached the
   server. Sign out while offline (or with the API down) and that time was gone: nothing was left
   for `reconcileTimerState()` to push on the next launch.
2. **Nothing flushed before teardown.** Both paths tore down (`apiClient = null`,
   `offlineQueue.close()`) without a reconcile or queue flush. A session that *started* offline has
   no server entry to stop, so the direct stop call could not land it; heartbeats and screenshots
   sat in the queue until some future launch.

## Fix

**Ownership instead of a wipe**

- `timer_sessions` gains a `user_id` column (guarded `ALTER TABLE` migration on open — the table
  predates it; legacy rows keep `NULL` and stay visible).
- `_sessionUserId` is set right after `getMe()` validates the token, and stamped on every
  `saveLocalTimerStart()`.
- Every read (`getActiveLocalTimer`, `getUnsyncedTimerSessions`,
  `hasPendingCompletedOfflineSessions`, `getUnsyncedCompletedSecondsForToday`) is scoped by
  `_ownRowsClause()` — `user_id IS NULL OR user_id = <current>` — so one account can never see or
  push another's rows.
- `clearLocalTimerSessions()` now keeps exactly what still needs uploading (the signed-in user's
  **closed but unsynced** sessions) and deletes everything else: open rows, fully synced rows, and
  any other account's rows. Kept rows cannot resurrect a live timer (they are closed) and are
  pushed by reconcile the next time that user signs in. With no known user (forced logout before
  `getMe`) it falls back to the original wipe.

**Upload before teardown**

- `performLogout()`: after the stop, and while `apiClient` is still alive, runs
  `reconcileTimerState()` then `offlineQueue.flush()` under a `LOGOUT_SYNC_BUDGET_MS = 6000`
  bound (`withTimeout()`), so a dead network can never make Sign out feel broken.
- `before-quit`: same bounded reconcile + flush (2.5 s) after the local/server stop; force-exit
  raised 3 s → 6 s to fit it.

## Limits worth stating

A real **force kill** (Force Quit, `kill -9`, task manager, power loss) runs no JavaScript at all —
no app can upload at that instant. The guarantee there is unchanged and already in place: the start
and stop are in SQLite before any network call, `detectAndCloseStaleSessionOnStartup()` +
`reconcileTimerState()` push them on the next launch, and the server's `timer:cleanup-stale` job
closes an abandoned open entry after `offline_grace_minutes`.

## Key files

- `desktop/src/main/index.js` — `_sessionUserId`, `_ownRowsClause()`, `saveLocalTimerStart()`,
  `clearLocalTimerSessions()`, `withTimeout()`, `performLogout()`, `forceLogout()`, `before-quit`.

## Related

- [desktop-phantom-tracking-stale-local-session-cross-account.md](desktop-phantom-tracking-stale-local-session-cross-account.md)
  — the cross-account phantom the old wipe was defending against; ownership now covers it without
  destroying data.
- [desktop-offline-start-stop-lost-on-reconnect.md](desktop-offline-start-stop-lost-on-reconnect.md)
