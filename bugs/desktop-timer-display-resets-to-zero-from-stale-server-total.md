# Desktop — project timer display starts/resets to 00:00 instead of the day's total

**Area:** Desktop agent — today-total display
**Severity:** P1 (display looks like tracked time was lost, even though it wasn't)
**Status:** ✅ FIXED (2026-08-03, `develop`)

## Symptom

QA: "whenever the tracker app starts tracking it always starts from 0 — it should be
`Max(0, that project's total time tracked locally)`." A project that already had hours
today showed the running display counting up from 00:00, not from the accumulated total.

## Background — the display model is already correct

The main running display is `todayTotalCurrentProject + live elapsed`
(`index.js` tray label ~`2638`, get-timer-state ~`3561-3563`). The live elapsed is 100%
local (tray tick from the local SQLite session start). So the design already counts up
from the project's completed base — the bug was purely that **the base
(`todayTotalCurrentProject`) collapsed to 0**.

## Root cause — two places read a stale server total without adding local-unsynced time

Uploads are batched every 10 minutes (local-first architecture). A server total read
right after a local mutation therefore does NOT yet include completed work still queued
locally. CLAUDE.md states the invariant: *anything that reads a server total right after
a local mutation MUST add `getUnsyncedCompletedSecondsForToday()` on top.* The
all-projects path obeyed it; the **project-scoped path did not**:

1. **10s status poll** (`index.js:~4640`): while running,
   `todayTotalCurrentProject = Math.max(0, projectTotal - elapsed)` — the sibling
   `todayTotalGlobal` line adds `pendingOfflineSecs`, but this line added nothing. So a
   few seconds after Start the poll **overwrote the good local seed** with a
   server figure missing all still-unsynced project time → often 0.
2. **`applyTotalsFromServerStatus()`** (`index.js:~1187`, runs on window-focus and
   startup): same omission — focusing the window mid-session collapsed the project total
   to the (≤10-min-stale) server figure.

The Start seed itself (`index.js:~3978`) also fell through to a local-only total that is
0 when local rows were purged or a prior tick never populated `_serverProjectTodayTotals`.

## Fix (owner decision: local-authoritative blend)

- **Seed at Start** = `Math.max(seedFromLocal, seedFromServer+localUnsynced, 0)` — never
  below what this device already has locally, so it can't restart at 00:00.
- **Both recompute paths** now add this project's unsynced-local completed seconds on top
  of the server figure (`getLocalCompletedSecondsForProjectToday(projectId,
  {unsyncedOnly:true})`), exactly like the global line.

Result: the display never shows less than locally-tracked time, while still folding in
manual entries + other-device time from the server (which are the only reason the server
figure is read at all).

## Verification

- Full desktop suite green (766 tests).
- Manual: track → stop → start same project within the sync window; display resumes
  from the accumulated total, and focusing the window mid-session no longer snaps it to 0.

## Related

- [[desktop-all-projects-total-resets-on-start]] — the all-projects analogue.
- [[desktop-project-total-resets-on-timer-start]], [[desktop-project-total-frozen-while-tracking]].
