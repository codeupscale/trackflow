# Desktop popup "Today, all projects" total is project-scoped when a project is selected

**Status:** ✅ FIXED (2026-07-02, `fix/desktop-today-total-project-scoped`).

**Scope:** Desktop popup timer UI + tray tooltip + backend `TimerService::status()`. `desktop/src/main/index.js`, `backend/app/Services/TimerService.php`.

**Severity:** P2 — user-visible data confusion: the "all projects" total and the tray tooltip understate the day's tracked time whenever a specific project is selected while the timer is stopped. No data loss or leakage; display-only.

## Symptom

On the desktop popup, the secondary line "Today, all projects" (and the tray "Today: X" tooltip) shows a **project-scoped** total whenever a specific project is selected in the dropdown while the timer is **stopped**. Selecting "Select Project" (null) shows the correct all-projects sum. Example: 1h on Project A + 1h on Project B → selecting Project A shows "Today, all projects: 1h" instead of 2h.

## Root cause

Verified chain:

1. Renderer calls `getTimerState(selectedProjectId)` — `desktop/src/renderer/index-renderer.js:247`.
2. Main `get-timer-state` handler calls `apiClient.getTimerStatus(validProjectId)` — `desktop/src/main/index.js`.
3. Backend `TimerService::status($projectId)` **scopes** `today_total` to that project when `project_id` is passed — `backend/app/Services/TimerService.php` (the `if ($projectId !== null) $todayQuery->where('project_id', ...)` branch).
4. Main assigned this scoped value to a misleadingly-named `globalTotal` and stored it into `todayTotalGlobal`, which feeds BOTH the renderer's "Today, all projects" line (`updateTotalSum`) AND the tray tooltip (`Today: ${formatTimeShort(todayTotalGlobal)}`).

So the project scope intended only for the big per-project timer leaked into the global line and the tray.

Additionally, in the stopped branch `project_today_total` was hard-coded to `0`, so there was no clean per-project field to rely on — the desktop had to reuse the scoped `today_total` for the big timer, which is exactly what coupled the two displays.

## Fix

### Chosen API shape — additive, backward-compatible

`GET /api/v1/timer/status` now returns a NEW additive field alongside the existing ones:

| Field | Semantics |
|---|---|
| `today_total` | **Unchanged** — scoped to the requested `project_id` when provided, else the all-projects sum. Kept for backward compatibility. |
| `all_projects_today_total` | **NEW** — ALWAYS the global all-projects sum, never scoped. Includes the running entry's elapsed. |
| `project_today_total` | Now also populated in the stopped branch (was `0`) — the requested project's total. |

**Why additive instead of redefining `today_total` to always be global:**
Older desktop builds already deployed in the field read `today_total` as project-scoped when they pass `project_id`. Redefining `today_total` to always be global would silently change what those clients display (and any code path expecting a per-project number). The additive field is zero-risk: existing readers see identical values; the new desktop build prefers `all_projects_today_total` and falls back to `today_total` for older backends. Compatibility audit of all readers:

- **Web** (`web/src/stores/timer-store.ts`) calls `/timer/status` **without** a project param → `today_total` is already global there; unaffected.
- **Desktop** other `getTimerStatus()` callers (tray timer, auto-stop, sync) pass **no** project → already global; unaffected.
- **Desktop** `getTodayTotal(projectId)` uses the separate `/timer/today-total` endpoint — untouched, semantics unchanged.
- Only the desktop `get-timer-state` handler passes a `project_id`, and it is the one being fixed.

### Backend (`TimerService::status()` + `buildOpenEntryStatus()`)

- Compute `all_projects_today_total` from an unscoped today query (always global).
- Keep `today_total` scoped-when-project-provided.
- The running entry's `currentElapsed` is always added to `all_projects_today_total` (the running session always contributes to the global sum, regardless of which project was requested).
- Populate `project_today_total` in the stopped branch.

### Desktop (`get-timer-state` handler in `src/main/index.js`)

- Added `const allProjectsTotal = status.all_projects_today_total ?? globalTotal;`
- All three `todayTotalGlobal = globalTotal` assignments now use `allProjectsTotal`, so the "Today, all projects" line and the tray tooltip are never project-scoped.
- The big timer keeps using the scoped `globalTotal` (`today_total`) for its stopped-state per-project display — preserving the intended behavior: per-project total when a project is selected, global when none.

## Key files

- `backend/app/Services/TimerService.php` — `status()` computes always-global `all_projects_today_total`; `buildOpenEntryStatus()` adds current elapsed to it and returns it.
- `desktop/src/main/index.js` — `get-timer-state` handler derives `allProjectsTotal` and feeds it into `todayTotalGlobal`.

## Verification

- Backend: `cd backend && ./vendor/bin/phpunit -c phpunit.local.xml --filter=TimerServiceTest` → all pass, incl. 3 new regression tests (stopped-with-project global vs scoped, stopped-without-project equality, running global includes elapsed). NOTE: `php artisan test` and the broad `--filter=Timer` suite hang in this local env (DB_HOST=postgres unreachable from host / pre-existing) — scope to `TimerServiceTest`.
- Desktop: `cd desktop && npx jest` → green, plus new `test/today-total-global-vs-scoped.test.js` regression suite.
- Cross-platform: pure data/field-selection change, no platform-specific branches touched (Windows/macOS/Linux unaffected).
