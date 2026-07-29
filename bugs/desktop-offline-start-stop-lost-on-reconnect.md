# Fully-offline start+stop session lost on reconnect (today total "resets")

**Status:** ✅ FIXED (2026-07-23, in working tree, uncommitted)
**Severity:** P1 — offline-tracked time silently disappears; employee loses worked hours
**Scope:** Desktop `index.js` timer sync loop (local-first timer)

## Symptom (user repro)

Turn OFF internet → Start tracking → Stop tracking (all offline) → turn ON internet.
The offline-tracked time is **not** synced to the server and the app's today total
**resets** — the offline session appears lost.

## Root cause

The local-first timer persists every start/stop to the SQLite `timer_sessions` table
BEFORE calling the API (`synced_start` / `synced_stop` flags, real `started_at`,
`idempotency_key`). A session created **and** stopped while offline is therefore stored
correctly (`synced_start=0, ended_at set, synced_stop=0`). Timer events are deliberately
**not** in the offline queue — the queue only carries heartbeats/screenshots/idle. Timer
sync flows exclusively through `timer_sessions` + `reconcileTimerState()`.

The defect: **a completed (stopped) offline session is flushed ONLY by
`reconcileTimerState()`, and reconcile was reliably driven only by the NetworkMonitor
`'online'` transition (or app startup).** That transition never fires in the exact repro:

- `NetworkMonitor` uses `net.isOnline()` (OS **interface** state, not server
  reachability). When the interface stays up but the server was unreachable — or the
  offline window is shorter than the 15s poll — `_isOnline` stays `true` the whole time,
  so no `'offline'` → no `'online'` event → **reconcile is never called**.
- The periodic 10s sync loop had **no** path for a *stopped* offline session: its
  orphan-recovery branch only handles *open* sessions (`getActiveLocalTimer()` filters
  `ended_at IS NULL`). So the completed session was never retried until the next app
  restart (startup reconcile).

**"Resets all time"** is a display overwrite, not data loss: on reconnect the 10s loop
set `todayTotalGlobal = status.today_total`, which excludes the never-synced session, so
the offline hours visibly vanished. The row survived in SQLite (recoverable on next
launch), but within the session it was never synced and the total read as reset.

## Fix (`desktop/src/main/index.js` + new `timer-session-sync.js`)

1. **Retry-until-synced driver.** The periodic 10s sync loop now, after a successful
   status fetch (server reachable), calls `scheduleReconcileAndFlush()` whenever
   `hasPendingCompletedOfflineSessions()` is true. This flushes any completed-but-unsynced
   session (start-pending OR stop-pending) every tick until it lands — independent of any
   NetworkMonitor `'online'` transition. Reuses the existing, tested reconcile Pass 1a/1b
   (POST start with real `started_at`+`idempotency_key`, then POST stop with
   `started_at`/`ended_at`); idempotency keys make retries safe.
2. **Display preservation.** The today-total now adds
   `getUnsyncedCompletedSecondsForToday()` — the seconds of completed sessions the server
   doesn't know about yet (`synced_start=0`, started today) — so the offline time stays
   visible instead of resetting to the server value while the retry loop catches up. Only
   `synced_start=0` rows are added (double-count guard: once the start syncs, the server
   total owns it).
3. Decision logic extracted to pure, unit-tested `timer-session-sync.js`
   (`isPendingCompletedSession`, `hasPendingCompletedSession`,
   `unsyncedCompletedSecondsForDay`) — index.js does the SQLite read and delegates.

Note on the user's suggested schema (`mode` offline/online, `syncedToServer` yes/no): the
existing `synced_start` / `synced_stop` columns already ARE the "synced to server" flags,
and every local-first session is written locally first, so the real missing piece was the
periodic retry driver + the display, not new columns. No schema change was needed.

## Tests

- New `desktop/test/timer-session-sync.test.js` (14 tests): fully-offline completed
  session detected as pending + counted; start-synced/stop-pending pending but not
  double-counted; open/synced/prior-day sessions excluded; malformed-row safety.
- Full desktop suite green (627 tests).

## Not the bug (ruled out during R&D)

- The offline **queue** 404-on-stop theory: timer events aren't queued anymore
  (`offline-queue.js` only handles heartbeat/screenshot/idle), so it never applied.
- Backend already supports offline backfill: `POST /timer/start` (idempotency_key +
  `started_at`) and `POST /timer/stop` (`started_at`/`ended_at`); 404-on-stop is treated
  as already-synced. The failure was purely that the desktop never initiated the calls.

## Key files

- `desktop/src/main/index.js` (sync loop display + retry driver; `timer_sessions` helpers)
- `desktop/src/main/timer-session-sync.js` (new, pure logic)
- `desktop/test/timer-session-sync.test.js` (new)

## Follow-up (2026-07-24) — the retry driver truncated a live timer after stop→start

The retry driver above had a sharp edge that the "retry every 10s" cadence turned from a
rare race into a reliable loss. **Repro:** a session A whose START never confirmed
server-side (`synced_start = 0` — a transient start-POST failure, even while "online") is
stopped; the user starts a new session B. B is now the open server timer.

`reconcileTimerState()` **Pass 1b** creates A by pushing its start via `POST /timer/start`.
The server's `startWithMeta()` enforces one-open-timer-per-user via a partial unique index,
so it **auto-stops whatever timer is currently open (B)** before creating A — truncating B
to `[Bstart … reconcile-time]` and losing the rest. The desktop keeps ticking B locally
(reconcile's status snapshot predates the close), so current + total look fine while the
server has already lost B — exactly "the new time entry gets lost after stop→start". The
new drain (`hasPendingCompletedOfflineSessions()` → `scheduleReconcileAndFlush()` every
10s) made this fire continuously while B was live. Pre-existing mechanism; new amplifier.

**Fix:** never push a historical `synced_start = 0` start while a timer is live — it would
auto-stop it.
- `reconcileTimerState()` Pass 1b now skips `!synced_start` sessions when
  `isTimerRunning || isTimerPaused` (defers them; the row stays local and syncs on a later
  reconcile once no timer is open). Pass 1a (stop-only, `synced_start = 1`) is unaffected —
  it targets a specific entry and never auto-stops.
- The 10s drain trigger is gated on `!isTimerRunning && !isTimerPaused` so it no longer
  drives reconcile while a timer is live (its time still shows via the pending-offline
  total until it syncs).

Deferred sessions are never lost: their `timer_sessions` row persists and is flushed the
next time reconcile runs with no open timer (e.g. right after the live timer stops).

**Optional server hardening (not done):** `TimerService::startWithMeta` could create a
CLOSED historical entry (when the start carries both `started_at` and an `ended_at`)
without auto-stopping the open timer — a defence-in-depth for any client that pushes a
backfill start while a timer runs. `backend/app/Services/TimerService.php:172-207`.

Full desktop suite green (627).
