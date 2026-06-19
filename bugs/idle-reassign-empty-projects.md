# Idle reassign dropdown shows no projects

**Status:** ✅ FIXED 2026-06-19 (develop)
**Severity:** P1 — blocks reassign on slow/offline networks
**Scope:** Desktop idle alert window

## Symptom

When the idle alert reappears, the "Reassign to project" dropdown is sometimes empty even though projects exist.

## Root cause

1. `showIdleAlert()` **awaited** `loadProjects()` on every first open — slow API blocked the popup and failed fetches set `cachedProjects = []`, wiping the list.
2. Reappear path sent `cachedProjects` immediately; if step 1 had failed, the dropdown stayed empty.
3. `idle-alert.js` repopulated the select on every `idle-data` event, including empty `projects: []`, clearing prior options.

## Fix

- **30-minute TTL cache** in `desktop/src/main/index.js` — idle popup uses cached list, no blocking API call.
- **Failed fetches keep stale cache** — network errors no longer empty `cachedProjects`.
- **Background refresh** when cache is stale + 30 min interval while authenticated.
- **Renderer guard** in `idle-alert.js` — only repopulate when `projects.length > 0`.

## Key files

- `desktop/src/main/index.js` — `loadProjects()`, `refreshProjectsIfStale()`, `showIdleAlert()`
- `desktop/src/renderer/idle-alert.js`
- `desktop/test/projects-cache.test.js`
