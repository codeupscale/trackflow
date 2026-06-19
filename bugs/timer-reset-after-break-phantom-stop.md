# Timer Resets to Zero After Break (Jummah / Lunch / Sleep)

**Status:** ✅ FIXED 2026-06-19 (develop)
**Severity:** P0 — reported by multiple Windows production users; likely all OS builds
**Scope:** Desktop agent timer display + backend `/timer/status`

## Symptom

Developers start tracking in the morning (e.g. 11:00 Pakistan time), leave for a long break
(Jummah prayer, lunch, lid-close), return on poor internet, and the timer **shows ~00:00:00**
as if they just started — hours of tracked time appear lost on the desktop popup/tray.

## Root causes (two bugs, often combined)

### 1. Backend: `/timer/status` ignored open DB entries when Redis cache was missing

`TimerService::status()` returned `running: false` whenever the Redis key `timer:{user_id}`
was absent — even if PostgreSQL still had an **open** `time_entries` row.

On poor internet / Redis restarts / cache eviction, the desktop 10s sync loop and
`get-timer-state` IPC saw "server stopped" and **cleared in-memory timer state** while
SQLite still held the real `started_at` from 11:00.

**Evidence:** `backend/app/Services/TimerService.php` — old `status()` returned early at
`if (!$timerData) { return ['running' => false, ...]; }` with no DB fallback.

### 2. Desktop: `get-timer-state` IPC bypassed local-first invariants (BUG 2 regression)

Opening the timer popup after a break calls `syncTimerState()` → `get-timer-state`.
That handler **directly overwrote** `_cachedStartedAtMs` with the server's `started_at`
instead of using `adoptServerStartedAt()` and the local SQLite anchor.

When the server had a later/wrong `started_at` (or phantom-stopped), the display jumped
backward to near-zero. It also cleared local running state on `running: false` even when
SQLite still had an open `timer_sessions` row.

**Evidence:** `desktop/src/main/index.js` — old `get-timer-state` handler (~L2017–2064).

### Contributing factors (not bugs — expected behavior users may misread)

| Factor                                                          | What happens                                                                                                                                                                                             |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Idle auto-stop** (`idle_alert_auto_stop_min`, default 10 min) | User away for Jummah → idle alert → no response → timer **stops**. Clicking Start again begins a **new session** at 0:00 for the current segment; today's completed total should still show prior hours. |
| **Idle discard / sleep discard**                                | Long sleep ≥ idle threshold → idle split → new entry `started_at = now()`. Pre-idle time is kept in `todayTotalCurrentProject` (FIX D5) unless the idle API failed on poor network.                      |
| **Old production builds**                                       | Pre–timer-sync-fix builds did not send `started_at` on offline reconcile (see `bugs/timer-sync-bugs.md`). Users on stale installers lose hours on reconnect.                                             |

## Fix (2026-06-19)

**Backend**

- Added `findOpenRunningEntry()` — resolves open timer from Redis **or** DB, repairs Redis when found.
- `status()` and `todayTotal()` now use this helper instead of Redis-only lookup.
- Test: `TimerSyncTest::test_status_falls_back_to_db_when_redis_key_missing`.

**Desktop**

- Added `applyRunningStatusFromServer()`, `restoreInMemoryFromLocalActive()`,
  `shouldPreserveLocalRunningWhenServerStopped()`, `scheduleReconcileAndFlush()`.
- `get-timer-state` now mirrors startup/sync-loop local-first rules (BUG 2 anchor + phantom-stop guard).
- 10s sync loop restores orphaned SQLite sessions when in-memory state was phantom-cleared.
- Test: `timer-sync-invariants.test.js` — phantom-stop recovery describe block.

## Verification checklist for affected users

1. Confirm desktop build includes timer-sync fixes (check About → version / git SHA).
2. After break on poor internet: tray/popup should resume from 11:00 anchor, not 00:00.
3. If timer was **auto-stopped** during break: today's total (stopped view) should still show ~1–2h;
   clicking Start begins a new segment at 0:00 — that is correct.
4. Collect `%LOCALAPPDATA%\TrackFlow\trackflow.log` (Windows) if issue persists.

## Key files

- `backend/app/Services/TimerService.php` — `findOpenRunningEntry()`, `status()`, `todayTotal()`
- `desktop/src/main/index.js` — `get-timer-state`, `startTimerSync()` orphan recovery
- `bugs/timer-sync-bugs.md` — related offline `started_at` sync fixes
