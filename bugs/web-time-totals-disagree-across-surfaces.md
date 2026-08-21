# Web reports four different totals for the same time range

**Area:** Web dashboard + Laravel reporting layer
**Severity:** P1 — the product cannot state how long anyone worked
**Status:** ✅ FIXED (2026-08-21, `develop`)

## Symptom

Four surfaces, one date range, four answers. Measured on the dev dataset over an
identical 60-day window, org-wide:

| Surface | Before | After |
| --- | --- | --- |
| Reports tab KPI | 23.02 h | 31.52 h |
| Report builder (summary) | 31.52 h | 31.52 h |
| Dashboard | 31.51 h | 31.52 h |
| Time page "Total Hours" | 31.68 h *(and it only displayed one page's slice)* | 31.52 h |

Over the full dataset for the main org the Time page card was the worst offender:
**3905 h against a true 2001 h.**

## Root cause

There was no shared definition of "worked time". Each surface had grown its own,
and the four disagreed on all three axes at once — which rows count, how long a row
is, and which day it belongs to.

### 1. Which rows count

`ReportService::analytics()` filtered `type = 'tracked'` for its headline KPI, so every
approved **manual** entry was invisible there while the report builder, dashboard,
timesheets and attendance all counted it. This is the exact rule CLAUDE.md already
states — *worked time = every APPROVED entry that is NOT idle, never `type='tracked'`* —
re-broken in a surface the earlier fix did not cover.

The same method's charts had the opposite defect: `time_per_project` and the budget
KPI filtered **nothing**, so they counted **idle** time the KPI above them excluded.
`detailedLogs()` and `timeLogs()` likewise listed idle rows under totals that omitted
them, so the table never reconciled with its own header.

### 2. How long a row is

`DashboardController` summed the `duration_seconds` column; the reporting layer derived
duration from the timestamps and clamped it. `duration_seconds` is written by the desktop
agent and is not trustworthy — on the dev dataset:

- idle rows store **1897 h** against **55.65 h** of real wall-clock (4683 of 4889 rows wrong);
- 69 tracked rows disagree with their own timestamps, several storing **negative** seconds
  (`-1163`, `-613`, `-478`, `-370`), which `SUM(duration_seconds)` silently **subtracts**.

That is why the Time page — summing `duration_seconds` across all types, idle included —
nearly doubled the true figure.

### 3. Which day a row belongs to

`summary()` grouped by `DATE(started_at)`. `started_at` is `timestamp without time zone`
holding UTC, so that is the **UTC** date, while the range bounds around it were resolved in
the organization timezone. For Asia/Karachi (UTC+5) everything worked between local 00:00
and 05:00 landed on the previous day's bar — 28 entries in the current dataset. The
dashboard's weekly chart already bucketed in org time, so the two series drew different days.

### 4. The Time page summed the page

`totalSeconds` was `entries.reduce(...)` over the fetched page — 20 rows — rendered beside
an "Entries" count covering the whole filtered set, and it changed as the user paged.

## Fix

`backend/app/Support/WorkedTime.php` (new) is now the single definition:

- `durationExpr()` — duration from timestamps, clamped to `[0, 43200]`, so a corrupt row can
  neither subtract time nor inflate it;
- `localDateExpr($tz)` — the calendar day in the **organization** timezone;
- `scopeWorked()` — approved, `type <> 'idle'`, ended.

Wired through `ReportService` (summary bucketing, analytics KPI + charts, detailed logs,
time logs), `DashboardController` (all four rollups), and `TimeEntryController::index()`,
which now returns `total_seconds` / `idle_seconds` / `unapproved_seconds` computed
server-side over the **whole filtered set**. `web/.../time/page.tsx` renders that total
instead of summing the page; the reports KPI is relabelled "Total Hours" to match what it
now measures.

## Regression cover

`backend/tests/Feature/Timer/WorkedTimeConsistencyTest.php` — asserts all five surfaces
return the same total for one fixture, that idle never counts as worked, that a **negative**
`duration_seconds` cannot move any total, that the Time page total covers the filtered set
and does not change between pages, that pending manual time stays out, and that the daily
series buckets on the local day rather than the UTC one.

Verified failing against the pre-fix code (KPI returned 2.0 h where 3.0 h was correct; the
daily series filed the entry under the UTC day).
