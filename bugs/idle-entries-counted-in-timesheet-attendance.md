# Idle entries counted as worked time (timesheet & attendance)

**Status:** ✅ FIXED (2026-06-22, `develop`)

**Scope:** Backend aggregations — timesheet submission + daily attendance generation.

**Severity:** P1 — inflated worked hours; can flip Present/Half-Day/Absent and over-report payroll/timesheet time.

## How it surfaced

Investigating "incorrect time" after a flow of: install → track → keep idle → work
offline/online → **reassign** idle. DB inspection of the live session
(`mirza.blade@yopmail.com`) showed the desktop tray (~46m, tracked-only) was actually correct,
but the underlying data had a duplication that some aggregations mis-counted.

## Root cause

On **reassign** (and discard), [`TimerService::reportIdle()`](../backend/app/Services/TimerService.php)
intentionally creates an `idle` audit entry for the idle window **in addition to** the
reassigned `tracked` entry (reassign) — so the same `[idle_start, idle_end]` interval is
represented by both an `idle` and a `tracked` row (here, both on the same project).

`idle` entries are audit-only and must never be summed as worked time. The canonical
aggregations correctly exclude them (`TimerService` status/today-total and
`DashboardController` all filter `type = 'tracked'`; `ReportService` separates tracked vs idle).
But two aggregations summed **all** entry types:

- [`TimesheetController::submit()`](../backend/app/Http/Controllers/Api/V1/TimesheetController.php) —
  `sum('duration_seconds')` with no type filter.
- [`AttendanceService::generateDailyAttendance()`](../backend/app/Services/AttendanceService.php) —
  same, and the result drives the Present (≥4h) / Half-Day (≥2h) / Absent status.

So discarded idle counted as work, and reassigned windows were double-counted (idle marker +
reassigned tracked) — e.g. mirza's day: tracked-only **44.2m** vs all-types **54.2m** (+10m idle).

## Fix

- Both aggregations now exclude idle: `->where('type', '!=', 'idle')` — counting `tracked`
  **and** `manual` (both real worked time) but never `idle`. (Used `!= idle` rather than
  `= tracked` so manually-added entries still count toward timesheet/attendance.)
- `TimeEntryFactory` default `type` changed from `randomElement(['tracked','manual','idle'])` to
  `'tracked'`. The random default made time-sum tests non-deterministic and silently asserted the
  buggy "idle counts" behavior. `idle`/`manual` remain available via `->idle()` / `->manual()` /
  explicit `['type' => ...]`.

## Not a bug (clarification)

The desktop tray / web "Today's Hours" were already correct (tracked-only). The reassigned idle
windows legitimately count as work because the user chose **reassign** (idle → work on the
project). The "~1 hour before reassign" the user saw was the separate pre-reassign desktop
display-anchor inflation (addressed by the idle-reassign re-anchor fix —
[idle-reassign-desktop-time-inflated.md](idle-reassign-desktop-time-inflated.md)), not these sums.

## Verify

```bash
cd backend && php artisan test --filter='Attendance|Timesheet'   # 66 pass (incl. new idle-exclusion test)
```

New test `test_timesheet_total_excludes_idle_entries` asserts an idle entry does not count toward
the timesheet total. (5 unrelated pre-existing timer-test failures remain; this change adds none.)
