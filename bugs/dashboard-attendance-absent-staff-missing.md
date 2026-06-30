# HR Team Attendance hides absent staff (only present employees shown)

**Status:** ✅ FIXED (2026-06-30, `develop`) — branch `fix/reports-export-and-attendance-absent-staff`.

**Scope:** HR → Attendance / Team Attendance ← `AttendanceService::getTeamAttendance`. (Main dashboard "Team Activity" widget already lists everyone — see note.)

**Severity:** P1 — managers/admins could not see who was absent.

## Symptom

"Team Attendance only shows present staff but does not display absent staff." For some date ranges (especially the current day) absent employees simply did not appear.

## Root cause

`attendance_records` rows are created **only** by `generateDailyAttendance()` (the `GenerateDailyAttendanceJob`, scheduled 00:30 UTC for the *previous* day). There is no real-time creation. So:
- For **today** (job hasn't run yet) → no records exist → nobody/only-stale rows show.
- In environments where the scheduler is disabled (dev) → records may be missing entirely.

`getTeamAttendance()` queried `attendance_records` directly, so any employee without a generated row for a date was invisible — making absentees disappear rather than show as "absent".

## Fix

`getTeamAttendance()` now returns a **complete roster**: every active employee gets a row per day in range. Generated records take precedence (present / half-day / late / overtime stay accurate); missing days are **synthesised** with a derived status (`holiday` > `on_leave` > `weekend` > `absent`). This is read-only and independent of whether the daily job ran. Holidays + approved leaves are prefetched (no N+1); range capped at 92 days; results manually paginated.

## Note — main dashboard

The dashboard "Team Activity" widget (`DashboardController::index` → `team_summary`) already maps **all** active users (offline + 0h = effectively absent), so no change was needed there.

## Verify

- `tests/Unit/Services/AttendanceServiceTest.php` — `get_team_attendance_returns_records_with_user_relations` (full roster incl. synthesised absent), `get_team_attendance_filters_by_user_id`. 58 tests green.
- Manual: open Team Attendance for today → every active employee listed; non-workers show "Absent".

## Key files

- `backend/app/Services/AttendanceService.php` — `getTeamAttendance()`, `deriveAbsentStatus()`
