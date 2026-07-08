# Advanced Report Builder — Projects report blank project names

**Status:** ✅ FIXED (2026-07-07)  
**Area:** `ReportService::projects()` + web `reports/page.tsx` Advanced Report Builder  
**Severity:** P1 — Projects report showed time totals but empty PROJECT NAME column

## Symptom

On **Reports → Advanced Report Builder → Projects**, generated rows showed **Time Utilized** but **PROJECT NAME** was blank. Billable showed "No" and hourly rate "$0.00" for all rows.

## Root cause

API/frontend field mismatch:

- Backend `ReportService::projects()` mapped SQL `project_name` to response key **`name`** only (`ReportService.php` ~317).
- Frontend `transformReportResponse('projects')` read **`project_name`** (`reports/page.tsx` ~232) → always empty string.
- `billable` and `hourly_rate` were never included in the API payload.

## Fix

- Return `project_name` (+ keep `name` for PDF/CSV backward compat), `billable`, `hourly_rate` from `projects` table.
- Frontend fallback: `p.project_name ?? p.name`.
- Include approved `manual` entries alongside `tracked` (consistent with Project Time report).
