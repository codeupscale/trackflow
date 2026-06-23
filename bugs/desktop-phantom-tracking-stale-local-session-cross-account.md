# Desktop — phantom "Tracking 149:47:48" on a brand-new account (stale local session)

**Area:** Desktop local-first timer state (`index.js` `timer_sessions`, logout, startup restore)
**Severity:** P1 (new/any account shows a huge fake running timer + inflated total; auto start/stop churn)
**Status:** ✅ FIXED (2026-06-23) — branch `fix/desktop-phantom-tracking-stale-local-session`

## Symptom (Windows, reported)
A freshly created account (`abdul.haseeb+qa@…`, **0 server entries**, no Redis timer) opened the desktop app and saw:
- "**Tracking 149:47:48**" by default, "total time tracked" **294:54:29**
- the project dropdown flashing 3 options for ~2s then vanishing
- the timer **auto-starting with no project selected**, then auto-stopping

The server DB for that user was **empty** — so every number was **local display garbage**, not real data.

## Root cause
`timer_sessions` (local-first SQLite, in `offline-queue.db`) has **no `user_id` column**, and `performLogout()` / `forceLogout()` **did not clear it**. So:
1. A previous account/session on that machine left an **open** `timer_sessions` row (`ended_at IS NULL`) — e.g. the app was killed without a clean stop.
2. On the next login (even a different, brand-new account), `getActiveLocalTimer()` (`SELECT * FROM timer_sessions WHERE ended_at IS NULL ORDER BY created_at DESC`) returns that stale row, and the phantom-stop/orphan-restore path adopts it as a **live timer**.
3. Elapsed = `now - started_at`, and `started_at` is hours/days old → **149h**. The startup-gap close keys off `lastActiveAt` (recent for the new login), not the session's `started_at`, so it didn't catch it. Reconcile/sync then churns (auto start/stop) because the server has no such entry.

(The dropdown flicker + empty "Select Project" + window-too-small are separate Windows-rendering issues — see "Still open".)

## Fix (`desktop/src/main/index.js`)
1. **`clearLocalTimerSessions()`** — `DELETE FROM timer_sessions`; called in **`performLogout()` and `forceLogout()`** so the next account starts with clean local timer state (current timer is stopped first; offline queue is already closed on logout).
2. **Stale-session guard in `getActiveLocalTimer()`** — if the open row's `started_at` is older than `MAX_PLAUSIBLE_OPEN_SESSION_MS` (24h) or non-finite, it is **closed (zero-duration) and not returned** as a live timer. Covers the killed-app / no-logout path (where clear-on-logout never ran) and any cross-account leftover. 24h is a safe ceiling — sleep/lock auto-stop + startup-gap close cap real sessions well under a day.
3. **Window size** 320×400 → **380×520** (cramped; on Windows fractional DPI the content could clip / the dropdown render empty).

## Immediate recovery for an already-affected install
The stale row is on the user's machine. Quit the app and delete (or clear) the local DB, then relaunch:
- Windows: `%APPDATA%\trackflow-agent\offline-queue.db`
- macOS: `~/Library/Application Support/trackflow-agent/offline-queue.db`
A build with this fix prevents recurrence.

## Still open (separate, Windows-specific — need Windows logs to pin)
- Project dropdown flashes then disappears (likely `loadProjects()` rebuilding `projectSelect.innerHTML` while the native dropdown is open — possibly retriggered by `projects-ready`/`refreshProjectsOnOpen`).
- "Select Project" button renders empty (no text) on Windows.
- Whether any event still auto-clicks Start (the `startBtn` guards `!projectId`, and the phantom "tracking" above explains most of it).
