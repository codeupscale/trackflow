# My Attendance table shows "—" for a check-in day + summary tiles stuck at 0/0

**Status:** ✅ FIXED (2026-07-03, `develop`) — branch `fix/attendance-table-checkin-fields`.

**Scope:** HR → My Attendance (`/hr/attendance`) and Team Attendance (`/hr/attendance/team`).
Backend `AttendanceService::getAttendance()` / `getTeamAttendance()` serialization; frontend
`useCheckIn`/`useCheckOut` cache invalidation. Introduced when the check-in/checkout feature
(commit `b9cacbda`, merged into `develop`) added `check_in_at`/`check_out_at`/`worked_seconds`
columns without wiring them into the attendance list payload.

**Severity:** P1 — user-visible data loss on the primary attendance screen: a successful
check-in showed correctly in the `CheckInCard` (status Present, On-Time badge, live timer) but
the attendance table row for the same day showed "—" for Clock In / Clock Out / Hours, and the
summary tiles read "0 Present Days of 0 working days".

## Symptom

1. **Table columns blank.** After checking in (and after checking out), the My Attendance and
   Team Attendance tables rendered "—" in the Clock In, Clock Out and Hours columns for today's
   row, even though the row itself existed with status `present`.
2. **Summary tiles stale.** The summary cards showed "0 Present Days of 0 working days" while a
   `present` record for today existed.

## Root cause

Two independent causes, one per symptom.

### 1. Table columns — backend never mapped the check-in columns (nor `day`/`shift_name`)

`getAttendance()` returned raw `AttendanceRecord` models. The web `AttendanceRecord` type expects
`clock_in`, `clock_out`, `day`, `shift_name`, `overtime_hours` — **none of which are physical
columns** on the model — plus `total_hours` and `late_minutes`. The raw payload therefore had:
- no `clock_in` / `clock_out` (the frontend read `record.clock_in` → `undefined` → "—"),
- `total_hours` = `0` for a check-in-only day (no tracked time) → Hours "—",
- no `day` / `shift_name` / `overtime_hours`.

The new `check_in_at` / `check_out_at` / `worked_seconds` / `check_in_late_minutes` columns were
present in the raw dump but under names the table did not consume. `getTeamAttendance()` had the
same gap: its real-record branch dumped `$record->toArray()`, and its synthesised branch hard-coded
`clock_in`/`clock_out` to `null` (`AttendanceService.php:399-400`).

### 2. Summary tiles — frontend never invalidated the summary query after check-in

The summary endpoint itself is correct — verified by reproduction: a single on-time check-in on a
working day returns `present_days=1`, `total_working_days=1` from `GET /hr/attendance/summary`.

The stale tiles were a **TanStack Query cache-invalidation gap**. `useInvalidateAfterCheckAction`
(in `web/src/hooks/hr/use-check-in.ts`) invalidated `['attendance']`, `['attendance','today']`,
`['team-attendance']`, `['check-ins']`. The summary query key is `['attendance-summary', month,
year]`. Prefix-matching on `['attendance']` compares element 0: `'attendance-summary' !==
'attendance'`, so it **does not** match — the summary was never refetched after a check-in and kept
its page-load value (0/0 for a fresh month) until a hard refresh. This is why the list row appeared
(list key `['attendance', filters]` *does* match) but the tiles did not update.

## Fix

**Backend** (`AttendanceService`): new `serializeRecord(AttendanceRecord, string $tz): array` used by
both `getAttendance()` (paginator collection transformed) and `getTeamAttendance()` (real-record
branch). It reconciles the two attendance signals into single display columns:
- `clock_in` / `clock_out` ← physical `check_in_at` / `check_out_at` rendered as `H:i` in the org
  **AttendancePolicy timezone**; falls back to the tracker `first_seen` / `last_seen` wall-clock.
  Only filled from check-in data when it exists, so tracker-only orgs are unaffected.
- `total_hours` ← tracked hours, else `worked_seconds / 3600` (set on checkout).
- `late_minutes` ← `check_in_late_minutes` when the user checked in, else the tracker/shift figure.
- also adds `day`, `shift_name`, `overtime_hours`, and passes through the raw check-in signal
  (`check_in_at`, `check_in_status`, `is_early_checkout`, `missing_checkout`, `check_in_flags`,
  `worked_seconds`, `worked_hhmm`) so the row can render its on-time/late/early/missing badge.

The org timezone is resolved **once per request** (`orgTimezone()`), not per row. The synthesised
team rows were extended with the same keys (all null/0) for a uniform payload shape.

**Frontend** (`use-check-in.ts`): `useInvalidateAfterCheckAction` now also invalidates
`['attendance-summary']`, so the Present / working-days tiles refetch immediately after check-in
and checkout.

## Verify

- Backend: `tests/Feature/Hr/CheckInTest.php` —
  `test_check_in_populates_clock_in_and_late_in_attendance_list` (clock_in `11:50` org-tz, late 20),
  `test_checkout_populates_clock_out_and_hours_in_attendance_list` (clock_out `20:30`, 8.83h,
  worked 31800s / `08:50`), `test_summary_counts_a_check_in_present_day` (1 present / 1 working).
  Full `tests/Feature/Hr` 226 green; `AttendanceServiceTest` 27 green (one assertion updated: list
  now returns serialized arrays, not models).
- Frontend: `src/__tests__/hr/hooks/use-check-in-invalidation.test.tsx` asserts both `useCheckIn`
  and `useCheckOut` invalidate `['attendance-summary']` (+ `['attendance']`, `['attendance','today']`).
  `npx tsc --noEmit` clean; HR vitest 271 green.

## Key files

- `backend/app/Services/AttendanceService.php` — `getAttendance()`, `getTeamAttendance()`,
  `serializeRecord()`, `orgTimezone()`, `trimTime()`, `formatHhmm()`
- `web/src/hooks/hr/use-check-in.ts` — `useInvalidateAfterCheckAction()`
- `web/src/app/(dashboard)/hr/attendance/page.tsx`, `.../attendance/team/page.tsx` — consumers (unchanged)
