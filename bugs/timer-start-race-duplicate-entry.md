# 1-second duplicate entry at timer start (start vs reconcile race)

**Status:** ✅ FIXED (2026-06-25, `develop`) — desktop-only.

**Scope:** Desktop `startTimer()` ↔ `TimerSync` poll ↔ `reconcileTimerState()`.

**Severity:** P3 — a 1-second overlapping duplicate entry at start; cosmetic double-count, no
time lost.

## Symptom

On a fresh Start, two BladeOp entries appear with the same start time — the real one plus a
~1-second straggler that overlaps it (`09:14:33→09:15:33` and `09:14:33→09:14:34`).

## Root cause (desktop log)

```
09:14:33.906  [Timer] Local start recorded: local-…  key=8c1e8a40
09:14:33.913  [TimerSync] Server says stopped but local start is unsynced — driving reconcile
09:14:34.086  [Reconcile] Pushing unsynced local start to server     ← push #1 (reconcile)
09:14:34.307  [afterStartTimer] Running for entry=019efe0f…          ← push #2 (startTimer itself)
```

`startTimer()` writes the local start, then calls the API. In the ~150ms before that call lands,
a `TimerSync` tick sees "server stopped, local start unsynced" and drives `reconcileTimerState()`,
which **also** pushes the same start. The idempotency key didn't dedupe within that race window →
two server entries.

## Fix

`reconcileTimerState()` now early-returns while **`_startTimerInProgress`** is set — `startTimer()`
is mid-flight and will create and sync the entry itself, so reconcile must not push it too. This
closes the window where both paths create an entry.

## Verify

- `cd desktop && npm test` — full suite green (504). New invariants in
  `timer-sync-invariants.test.js`: reconcile defers while startTimer is in flight.
- Manual: Start the timer repeatedly → exactly one entry per start, no 1-second overlap.

## Key files

- `desktop/src/main/index.js` — `reconcileTimerState()` `_startTimerInProgress` guard.
- `desktop/test/timer-sync-invariants.test.js`
