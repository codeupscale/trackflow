# Offline reassign LOST when the timer is stopped before the queue flushes

**Status:** ✅ FIXED (2026-06-24, `develop`)

**Scope:** Desktop offline queue ↔ backend `TimerService::reportIdle()`.

**Severity:** P1 — silently loses time attribution: a reassigned idle block stays on the
original project instead of the chosen one.

## Symptom (QA, mirza, 2026-06-24)

Sequence: tracked BladeOp → idle → **internet off** → **Reassign to Smart Card** → internet on →
worked 1 min → **Stop**. Expected BladeOp 8m / Smart Card 13m; got **BladeOp 15m / Smart Card 6m**.
The offline reassign never landed — its ~7 min stayed on BladeOp.

## Evidence (desktop `trackflow.log`)

```
15:24:42  [IDLE_ACTION] discard API failed: getaddrinfo ENOTFOUND   ← offline reassign queued
15:25:40  (timer stopped by user)
15:25:55  [OfflineQueue] Flush starting — 4 items: {idle_discard:1, ...}
15:25:55  [OfflineQueue] Dropping queued idle_discard — no active local timer (timer was stopped)
```

DB confirmed: one continuous BladeOp entry `15:17:40→15:25:40` (8m), no idle split, no Smart Card
reassigned entry.

## Root cause

The offline reassign is queued as `idle_discard` (payload carries `action: reassign`,
`project_id`). The reconnect flush ran ~15s **after** the user stopped the timer. Two layers then
conspired to drop it:

1. **Desktop (FIX D3 guard):** `offline-queue.js` dropped the item when `isLocalTimerActive()` was
   false ("don't resurrect a stopped timer") — discarding the reassignment data entirely.
2. **Backend:** even if sent, `reportIdle()` no-ops when the timer is stopped (Redis empty), so it
   could not split the now-closed entry.

The earlier offline-reassign test passed only because the timer was **not** stopped before the
flush.

## Fix (defense in depth)

- **Backend — `TimerService::reportIdle()`** now handles the stopped case via
  `reportIdleOnStoppedTimer()`: when Redis is empty but the payload's `time_entry_id` points to a
  **closed** entry containing the idle window, it splits that entry in place — shorten to
  idle-start, create the idle audit, create the reassigned entry on the target project, and
  re-close the post-idle remainder on the original project — **without** opening a running timer
  (`new_entry` = null). Idempotent: a replay finds the entry already shortened and no-ops.
  Screenshots are re-homed to the idle/remainder entries.
- **Desktop — `offline-queue.js`** no longer drops a queued reassign/discard when the timer is
  stopped; it sends it so the backend can apply the closed-entry split, and re-anchors **only**
  when `new_entry` is returned (the still-running case). A stopped timer stays stopped.

## Verify

- Desktop: `cd desktop && npm test` — full suite green (496); `offline-queue.test.js` updated to
  assert "timer stopped before flush → STILL sends reassign, no re-anchor".
- Backend: `tests/Feature/Timer/TimerServiceTest.php::test_report_idle_reassign_on_stopped_timer_splits_closed_entry`
  (runs in CI / Docker test DB) — asserts closed-entry split, closed remainder, no Redis
  resurrection, and idempotent replay.
- Manual: reassign offline → reconnect → stop → the reassigned project gets the full idle block;
  totals match.

## Key files

- `backend/app/Services/TimerService.php` — `reportIdle()` stopped-timer branch + `reportIdleOnStoppedTimer()`
- `desktop/src/main/offline-queue.js` — `idle_discard` flush no longer drops on stopped timer
- `desktop/test/offline-queue.test.js`, `backend/tests/Feature/Timer/TimerServiceTest.php`
