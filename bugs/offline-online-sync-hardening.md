# Offline ↔ online sync hardening (data loss, timer resurrection, inflation)

**Status:** ✅ FIXED (2026-06-22, `develop`)

**Scope:** Desktop agent (sync/idle/screenshots/heartbeats/power) + backend timer/idle/cleanup.

**Severity:** P0–P1 cluster — pre-release audit of network drop→recover paths.

## How found

After a string of related local-first defects this session, a focused 3-way audit (desktop
sync, desktop idle, backend timer/idle) of every online↔offline transition. Findings below were
fixed as one batch. Product decisions: **preserve up to ~3–4h of offline work** (`config('timer.offline_grace_minutes', 240)`); **a tracked timer requires a project** (already enforced client-side).

## P0

1. **Cleanup truncated legitimate offline work.** `CleanupStaleEntries` (30 min) force-closed
   tracked entries with no *server-received* heartbeat — but offline desktops queue heartbeats
   and flush on reconnect, so long offline sessions were truncated and the real `ended_at`
   discarded (`stopWithMeta` returned `already_stopped`).
   **Fix:** threshold → `offline_grace_minutes` (240); `CloseStaleTimerEntriesJob` backstop
   raised to grace+margin (+ job reliability `$tries/$timeout/backoff/failed()`);
   `stopWithMeta` now **extends** an early-closed entry when a later in-skew `ended_at` arrives
   (`extendClosedEntry()`, forward-only, re-checked under lock) — no offline work lost.
   Files: `CleanupStaleEntries.php`, `CloseStaleTimerEntriesJob.php`, `TimerService.php`, `config/timer.php`.

2. **Offline idle reassign/discard flush left a timer open forever / resurrected stopped
   timers.** The offline `idle_discard` replay ignored the server's `new_entry`, so the desktop
   stayed anchored to the now-split/closed entry; the server kept a new entry open and elapsed
   inflated; a timer stopped before the flush could resurrect.
   **Fix (desktop):** `offline-queue.js` captures `reportIdleTime`'s `new_entry` and calls
   `onIdleReanchor()` → `reanchorFromOfflineIdle()` (same re-anchor as the online path: close
   stale local session at idle-start, open new local session at `new_entry.started_at`, rebind
   screenshots), and **drops** the queued item when no local timer is active (anti-resurrection).
   **Fix (backend):** `reportIdle` is now an idempotent no-op when the target entry is already
   closed (never re-opens/shrinks/duplicates). Files: `offline-queue.js`, `index.js`, `TimerService.php`.

## P1

3. **Offline heartbeats dropped (422).** Queued heartbeats carried no `time_entry_id`; the
   replay endpoint required it → whole batch 422 → all offline activity lost.
   **Fix:** desktop resolves each queued heartbeat's `local-…` id to the synced `server_entry_id`
   (holds it until the start syncs) before sending; `/agent/logs` made tolerant — `time_entry_id`
   nullable, attributed to the user's entry open at `logged_at` (org-scoped), unattributable logs
   skipped not 422'd. Files: `offline-queue.js`, `index.js`, `AgentController.php`.

4. **Screenshots bound to `local-…` id.** Offline-start screenshots used the placeholder id →
   422 → dropped; reconcile never rebound the screenshot service, so even post-reconnect live
   captures kept the stale id all session.
   **Fix:** `screenshotService.rebindEntryId(serverId)` called from reconcile when the active
   session's start syncs; offline screenshot flush resolves `local-…` → server id before presign.
   Files: `screenshot-service.js`, `index.js`, `offline-queue.js`.

5. **`keep` while offline left the server paused.** Idle pause hit the server; the matching
   resume on `keep` was best-effort and swallowed offline → server stuck `paused` → next sync
   re-paused the UI (frozen timer) and skewed totals.
   **Fix:** self-healing reconcile branch — if server `paused` but local running-not-paused,
   replay idempotent `resumeTimer()`. File: `index.js`.

6. **`processHeartbeat` mutated closed entries.** No `ended_at` guard → a flushed heartbeat
   created ActivityLogs on a closed entry, corrupted `activity_score`, and stamped
   `logged_at = now()` (not capture time).
   **Fix:** resolve entry `whereNull('ended_at')` (reject if closed); accept validated client
   `logged_at`/`captured_at`. File: `TimerService.php`, `TimerController.php`.

7. **`reportIdle` had no timestamp skew bounds.** Offline idle replay opened the post-idle
   entry in the past → dead-tail inflation (the bug just fixed for `closeStaleOpenTimer`,
   reintroduced).
   **Fix:** route idle timestamps through `parseClientTimestamp`; clamp the new running entry's
   `started_at` to now when `idle_ended_at` is stale. Files: `TimerService.php`, `TimerController.php`.

8. **Orphaned idle detector on power stop.** Power auto-stop stopped the timer but left the
   idle detector in `ALERTING` → spurious auto-stop on wake.
   **Fix:** `stopTimer()` tears down the detector deterministically; `power-manager` gained an
   `onSuspendCleanup` hook (stop detector + dismiss alert) that runs even on the timer-not-running
   path. Files: `index.js`, `power-manager.js`.

## Follow-up fix — stale tray (menu-bar) time after an out-of-band stop

**Symptom:** after the timer stopped out-of-band (server entry deleted/removed, or stop synced
from the web) the popup correctly showed `00:00:00`, but the macOS **menu-bar tray** stayed
frozen at the old running time (e.g. `01:01:01`).

**Root cause:** the tray-timer interval (`startTrayTimer`, `index.js`) did
`if (!isTimerRunning || !_cachedStartedAtMs) return;` — so once `isTimerRunning` flipped false
out-of-band, the interval kept firing but only `return`ed, leaving the **last-rendered
`setTrayText` value frozen** in the menu bar. `stopTrayTimer()` also only clears the interval,
never the text.

**Fix:** when the interval detects `!isTimerRunning`, it now refreshes the tray to the stopped
state (`updateTrayTitle()`) and stops ticking — so the menu bar can never be left showing a
frozen running clock, regardless of which teardown path (or data removal) stopped the timer.
Self-heals within ~1s on the next tick. (Requires a new desktop build; an already-running stuck
instance clears on restart.)

## Deferred (P2/P3, tracked — not in this batch)

Out-of-order offline stop-before-start ordering; idempotency key burned after entry close
(replayed start can mint a duplicate); `_idleAlertShownAt` reset on alert re-show; missing
mutation guard on `triggerImmediateSync`/`get-timer-state` IPC. Lower severity; queued for a
follow-up.

## Verify

- Desktop: `cd desktop && npm test` → 480/480 (14 new in offline-queue / screenshot-service /
  power-sleep tests).
- Backend: `php artisan test --filter='TimerOfflineCorrectnessTest|AgentBulkLogsTest'` → 16/16.
  (5 unrelated pre-existing timer-test failures remain; this batch adds none.)
