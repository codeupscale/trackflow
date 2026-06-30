# Reports never download + single-user filter ignored

**Status:** ✅ FIXED (2026-06-30, `develop`) — branch `fix/reports-export-and-attendance-absent-staff`.

**Scope:** Web Reports → "Advanced Report Builder" export ↔ `ReportController::export` ↔ `GenerateReportJob`.

**Severity:** P1 — exporting any report (CSV/PDF) silently failed; the per-user filter was a no-op.

## Symptom

- On the Reports page, clicking **Generate Report** / export (CSV/PDF) downloaded nothing — no file, sometimes a "Failed to export report" toast.
- Selecting a single employee in the **User** dropdown had no effect: the export always covered the whole organization.

## Root cause

1. **Download:** the frontend posts to `/reports/export` with `responseType: 'blob'` and expects the file content back. The backend instead **queued `GenerateReportJob` and returned `{ "job_id" }` JSON (HTTP 202)**. The frontend tried to treat that JSON as a file blob → corrupt/empty download. There was no polling and the `jobStatus` method had no route, so the async flow could never complete. (Also depended on S3 + a running queue worker, absent in many environments.)
2. **User filter:** `export()` did not validate or read `user_id`, and never passed it to the job. `GenerateReportJob` had no `$userId` and called `summary($orgId, null, …)`. The selected employee was dropped entirely.

## Fix

- `ReportController::export()` now generates the file **synchronously** and streams it back as a download (`text/csv` / `application/pdf` with `Content-Disposition: attachment`). No queue/S3 dependency.
- `user_id` is validated (`nullable|uuid`), employees are forced to their own id, and it is passed to `summary` (the user-scoped report type; team/projects/payroll/attendance stay org-wide).
- CSV/PDF generation extracted into `App\Support\ReportExportFormatter` (shared by the controller and the now-consistent `GenerateReportJob`).
- **Frontend download trigger hardened (2026-06-30 follow-up):** verified end-to-end on dev that the API returns a correct `text/csv` blob (HTTP 200 + `Content-Disposition: attachment`), but the browser still downloaded nothing. Root cause: `handleExport` called `window.URL.revokeObjectURL(url)` synchronously right after `link.click()`, which aborts the download in some browsers. Extracted a shared `triggerDownload()` helper that defers cleanup (`setTimeout`), sets the blob MIME type, and a `readBlobError()` that reads the blob error body so failures surface the real server message instead of a silent no-op.

## Verify

- `tests/Feature/Api/ReportTest.php::test_can_export_csv_synchronously` — asserts 200 + `text/csv` + `attachment`.
- Manual: pick a single user → exported CSV contains only that user's data.

## Key files

- `backend/app/Http/Controllers/Api/V1/ReportController.php` — `export()`
- `backend/app/Support/ReportExportFormatter.php` (new)
- `backend/app/Jobs/GenerateReportJob.php`
- `web/src/app/(dashboard)/reports/page.tsx` — `handleExport()`
