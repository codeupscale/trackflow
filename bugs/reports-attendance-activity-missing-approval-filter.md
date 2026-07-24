# Attendance & activity-by-day reports counted unapproved manual time

**Status:** ✅ FIXED (2026-07-23, in working tree, uncommitted)
**Severity:** P1 — wrong employee time totals; approving/rejecting a manual entry had no effect on these reports
**Scope:** Backend `ReportService` (read side only)

## Symptom

Employees reported that manual time entries and their approval state were inconsistent
across reports: some views reflected approval, others did not. Concretely, **pending and
rejected manual entries were still counted** in the attendance report's worked-seconds and
in the weekday activity average, and **approving or rejecting a manual entry changed
nothing** in those two reports.

## Root cause

The project's aggregate-exclusion rule (CLAUDE.md) requires every report read path to
filter on `time_entries.approval_status = 'approved'` (NOT the legacy `is_approved`). In
commit `a0a99060` that filter was added to ~10 aggregate methods (summary, team, projects,
payroll, analytics, timeline, timeLogs, detailedLogs) — but **two methods were missed**:

- `ReportService::attendance()` (REPT-08) — no approval filter. Pending/rejected manual
  entries inflated `total_seconds` / `first_seen` / `last_seen`; approval had no effect.
  **This is the primary defect** (wrong hour totals).
- `ReportService::activityByDay()` (REPT-11) — no approval filter. Unapproved manual
  entries with an `activity_score` skewed the per-weekday activity average. Lower impact.

The write paths (`ManualTimeEntryService::approve/reject/create`), the cache-bust
(`ReportService::flushForOrg()` via the per-org cache-version counter), and the migration
default (`approval_status` DEFAULT `'approved'`, historical rows backfilled) were all
already correct — the bug was purely the two missing read-side filters.

## Not a bug (verified, deliberately left unchanged)

- **Reports already include approved manual time** — summary, time-logs, team, projects,
  payroll, timeline, detailedLogs all filter `approval_status='approved'` and include
  `type='manual'`. Pinned by `ManualTimeEntryAggregateTest`.
- **Dashboard "tracked hours" widget is tracked-only by design** — filtered to
  `type='tracked'`, so an approved manual entry never appears there. This is a deliberate,
  tested contract (`ManualTimeEntryAggregateTest::test_manual_entries_never_inflate_dashboard_tracked_total`,
  and the class docstring). A trial change to include approved manual time was reverted once
  that test flagged the contract. Changing dashboard semantics needs product sign-off + a
  test-contract update — **open product question**, not a bug.

## Fix

Added `->where('approval_status', 'approved')` to both methods, matching the ~10 sibling
aggregates. The attendance/activityByDay report caches are already busted on approve/reject
via `flushForOrg()` (the cache key embeds the per-org version), so the fix takes effect
immediately on the next approval.

## Tests

- New regression: `ManualTimeEntryAggregateTest::test_attendance_report_excludes_pending_manual_then_counts_on_approval`
  — asserts the attendance report shows `0` worked-seconds for a pending manual entry, then
  `MANUAL_SECONDS` after approval (fails on the old code, passes on the fix). Green.
- Existing summary/time-logs/timesheet/attendance-service approval tests still green.

## Key files

- `backend/app/Services/ReportService.php` (`attendance()`, `activityByDay()`)
- `backend/tests/Feature/Timer/ManualTimeEntryAggregateTest.php`
