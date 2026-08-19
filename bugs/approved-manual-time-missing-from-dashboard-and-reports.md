# Approved manual time is invisible to the dashboard, the reports total and `/timer/today-total`

**Status:** Fixed
**Reported:** 2026-08-18 (owner, prod)
**Area:** backend (`DashboardController`, `TimerService`, `ReportService`, `ReportExportFormatter`), web (reports page)

## Symptom

A manual time entry sat in **Time Entries** with an **Approved** badge and a 13:00 duration,
and the day's page total (7:17:34) included it — but:

| Surface | Showed | Should have shown |
|---|---|---|
| Dashboard → Today's Hours | 7h 5m | 7h 18m |
| Reports → Total Hours / Time Utilized | 5.5h / 5:31:35 | 5:44:35 |
| Reports → Entries | **5** | 5 |

The reports page was the tell: it **counted** the manual entry in `Entries` but left its
13 minutes out of `Time Utilized`. The count and the total disagreed about the same row.

Prod data for the entry was clean — `type=manual`, `approval_status=approved`,
`started_at=07:52Z`, `ended_at=08:05Z`, `duration_seconds=780`, `deleted_at=null`.
Nothing was wrong with the entry. Every one of these surfaces was filtering it out.

## Root cause

Two independent filters, same mistake — treating "tracked" as a synonym for "worked".

**1. `type = 'tracked'` on the hours aggregates.** `DashboardController` (team rollup,
today, week, daily breakdown, active-project count) and `TimerService`
(`status()`, `todayTotal()` — the figure the desktop agent builds its total on) all
narrowed to `type='tracked'`. Every other rollup in the product — `ReportService`,
timesheets, `AttendanceService`, `DailyActivitySummaryService` — already counted approved
manual time. These were the only surfaces that did not.

For `TimerService` this also contradicted the documented contract: `todayTotal` exists
precisely because it is *"how the desktop picks up MANUAL entries, which it does not own
and cannot compute locally"* — while the query excluded exactly those entries.

**2. The reports page rendered the wrong field.** `ReportService::summary()` returns both
`total_seconds` (everything approved) and `total_seconds_tracked` (the `type='tracked'`
bucket). The page, the CSV and the PDF all rendered the **tracked** bucket as
"Time Utilized"/"Total Hours" while rendering `entry_count` — which is a `COUNT(*)` over
the whole approved set — beside it. Hence 5 entries totalling only 4 entries' time.

## Fix

The rule is now stated once and applied everywhere: **worked time = every APPROVED entry
that is not idle.** Manual time counts once approved; idle never counts; pending and
rejected manual time stays invisible via `approval_status`.

- `DashboardController` — five aggregates switched from `type='tracked'` to
  `type != 'idle'` + `approval_status='approved'`.
- `TimerService` — `status()` (both today totals) and `todayTotal()` likewise, restoring
  the documented behaviour the desktop assembly rule depends on.
- `ReportService::summary()` — added `worked_seconds` per day and `total_seconds_worked`
  overall (`type <> 'idle'`). `tracked_seconds` is UNCHANGED and still reported: it is the
  denominator for `idle_percent` and the billable gate, so it must stay narrow — it just
  must not be the headline total.
- `ReportService` previous-period baseline — dropped its `type='tracked'` filter so the
  period-over-period trend compares like with like.
- Web reports page, `ReportExportFormatter` (CSV) and `reports/generic.blade.php` (PDF) —
  render `worked_seconds` / `total_seconds_worked`, falling back to the old fields so an
  older API response still renders.

## Why `type != 'idle'` and not "no type filter"

The first cut simply deleted the `type='tracked'` filter, which let **idle** entries into
the totals — caught by `TimerServiceTest::test_today_total_excludes_idle_entries`. Idle
entries are a real row type and are not worked time. The filter had to be inverted, not
removed.

## Regression tests

`tests/Feature/Timer/ManualTimeEntryAggregateTest.php`:

- `test_dashboard_excludes_pending_manual_then_counts_it_on_approval` — replaces
  `test_manual_entries_never_inflate_dashboard_tracked_total`, which pinned the old
  behaviour as intentional.
- `test_dashboard_daily_breakdown_counts_approved_manual_time`
- `test_today_total_excludes_pending_manual_then_counts_it_on_approval`
- `test_summary_worked_total_counts_approved_manual_alongside_tracked` — also asserts
  `total_seconds_tracked` stays narrow, so the two buckets cannot be conflated again.

Plus the pre-existing `test_today_total_excludes_idle_entries`, which is what makes the
idle half of the rule non-negotiable.

## Testing trap worth remembering

Running the suite from a `git worktree` whose `backend/vendor` is a **symlink** to another
checkout makes Laravel resolve `base_path()` to the *symlink target*, so the tests exercise
the other checkout's `app/` code and every fix appears to do nothing. Copy `vendor`
(`cp -Rl` for hardlinks) instead of symlinking it.
