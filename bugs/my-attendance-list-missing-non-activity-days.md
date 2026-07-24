# "My Attendance" list only shows days with activity (missing absent/weekend days)

**Status:** ✅ FIXED (2026-07-23, in working tree, uncommitted)
**Severity:** P1 — employees see an incomplete attendance sheet; absent days and the
Absent/Working-day summary cards are wrong
**Scope:** Backend `AttendanceService` (self view + summary), minor frontend guard

## Symptom

The employee **My Attendance** page (`hr/attendance`) listed only the days the user had a
persisted `attendance_record` — i.e. days they checked in / tracked time (e.g. just 2 rows
for the month). Days with no activity did not appear at all, so the table read as an
almost-empty sheet. The summary cards were correspondingly wrong ("0 Absent Days",
"2 of 2 working days").

## Root cause

`AttendanceService::getAttendance()` (self view) and `getAttendanceSummary()` were plain
queries over `attendance_records`, returning/counting **only rows that physically exist**.
A day is only ever persisted when:

- the nightly `GenerateDailyAttendanceJob` ran for it — but the Laravel scheduler is
  **disabled on dev and only runs in prod**, so absent-day rows are never generated there; or
- the user physically checked in (`CheckInService` creates the row).

So on dev the table could only ever show days the user checked in. Absent / weekend /
holiday / on-leave days simply had no row → invisible.

The **team** view (`getTeamAttendance()`) already solved exactly this — it synthesises a
complete roster (real record where present, else a derived non-worked status:
holiday > on_leave > weekend > absent). The self view and the monthly summary were never
given the same treatment.

## Fix

Applied the team view's full-range synthesis to the self path:

- `getAttendance()` now enumerates every day in `[start, min(end, today)]`, uses the real
  `attendance_record` where present, and synthesises a derived-status row (via the existing
  `deriveAbsentStatus()`: holiday > on_leave > weekend > absent) for missing days. Future
  days are never synthesised (not absences yet). Rows carry `is_synthetic` and a
  non-persistent `synthetic-…` id. Sorted date-desc, manually paginated (mirrors
  `getTeamAttendance()`).
- `getAttendanceSummary()` now walks the real calendar (month-to-date) with the same
  record-or-derived logic, so `absent_days` / `total_working_days` reflect the actual
  calendar instead of counting existing rows. Late/overtime still come from real records only.
- **Timezone-safety:** all range math is done on org-local **date strings**, not Carbon
  instants. An earlier revision mixed `Carbon::now($tz)` (org-tz midnight) with
  `Carbon::parse($date)` (UTC midnight); comparing those instants made the day-enumeration
  loop produce **zero** iterations under a non-UTC org timezone (Asia/Karachi) — caught by
  the check-in feature tests, which set a Karachi policy.
- Frontend: `AttendanceRecord.is_synthetic?: boolean` added; `canRegularize()` now excludes
  synthetic rows (they have no persistable record id, so a Regularize action would 404).

## Tests

- `AttendanceTest`: `test_own_attendance_synthesises_missing_days_as_absent_or_weekend`,
  `test_own_attendance_does_not_synthesise_future_days`; existing self/summary/date-filter
  tests updated (deterministic via pinned clock where "today" matters).
- `AttendanceServiceTest`: self-view + summary unit tests updated for synthesis.
- Full attendance + check-in suites green (113 tests).

## Key files

- `backend/app/Services/AttendanceService.php` (`getAttendance()`, `getAttendanceSummary()`)
- `web/src/lib/validations/attendance.ts`, `web/src/app/(dashboard)/hr/attendance/page.tsx`
- `backend/tests/Feature/Hr/AttendanceTest.php`, `backend/tests/Unit/Services/AttendanceServiceTest.php`

## Note

Days before an employee joined the org are shown as `absent` within the requested range
(the team view behaves the same). A join-date floor was trialled but removed — it hid real
records dated before a freshly-created user's `created_at` and diverged from the team view.
If pre-employment absents become an issue, apply a join-date floor to **both** views together.
