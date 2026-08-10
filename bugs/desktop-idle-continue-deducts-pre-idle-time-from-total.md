# "Continue tracking" deducts the pre-idle work from today's total

| | |
|---|---|
| **Area** | Desktop agent — display totals after the idle discard split (`session-rules.js` → `unsyncedCompletedSecondsForDay` / `completedSecondsForProjectDay`) |
| **Platform** | All |
| **Severity** | P1 — display only; no tracked time was ever lost |
| **Reported** | 2026-08-10 (owner) |
| **Status** | ✅ FIXED (2026-08-10) |

## Symptom

The idle alert appears, the user clicks **"Continue tracking"**, and a few seconds
later the tracked total **drops** by roughly the work done before going idle. The
timer then keeps counting up from that lower number. Up to ~10 minutes later the
total jumps back up on its own.

## What is NOT happening

Nothing is lost. Local SQLite — the sole source of truth for tracked time — holds
the correct rows the whole time, and the server ends up with the correct entries.
This is purely the number on screen, and it self-heals on the next session sync.

## Root cause

Two figures are combined to paint the total while a timer runs:

1. the SERVER's today-total, which sums **closed** entries and then adds the open
   entry's live `elapsed_seconds` — the desktop subtracts that elapsed back out,
   because its own 1s tick adds the LOCAL session's elapsed instead; plus
2. local completed rows the server has not seen, via
   `unsyncedCompletedSecondsForDay()` / `completedSecondsForProjectDay({unsyncedOnly:true})`.

Both of those helpers decided "the server has not seen this row" by testing
`server_entry_id == null`. That is the wrong question for exactly one row: the one
an idle discard closes.

Timeline (session 10:00, idle at 10:40, "Continue" at 11:00):

| | local SQLite | server |
|---|---|---|
| 10:10 | live row A pushed by the 10-min sync → gets `server_entry_id` | entry A **open** since 10:00 |
| 11:00 | A closed at 10:40 (40 min), row B opened at 11:00 | *unchanged — next push is up to 10 min away* |

At 11:00 `handleIdleAction` correctly credits A's 40 minutes to the in-memory total,
so the display does not jump at the click. Then the 10s status poll recomputes it:

- server `project_today_total` = other closed work + A's live elapsed (60 min)
- desktop subtracts `elapsed_seconds` (60 min) → A's contribution is fully removed
- `completedSecondsForProjectDay({unsyncedOnly:true})` **skips A**, because A has a
  `server_entry_id`

A's 40 minutes of real work therefore exist in neither term, and the total drops by
exactly the pre-idle span. It comes back only when the next 10-minute session sync
closes A server-side. The 10-minute upload cadence (owner decision, 2026-08-03) is
what widened this from invisible to a full sync interval of wrong numbers.

A second, smaller defect made the drop instant rather than 10s late: the split
credited `todayTotalCurrentProject` but not `todayTotalGlobal`, so the "Today, all
projects" line lost the pre-idle span the moment the user clicked, since the tick
adds the (now reset to 0) live elapsed on top of that base.

## Fix

`session-rules.js` — new pure helper `unconfirmedCompletedSeconds(row)`, used by both
display-total helpers. A completed row contributes when it is **DIRTY**
(`synced_revision <> revision` — the server has not acknowledged its current state),
and it contributes `duration_seconds − server_duration_seconds`, so a row the server
knows only partially can never be counted twice. `server_duration_seconds` is null
for a row acked while open (the sync endpoint echoes `duration_seconds` = null for an
open entry), which is precisely why row A now credits its full 40 minutes.

`index.js`:
- the idle discard credits `todayTotalGlobal` alongside `todayTotalCurrentProject`;
- `get-timer-state` now strips the server's live `elapsed_seconds` from the completed
  base exactly like the 10s poll does, and returns base + local elapsed for display.
  Without that, opening the popup counted the running session twice in the
  all-projects line until the next tick repainted it.

## Same-family defects found in the follow-up audit (all fixed here)

The rule "a server total read after a local mutation must add the local unconfirmed
seconds back on top, and strip the server's live elapsed" was applied inconsistently.
Every read path is now consistent:

1. **Post-stop refresh** (`stopTimer`) read `/timer/today-total`, a bare number that
   still contains the phantom-open entry's elapsed-to-now. Combined with the corrected
   local credit it would have counted the finished session twice — and on its own it
   left the total CLIMBING after Stop for up to 10 minutes. Now reads `/timer/status`
   and subtracts `elapsed_seconds`.
2. **10s poll, stopped branch** had the same overlap (`globalTotal + pendingOfflineSecs`
   with no subtraction). Fixed.
3. **Reconnect convergence** (`networkMonitor.on('online')`) assigned the raw server
   figure with no local credit at all — so coming back online after tracking offline
   made the total collapse to the server's view, the exact "appears to reset on
   reconnect" symptom the rest of the code guards against. Fixed.
4. **Local day boundary** used the MACHINE's midnight while the server buckets by the
   ORG timezone and the midnight split cuts at org midnight. For anyone whose machine
   zone differs from the org's, the local credit added rows from the wrong day. Now
   uses `startOfZonedDay(now, config.timezone)`.
5. **Sync poison-pill**: two open local rows (phantom stop → user starts again) make
   the server 422 the WHOLE batch, every cycle, forever — no tracked time uploads at
   all until a human intervenes. `getDirty()` now caps a batch at one open row
   (`limitToOneOpenSession`, keeping the newest).
6. **Sync starvation**: a permanently rejected row stays dirty by design (a rejection
   is never a licence to delete time). Ordered oldest-first, 100+ of them would sit at
   the head of every batch forever and newer sessions would never be reached.
   `getDirty()` now orders `attempts ASC, started_at ASC`; `markConfirmed` resets
   `attempts`, so a recovered row returns to its chronological place.

## Regression tests

`desktop/test/session-rules.test.js` → "counts a row synced while OPEN and since
closed locally" (day total and project total), "credits only what the server has not
already stored for a partially-known row", and the `limitToOneOpenSession` block.
`desktop/test/sync-cadence.test.js` → "stopping the timer does not double-count the
session it just closed".

## Related

- `bugs/desktop-idle-continue-still-bills-the-idle-gap.md` — the split instant itself
- `bugs/desktop-all-projects-total-resets-on-start.md` — same class: a server total
  read after a local mutation must add local unsynced seconds back on top
- `bugs/offline-first-time-sync-refactor.md` — the one-writer contract and the
  10-minute cadence this bug lives inside
