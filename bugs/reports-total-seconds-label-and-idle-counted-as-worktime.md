# Reports show raw "total seconds" label + idle counted as working time

**Status:** ✅ FIXED (2026-06-30, `develop`) — branch `fix/reports-export-and-attendance-absent-staff`.

**Scope:** Web Reports builder + `ReportService::summary` + report CSV/PDF.

**Severity:** P2 — confusing label and inflated/incorrect working-time totals.

## Symptom

- The report builder column / exported CSV header literally read **`total_seconds`** instead of a human label, even though the value was formatted as `h:mm:ss`.
- "Working time" totals looked too high: the summary's `total_seconds` summed **tracked + idle**, so idle/break time was counted as work.

## Root cause

- Frontend `formatColumnName()` only title-cased the raw key → "Total Seconds". Value formatting was fine; the label was not mapped.
- `ReportService::summary()` returned `total_seconds = SUM(all entry types)` (line ~69/166), i.e. tracked **plus** idle. `total_seconds_tracked` / `total_seconds_idle` already existed separately but the UI/headline used the combined figure.

## Fix

- Frontend: `formatColumnName()` now maps duration keys to readable labels — `tracked_seconds`/`total_seconds` → **"Time Utilized"**, `idle_seconds` → "Idle Time", etc.
- Summary report builder + headline now use **tracked working time** (`tracked_seconds` per day, `total_seconds_tracked` for the total); idle is shown separately.
- CSV (`ReportExportFormatter`) and the PDF blade (`reports/generic`) render durations as hours with clear headers ("Time Utilized (h)", "Idle (h)") — never "Total Seconds".

## Verify

- `tests/Feature/Api/ReportTest.php::test_can_export_csv_synchronously` asserts the CSV contains "Time Utilized".
- Manual: summary report total matches tracked hours; idle shown in its own column.

## Key files

- `web/src/app/(dashboard)/reports/page.tsx` — `transformReportResponse` (summary), `formatColumnName`
- `backend/app/Support/ReportExportFormatter.php`
- `backend/resources/views/reports/generic.blade.php`
- `backend/app/Services/ReportService.php` — `summary()` (fields already present; semantics clarified in UI/export)
