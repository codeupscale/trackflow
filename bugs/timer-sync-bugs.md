# Timer Sync Bugs

**Status:** ✅ FIXED 2026-06-16 (on branch `chore/desktop-electron-42-upgrade`, uncommitted) — verified by tests, not yet committed.
**Investigated:** 2026-06-15
**Scope:** Desktop agent (Electron) ↔ Laravel backend timer sync
**Overall verdict:** Architecture (local-first timing) is correct. These were implementation
defects in the sync layer. Targeted repair, NOT a redesign.

## Resolution summary (2026-06-16)

A shared start/stop contract was implemented backend-first, then matched on the desktop:

- **`POST /timer/start`** now accepts & honors `started_at` (real local start, validated to ±skew),
  so offline-started timers no longer get stamped at reconcile time. Idempotency lookup scoped to
  OPEN entries; duplicate-open insert (DB unique-index 23505) caught → returns existing entry as 200
  (no more uncaught 500). Redis lock TTL 5s→15s. (BUG 1, BUG 3)
- **`POST /timer/stop`** now binds to a specific `time_entry_id` (never "latest open"), validates
  offline `started_at`/`ended_at` against the entry + skew, rejects reversed intervals (no more
  `abs()` masking), and is idempotent on already-closed entries. (BUG 1, BUG 3)
- **Desktop**: sends `started_at` on every start/reconcile and `time_entry_id` on every stop (404 =
  already-synced); added `_stopTimerInProgress` mutex + a shared reconcile/sync-loop state mutex;
  the sync loop/startup no longer overwrite the local `started_at` anchor (never jumps forward);
  clock-skew applied consistently (display matches stored); `reconcileTimerState()` runs on startup. (BUG 2, BUG 3)

**Tests:** backend timer suite 76→91 (+15); desktop 397→410 (+13). No new failures. Cross-platform
safe (no `process.platform` branches changed). Files: `backend/app/Services/TimerService.php`,
`backend/app/Http/Controllers/Api/V1/TimerController.php`, `desktop/src/main/api-client.js`,
`desktop/src/main/index.js`. New tests: `backend/tests/Feature/Timer/TimerSyncTest.php`,
`desktop/test/timer-sync-invariants.test.js` (+ additions to timer-start/stop tests).

---

## Original report (for reference)

---

## Reported symptoms

1. On weak / inconsistent internet, the timer **logs wrong durations**.
2. The timer **sometimes shows incorrect time**.
3. A **new timer session clashes with an old session**.

How local-first is *supposed* to work: the desktop app records the real start time in its local
SQLite DB, the timer keeps running even when offline, and on reconnect it tells the server the
real start/end timestamps. The server is supposed to trust those timestamps. The bugs below break
that contract at specific points.

---

## BUG 1 — Weak internet logs wrong durations

**Symptom:** Time started while offline loses hours when the network returns.

**Root cause (P0):** The desktop records the real local `started_at`, but the start-sync code
does **not send it**, and the server endpoint does **not accept it** — the server stamps
`started_at = now()` at reconcile time. Example: start offline at 09:00, network returns at 11:00,
server records the start as 11:00. Two hours vanish.

**Evidence:**
- `desktop/src/main/api-client.js:174-181` — `startTimer()` sends only `{ project_id, idempotency_key }`, no `started_at`.
- `backend/app/Http/Controllers/Api/V1/TimerController.php:17-26` — validation/`$request->only(...)` excludes `started_at`.
- `backend/app/Services/TimerService.php:154` — `'started_at' => now()` hardcoded on create.
- Reconcile start pass: `desktop/src/main/index.js:2317-2327`, `2339-2342`.

**Secondary contributors:**
- Clock-skew (`_clockOffsetMs`) is applied to the *display* but not to *stored* timestamps, and is
  only learned after the first reconcile. A skewed system clock writes skewed timestamps.
  (`desktop/src/main/index.js:2091`, `2187`, `2288`, `2586-2587`.)
- Backend offline-stop can overwrite `started_at` of the *wrong* open entry — it picks
  `latest('started_at')` with no entry-id binding, then rewrites both start and end.
  (`backend/app/Services/TimerService.php:231-256`.) Only validation is "timestamps in the past" +
  a 12h clamp (`MAX_ENTRY_DURATION = 43200`, line 28) — no check the timestamps belong to *this* entry.
- Duration math uses `(int) abs(...->diffInSeconds(...))` everywhere, which masks reversed/negative
  intervals instead of rejecting them. (`TimerService.php:99,133,247,314,397,657,674`.)

**Recommended fix (P0):** Send local `started_at` on every start sync; make the server accept and
honor it. Bind offline-stop to a specific `time_entry_id` and validate override timestamps against
the entry's bounds + a max-skew window. Replace `abs()` masking with explicit chronology validation.

---

## BUG 2 — Timer sometimes shows incorrect time

**Symptom:** Displayed elapsed time jumps backward / resets mid-session.

**Root cause (P1):** Every ~10s the desktop sync loop (and focus/unlock/startup syncs) adopt the
server's state and overwrite the local display anchor `_cachedStartedAtMs`. Because Bug 1 makes the
server's `started_at` wrong (= reconcile-moment `now()`), the visible timer jumps to a smaller value
after one sync cycle. This is the most user-visible manifestation of Bug 1.

