# Desktop — offline heartbeats orphaned: infinite queue loop + lost activity

**Area:** Desktop offline queue + activity monitor (`offline-queue.js`, `activity-monitor.js`, `index.js`)
**Severity:** P1 (infinite retry loop / log spam / CPU + battery; offline activity lost)
**Status:** ✅ FIXED (2026-06-23) — drain-side: branch `fix/desktop-orphaned-heartbeat-queue-loop` (merged to `develop`); upstream replay + project refresh: branch `fix/desktop-offline-heartbeat-replay-and-project-refresh`

## Symptom
After an offline timer transition (e.g. disconnect → idle → reassign → reconnect), the desktop log spammed every 5 seconds, indefinitely:
```
[OfflineQueue] Holding heartbeat — entry not synced yet (entry=undefined)
[OfflineQueue] Flush starting — 55 items: {"heartbeat":55}
```
Observed live: **55 heartbeats stuck** with `time_entry_id = NULL` and `idempotency_key = NULL`. Coincided with `[TimerSync] API unreachable … ECONNABORTED`. No time-entry corruption (totals were correct), but the queue never drained and offline activity for the session was never recorded.

## Scope
Any session whose heartbeats are queued while there is no synced entry to anchor them — most reliably reproduced during the offline idle/reassign reconcile window (`[Reconcile] Skipping — timer state mutation already in progress`).

## Root cause (two layers)
1. **Drain side:** `OfflineQueue` flush was written to *hold* a heartbeat whose id is an unresolved `local-…` placeholder until its start syncs. An item with **no id at all and no idempotency_key** can never resolve, but it was *also* held — re-read and "held" every flush cycle forever (infinite loop, blocked queue). `desktop/src/main/offline-queue.js` heartbeat/screenshot drain branches.
2. **Upstream (real cause):** heartbeats are built and queued **without any `time_entry_id`**. Online that's fine — the server attaches the heartbeat to the running timer via auth — but the offline-replay endpoint needs a real id. The `ActivityMonitor` had no handle to the current entry (`new ActivityMonitor(apiClient, offlineQueue)`), so every offline heartbeat was unanchored. `desktop/src/main/activity-monitor.js` `_flushHeartbeat()` (queued `data` had no entry id).

## Fix
1. **Drain side** (`offline-queue.js`): add `_isUnresolvableOrphan()` — an item with neither a `local-…` id nor an `idempotency_key` can never resolve, so **drop it** (heartbeats + screenshots) instead of holding forever. `local-…` items are still held; real ids still pass through.
2. **Upstream** (`activity-monitor.js` + `index.js`): `ActivityMonitor.getCurrentEntryMeta` callback, injected from `index.js`, returns the live entry's `{ time_entry_id: _localId, idempotency_key }`. `_flushHeartbeat()` attaches it to the queued heartbeat, so `resolveServerEntryIdForQueue()` maps it to the server entry on replay (held until start syncs, then sent) instead of dropping it. When no timer is active the heartbeat has no anchor and is correctly dropped by (1).

Tests: `test/offline-queue.test.js` (orphan dropped vs `local-` held); `test/activity-monitor.test.js` (queued heartbeat anchored to entry id + idempotency_key; no anchor when no timer active).

## Recovery for already-stuck installs
The held orphans persist in `offline-queue.db`. A build **without** this fix keeps looping; clear them (or ship the fix and rebuild):
```sql
DELETE FROM queue WHERE type='heartbeat'
  AND json_extract(data,'$.time_entry_id') IS NULL
  AND json_extract(data,'$.idempotency_key') IS NULL;
```
