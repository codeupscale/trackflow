# Desktop popup "Today, all projects" total frozen while tracking

**Status:** ✅ FIXED (2026-07-02, `fix/qa-build-1.0.41-dev.64-batch`) — QA build 1.0.41-dev.64, issue #1 (P1).

**Scope:** Desktop popup timer UI / project-time aggregation. `desktop/src/main/index.js`, `desktop/src/renderer/index-renderer.js`.

**Severity:** P1 — user-visible: the running session's time is not reflected in the all-projects total until the timer is stopped.

## Symptom

QA (Employee role): an extra line showing the total project time appears on the desktop popup. The value stays **stuck** while tracking and only updates to the correct total **after** the timer is stopped.

## Root cause

The secondary "Today, all projects" line renders `todayTotalGlobal`, which is the **server-synced sum of completed entries and EXCLUDES the currently running session**. It was only recomputed on timer start / stop / periodic sync, so during an active session it stayed frozen while the primary per-project timer ticked up. Data was never wrong — only the live display of the global total lagged until the running time was folded in at stop.

## Fix

The per-second tick in `startTrayTimer()` now also emits a derived live global total:

```
todayTotalGlobalLive = todayTotalGlobal + max(0, currentElapsed - _pendingOfflineReassignIdleSec)
```

- `currentElapsed` is derived from the local-first `started_at` anchor (source of truth; never overwritten), so the global total ticks in real time.
- The offline/idle-reassign correction term prevents double-counting time already accounted for elsewhere.
- The renderer prefers `todayTotalGlobalLive` when present and falls back to `todayTotalGlobal` for stop/sync/offline payloads that don't carry the live value.

Local-first timer architecture untouched; the fix is purely a display derivation, mirroring how the primary timer already derives elapsed from `started_at`.

## Key files

- `desktop/src/main/index.js` — `startTrayTimer()` per-second tick now emits `todayTotalGlobalLive`.
- `desktop/src/renderer/index-renderer.js` — renderer prefers the live value, falls back for non-tick payloads.

## Verification

- `cd desktop && npx jest` → 29 suites, 519/519 passing.
- Cross-platform: pure display/derivation change, no platform-specific branches touched (Win/macOS/Linux unaffected).