**Evidence:**
- `desktop/src/main/index.js:2477-2487` — 10s interval adopts `status.entry`, sets `_cachedStartedAtMs = new Date(server started_at)`.
- `desktop/src/main/index.js:1225-1234` — focus/unlock immediate sync, same overwrite.
- `desktop/src/main/index.js:1056-1060` — startup, same overwrite.
- `desktop/src/main/index.js:2379-2390` — reconcile "earlier started_at wins" can adopt wrong side due to skew + Bug 1.
- `desktop/src/main/index.js:2586-2588` — tray adds offset-corrected "now" to a non-offset-corrected today-total baseline (double-applies skew).

**Backend contributors:**
- `status()` / `todayTotal()` add live elapsed computed from an entry's `started_at` even when the
  entry may be closed or its `started_at` was rewritten. (`backend/app/Services/TimerService.php:503`, `576`.)
- Idle-reassign + switch-project can create overlapping tracked intervals that get summed → today
  total too high. (`TimerService.php:556-567`, `697-710`, idle-split idempotency guard at `647`.)

**Recommended fix (P1):** While a local session with an earlier/equal start is running, treat the
local `started_at` as immutable — do not let the sync loop overwrite it. Apply clock-skew correction
consistently (both stored + display, or neither). Consolidate clock offset into `AppState`.

---

## BUG 3 — New session clashes with old session

**Symptom:** Starting a new timer corrupts/kills it, or it won't start, because a stale old session
interferes. Most serious bug.

### Desktop side

**Root cause (P0):** When syncing an old finished session, the "stop" command does not say *which*
session to stop. The backend closes "the latest open entry" — which may be the brand-new running
session — and applies the OLD session's timestamps to it.

**Evidence:**
- `desktop/src/main/index.js:2303-2306`, `2322-2325` — reconcile stop sends `{started_at, ended_at}` with **no entry id**.
- `backend/app/Services/TimerService.php:224-273` — stop reads Redis `timer:{user_id}`; if missing, closes the latest open DB entry and applies caller's timestamps.
- `desktop/src/main/index.js:2167` — `stopTimer()` has **no concurrency mutex** (compare `startTimer` guarded by `_startTimerInProgress` at `2042-2052`). User stop, auto-stop, idle stop, and sync-loop stop can interleave.
- Stop has **no idempotency key** (`api-client.js:183-188`), so a stop whose response was lost on weak network gets replayed against whatever is now the latest open entry — i.e., the new session.
- Startup (`index.js:1051-1074`) adopts server state but never calls `reconcileTimerState()` or checks `getActiveLocalTimer()`, so an unsynced local session can sit and collide later.

### Backend side

**Root cause (P0):** A DB partial unique index prevents two open timers per user, but **no code
catches the violation** — duplicate start crashes with HTTP 500, and the desktop retries forever.

**Evidence:**
- `backend/database/migrations/2026_04_10_000001_add_unique_open_timer_constraint.php:62-68` — partial unique index `idx_one_active_timer_per_user`.
- `backend/app/Http/Controllers/Api/V1/TimerController.php:37` — only catches `\RuntimeException`; a `QueryException` (SQLSTATE 23505) escapes as 500.
- `backend/app/Services/TimerService.php:54-63` — idempotency lookup has **no `whereNull('ended_at')`**, so it can return an already-closed entry as `is_existing=true`; the desktop then ticks against a dead server entry.
- Redis lock TTL is only 5s (`TimerService.php:75`, `290`); the critical section includes an unbounded `computeFinalActivityScore()` query (`833`) and can exceed it under load, dropping the mutex.
- `switchProject()` (`TimerService.php:358-436`) has no DB orphan fallback and creates entries with no idempotency key.

**Recommended fix (P0):**
1. Catch `Illuminate\Database\QueryException` / SQLSTATE `23505` in `start` (and `switch`); resolve gracefully by returning the existing open entry as 200.
2. Make stop target a specific entry id; add a stop idempotency key the reconcile passes.
3. Add a `_stopTimerInProgress` mutex symmetric to start; share one mutex between `reconcileTimerState` and `startTimerSync`.
4. Scope idempotency lookup to open entries (`whereNull('ended_at')`).
5. Lengthen/renew the Redis lock or move the unbounded query out of the critical section.
6. Call `reconcileTimerState()` once on startup before adopting server status.

---

## Not a contributor (checked, ruled out)

- **Timezone storage** is consistently UTC: Postgres `timestamp` columns
  (`backend/database/migrations/0001_01_01_000007_create_time_entries_table.php:17-18`), `datetime`
  casts, `now()`/`Carbon::parse()` writes, `userTodayUtcBounds()` for "today" scoping. Not a cause.

---

## Fix priority summary

| # | Fix | Where | Severity | Bug |
|---|-----|-------|----------|-----|
| 1 | Send local `started_at` on start-sync; server accepts & honors it | desktop api-client + backend start | P0 | 1, 2 |
| 2 | Catch duplicate-timer DB error (23505); return existing session, not 500 | backend TimerController | P0 | 3 |
| 3 | Stop targets a specific session id; add stop mutex + stop idempotency key | desktop + backend stop | P0 | 3 |
| 4 | Sync loop must not overwrite local time while local session is source of truth | desktop index.js | P1 | 2 |
| 5 | Scope idempotency lookup to open entries only | backend TimerService | P1 | 3 |
| 6 | Apply clock-skew consistently; reconcile on startup | desktop | P1/P2 | 1, 2 |

**Key files:**
- `desktop/src/main/index.js` — startTimer (2042), stopTimer (2167), reconcileTimerState (2273), startTimerSync (2425), immediate sync (1207), startup restore (1051)
- `desktop/src/main/api-client.js` — startTimer (174), stopTimer (183)
- `backend/app/Services/TimerService.php` — start (45), stop (198)
- `backend/app/Http/Controllers/Api/V1/TimerController.php` — start (15), stop (43)
