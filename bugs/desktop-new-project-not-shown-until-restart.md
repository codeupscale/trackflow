# Desktop — newly assigned project not shown until restart (30-min cache)

**Area:** Desktop project list (`index.js` `loadProjects` / popup + idle reassign dropdown)
**Severity:** P2 (UX gap; no data loss)
**Status:** ✅ FIXED (2026-06-23) — branch `fix/desktop-offline-heartbeat-replay-and-project-refresh`

## Symptom
A project assigned to the user (server-side) did **not** appear in the desktop app — neither the popup project picker nor the idle **Reassign** dropdown — for up to ~30 minutes. Only an app restart surfaced it.

## Scope
Any newly-assigned (or newly-created-and-assigned) project while the desktop has a "fresh" cached project list.

## Root cause
`PROJECTS_CACHE_TTL_MS = 30 * 60 * 1000`. `loadProjects()` returns the in-memory cache whenever it's < 30 min old, and the background refresh interval is also 30 min. The `get-projects` IPC handler and the idle alert both used the cache (`refreshProjectsIfStale()` only refreshes when *stale*). So an assignment made minutes ago wasn't fetched until the TTL expired or the app restarted (cache is in-memory → wiped on restart).

Note: the 30-min cache is **intentional** — see [idle-reassign-empty-projects.md](idle-reassign-empty-projects.md) — it prevents the reassign dropdown from blocking/emptying on slow networks. So the fix keeps the cache and adds an on-open refresh; it does not remove the cache.

Evidence: `desktop/src/main/index.js` — `PROJECTS_CACHE_TTL_MS`, `loadProjects()`, `refreshProjectsIfStale()`, `get-projects` handler, `showIdleAlert()` (used `refreshProjectsIfStale()`), popup show block.

## Fix
Added `refreshProjectsOnOpen()` — when a project-picking surface **opens**, force a fresh fetch if the cache is older than `PROJECTS_OPEN_REFRESH_MS` (60s), throttled so rapid re-opens don't hammer the API. The cached list still renders immediately (never empty), and the fresh list is pushed when it lands:
- Idle alert open → `refreshProjectsOnOpen(pushProjectsToIdleAlert)`.
- Popup show → `refreshProjectsOnOpen(() => send('projects-ready'))` so the renderer re-fetches.

The 30-min TTL cache remains as the offline/slow-network fallback.

## Follow-up (not changed)
Could also push a realtime "projects changed" event (Reverb) to refresh instantly instead of on-open; deferred as the on-open refresh covers the reported UX.
