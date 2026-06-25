# Reconnect after idle-pause + offline reassign: duplicate entry + lost reassign (409)

**Status:** ✅ FIXED (2026-06-24, `develop`) — desktop-only (no backend change).

**Scope:** Desktop `reconcileTimerState()` ↔ idle pause ↔ offline queue flush.

**Severity:** P1 — creates a duplicate (overlapping) time entry AND drops a queued offline
reassign, so totals are both inflated (origin project) and missing (target project).

## Symptom (QA, mirza, 2026-06-25)

Sequence ending in: idle window → **internet off** → **Reassign to BladeOp** (offline) → internet
on → work 1 min → Stop. Expected Smart Card 10:01 / BladeOp 12:00. Got **Smart Card 23.6m /
BladeOp 6m**: a duplicate overlapping Smart Card entry (`08:18:43→08:26:44` and
`08:18:43→08:26:15`) and the BladeOp reassign missing entirely.

## Evidence (desktop `trackflow.log`)

```
08:25:42  [IDLE_ACTION] discard API failed: ENOTFOUND        ← offline reassign→Blade queued
08:26:15  [Reconcile] Server has no timer but local is running — pushing start   ← DUPLICATE
08:26:16  [OfflineQueue] idle_discard failed: 409  (×5)       ← reassign rejected
08:26:38  [OfflineQueue] Dropping item after 5 failed attempts (idle_discard)    ← reassign LOST
```

## Root cause

When the idle window appears, the desktop **pauses the server-side timer**
(`pauseTimerForIdle()` → `apiClient.pauseTimer()`), leaving the entry **open but paused**.

On reconnect, `reconcileTimerState()` took the push-start branch guarded by raw
**`!serverStatus.running`**. A paused timer has `running:false`, so reconcile concluded "server
has no timer" and **pushed a brand-new start** — creating the duplicate entry and changing the
Redis entry id. The queued offline reassign then flushed with the *original* `time_entry_id`,
which no longer matched Redis → **409 Conflict**, retried 5×, then **dropped** (reassign lost).

The codebase already had `isServerTimerOpen()` = running **OR** paused; the push-start branch
simply wasn't using it.

## Fix (desktop-only)

In `reconcileTimerState()`:
1. Push-start guard changed from `!serverStatus.running` to **`!isServerTimerOpen(serverStatus)`**
   — only push a new start when the server has neither a running nor a paused timer.
2. The adopt branch changed from `serverStatus.running` to **`isServerTimerOpen(serverStatus)`**
   so a paused entry is adopted (binds `currentEntry.id` to the real entry). The existing
   self-heal then resumes it, and the queued reassign now **matches** that entry (no 409) so the
   backend split applies and the idle block lands on the target project.

No backend change: this is purely the desktop's reconcile decision. (The backend closed-entry
split from bugs/idle-reassign-offline-stop-lost.md remains and is unaffected.)

## Verify

- `cd desktop && npm test` — full suite green (501). New invariants in
  `timer-sync-invariants.test.js`: paused server timer is OPEN → reconcile ADOPTS (never
  push-start); genuinely stopped → still pushes; the old raw `!running` guard would have
  duplicated.
- Manual: idle → offline reassign → reconnect → work → stop → exactly one entry per session, no
  duplicate, reassigned block on the target project; totals match.

## Key files

- `desktop/src/main/index.js` — `reconcileTimerState()` push-start + adopt branch guards
  (`isServerTimerOpen`), `isServerTimerOpen()`/`isServerTimerPaused()` helpers.
- `desktop/test/timer-sync-invariants.test.js`
