# Project Time Report — missing manual entries & per-entry detail

**Status:** ✅ FIXED (2026-07-07)  
**Area:** Backend `ProjectTimeReportService` + web `/reports/project-time`  
**Severity:** P1 — report appeared empty or incomplete for orgs using manual time logging

## Symptom

- User selects **All projects** / **All employees** on Project Time Report but sees little or no data.
- CSV/PDF export lacked clear per-entry breakdown: employee name, project name, start/end times.
- Manual "Log Time" entries never appeared even after approval.

## Root cause

1. `ProjectTimeReportService::baseQuery()` filtered `type = 'tracked'` only — approved manual entries were excluded (`backend/app/Services/ProjectTimeReportService.php`).
2. Default UI period was **Week**, so older entries outside the current week were hidden.
3. Export columns used a single datetime field without separate start/end times or entry type.
4. Users may also confuse **Reports & Analytics** (`/reports` — aggregated charts) with **Project Time** (`/reports/project-time` — per-entry table + export).

## Fix

- Include `type IN ('tracked', 'manual')` with `approval_status = 'approved'` (idle still excluded).
- CSV/PDF/UI: add **Type**, **Date**, **Start**, **End** columns per entry.
- Default period → **Month**; query `staleTime: 0` + `refetchOnMount: 'always'`.

## Notes

- Pending manual entries still require approval via **Time Approvals** before they appear in any report aggregate.
