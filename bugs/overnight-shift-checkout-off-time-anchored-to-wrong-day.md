# Overnight shift: checkout off-time anchored to the wrong day

**Area:** Backend — `CheckInService` checkout rollups, forced checkout, midnight sweep
**Severity:** P1
**Status:** ✅ FIXED (2026-08-12) on `fix/overnight-shift-checkout-rollup`
**Reported:** while moving six evening workers from Morning Shift onto an overnight
16:00–01:00 shift on production.

## Symptom

The morning after the six were moved to the evening shift, every one of their 2026-08-11
records carried **1,379 minutes (~23 hours) of overtime** for a normal ~7.5-hour day:

| User          | Check-in (PKT) | Checkout (PKT) | worked | overtime booked |
| ------------- | -------------- | -------------- | ------ | --------------- |
| Adnan Kamran  | 16:07:07       | 23:59:47       | 7h53m  | **1379 min**    |
| Ali Asgher    | 16:23:03       | 23:59:59       | 7h37m  | **1379 min**    |
| Sher afgan    | 16:11:42       | 23:56:35       | 7h45m  | **1376 min**    |
| Tayyab Shaikh | 16:34:31       | 23:59:31       | 7h25m  | **1379 min**    |
| Umar Amjad    | 16:17:53       | 23:59:49       | 7h42m  | **1379 min**    |
| Zarar Khalid  | 16:28:33       | 23:59:49       | 7h31m  | **1379 min**    |

Every checkout was also stamped `auto_checked_out` at ~23:59 — an hour before the shift's
01:00 end — and the hours they actually worked past midnight were discarded.

## Root cause

A shift whose `end_time` is at or before its `start_time` finishes on the day AFTER the one
it starts. Three separate places in `CheckInService` assumed the off time falls on the
record's own date, so for a 16:00 → 01:00 shift they all resolved it to **01:00 that
morning** — roughly 15 hours BEFORE the shift began.

### 1. `recomputeRecordRollups()` — the phantom overtime

```php
$offAt = Carbon::parse("{$recordDate} {$schedule->checkout_time}", $tz);   // 2026-08-11 01:00
...
if ($localOut->lt($offAt)) { /* early */ } else { /* overtime */ }
```

With the off time 15 hours in the past, every checkout landed in the `else` branch:
23:59 − 01:00 = 1,379 minutes of "overtime". The correct reading is an early finish, 61
minutes short of the 01:00 end.

### 2. `resolveForcedCheckoutInstant()` — the one-second day

Step 2 falls back to the shift's off time when there is no tracked activity, guarded by
`$offAt->gt($checkInAt)`. Anchored to the record's date the off time was always BEFORE a
16:00 check-in, so step 2 could never win and the resolver fell through to its degenerate
`check_in_at + 1s` guard — recording a **one-second** working day. Zarar's 08-04 and 08-05
rows show the pre-move shape of this fallback (closed at 20:30, the morning shift's off
time); after the move to an overnight shift it would have collapsed to 1 second.

### 3. `lastTrackedActivityInstant()` — the truncated evening

The activity search was bounded to the record's org-local calendar day
(`00:00:00`–`23:59:59`), so work done after midnight was invisible to it. Combined with the
midnight sweep below, an evening worker's session was closed at 23:59:59 and the rest of
the shift thrown away. Measured on 2026-08-11: five of the six had tracked entries running
to 00:34, 01:13, 01:17, 01:21 and 01:41 — between 35 and 101 minutes each, discarded.

### 4. `autoCheckOutOpenSessions()` — closing a shift that is still running

The midnight sweep (00:00 PKT) closes open sessions whose record `date` is in the past, on
the assumption that a past date means the work day is over. Its own docblock promises "a
session from the current day is never closed early". For an overnight shift the record
dated *yesterday* IS the shift still running, so at midnight the job force-closed workers
who still had an hour to go — exactly the thing it promises not to do.

## Why it went unnoticed

Every shift in production was same-day (11:30–20:30) until 2026-08-11. `AttendanceService::`
`generateDailyAttendance()` has always carried the overnight guard —

```php
if ($shiftEnd->lte($shiftStart)) { $shiftEnd->addDay(); }
```

— so the tracker-derived figures were right all along and only the check-in/checkout signal
was wrong. The two attendance signals disagreed silently.

## Fix

A single `offTimeFor()` helper resolves the off time and rolls it forward a day when
`end_time <= start_time`, mirroring the guard `AttendanceService` already used. All three
call sites now go through it:

- `recomputeRecordRollups()` — early/overtime measured against the real shift end.
- `resolveForcedCheckoutInstant()` — takes the resolved off time, so step 2 is reachable.
- `lastTrackedActivityInstant()` — window extended to the later of the day end and the off
  time, so post-midnight work counts. The off time is a deliberate **ceiling**: a fabricated
  checkout is never stamped past the end of the shift it belongs to, which also stops the
  window bleeding into the next day's shift. Overtime beyond the off time is left to the
  user's own checkout or a regularization.
- `autoCheckOutOpenSessions()` — skips a record whose shift has not reached its off time
  (`shiftStillRunning()`), honouring the method's existing contract.

Because the midnight sweep now correctly skips overnight workers, a **second sweep at 06:00
PKT** (`01:00` UTC, `force-checkout-open-sessions-overnight`) was added in
`routes/console.php` to close them once their shift has genuinely ended. The job is
idempotent — it only touches records that still carry an open session and re-checks that
under lock — so the second pass is a no-op for anyone already closed.

## Tests

`backend/tests/Feature/Hr/OvernightShiftCheckoutTest.php` — 9 tests:

- finishing before the overnight off time is early, not ~23h of overtime
- working past the off time earns real overtime
- checkout exactly at the off time is neither early nor overtime
- the midnight sweep leaves a still-running overnight shift open
- the midnight sweep still closes an overnight shift that HAS ended, at the off time
  (8h50m of work, not one second)
- forced checkout keeps work done after midnight
- forced checkout is never stamped past the off time
- a same-day shift's arithmetic and midnight close are unchanged (regression guards)

Note the trap that made the first draft of two of these pass for the wrong reason: the
check-out endpoint returns `getTodayStatus()`, and for a checkout after midnight "today" is
already the NEXT day, so asserting on the response body reads an empty row rather than the
record just closed. Assert on the record itself.

## Production data repair

The code fix does not retro-correct rows already written. Applied separately to the six
affected users only (`scripts/prod-fix-overnight-checkout-data.sql`):

- 2026-08-11 — checkouts re-extended to their true last tracked activity, `worked_seconds`
  recomputed, early/overtime recomputed against the 01:00 off time.
- 2026-07-07 → 2026-08-10 — 27 days carrying ~109 hours of overtime that was really
  measured against the *morning* shift's 20:30 off time, recomputed against the evening
  shift.

## Related

- [attendance-policy-replaced-by-shift-schedule.md](attendance-policy-replaced-by-shift-schedule.md) — how the shift became the schedule source.
- [checkin-auto-checkin-floor-and-midnight-force-checkout.md](checkin-auto-checkin-floor-and-midnight-force-checkout.md) — the midnight force-checkout (Feature B) this report amends.
- [checkin-late-minutes-from-official-start.md](checkin-late-minutes-from-official-start.md) — the late-threshold half of the same schedule contract.
