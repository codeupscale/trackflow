# Advanced Report Builder — Apps report missing employee breakdown

**Status:** ✅ FIXED (2026-07-07)  
**Area:** `ReportService::apps()` + web Advanced Report Builder  
**Severity:** P1 — Apps report lumped all org usage into one row per app with no employee names

## Symptom

With **User = All Users**, Apps & URLs report showed a single aggregated row (e.g. `powershell` 18:45:00) with no employee column. User filter appeared ignored for breakdown purposes.

## Root cause

1. `ReportService::apps()` queried raw `activity_logs` and grouped **only by `active_app`** — org-wide totals.
2. Estimated time used `COUNT(*) * 30` instead of real `app_usage_summaries.duration_seconds`.
3. CSV/PDF export did not support `apps` type at all.

## Fix

- Query `app_usage_summaries` joined to `users` — **one row per employee per app** when All Users; per-app when a single user is selected.
- Columns: Employee, Application, Time Utilized, Days Used.
- Added `apps` to export validation + CSV/PDF templates.
- UI hint: All Users = per-employee breakdown; link to **Analytics → App Usage** for richer charts.
