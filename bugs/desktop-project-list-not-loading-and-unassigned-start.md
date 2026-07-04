# Desktop project list doesn't load + timer starts with no project

**Status:** ✅ FIXED (2026-06-22, `develop`)

**Scope:** Desktop agent renderer (popup) + tray menu. Reported on Windows.

**Severity:** P1 — users can't pick a project, and a tracked entry can be started unassigned.

## Symptoms (QA, Windows)

1. After login, opening the project dropdown shows nothing / it never populates ("does not
   load project list").
2. Without choosing a project, the timer still started successfully.

## Root cause

Not actually Windows-specific — a renderer state-management defect that surfaces when the
project fetch is slow (likely the QA machine/network), plus a tray gap.

1. **Stuck-disabled dropdown.** `updateDisplay()` runs on every stopped-state sync and sets
   `projectSelect.disabled = … || projectSelect.options.length <= 1`
   ([index-renderer.js](../desktop/src/renderer/index-renderer.js)). When it runs before the
   async `loadProjects()` resolves, the (still-empty) dropdown is disabled. `loadProjects()`
   then populated the options but **never re-enabled the select**, so it stayed disabled and
   looked empty even after projects arrived.

2. **Start enabled without a project.** The same `updateDisplay()` set
   `startBtn.disabled = isRunning || isPaused`, i.e. it **re-enabled Start whenever stopped,
   ignoring project selection** — overriding the `updateStartBtnState()` guard that disables
   Start until a project is chosen.

3. **Tray started unassigned.** When `cachedProjects` was empty the tray showed a plain
   **"Start Timer"** → `startTimer()` with `null` project; the populated submenu also had a
   **"No Project"** item ([index.js](../desktop/src/main/index.js)). Either path bypassed the
   popup's project-required rule and created an unassigned tracked entry. (The backend allows a
   null `project_id`, so nothing downstream rejected it.)

## Fix

- `loadProjects()` re-enables the dropdown after populating, via a new
  `syncProjectSelectEnabled()` helper (also applied on the "kept current list" path).
- `updateDisplay()` no longer force-enables Start when stopped — it defers to
  `updateStartBtnState()`, so Start stays disabled until a project is selected.
- Tray: removed "No Project" / the unassigned plain start. With projects, the submenu lists
  them; with none cached, "Start Timer…" opens the app (and refreshes projects) instead of
  starting unassigned.

## Note / follow-up

The backend still accepts a tracked entry with `project_id = null` (the desktop now enforces
project-required only client-side). If the product wants a hard guarantee, add a server-side
rule requiring `project_id` for `type = tracked` starts.

## Verify

- `cd desktop && npm test` — full suite green (466/466).
- Manual (Windows): login → dropdown populates and is selectable; Start stays disabled until a
  project is chosen; tray offers projects (no "No Project") or opens the app when none cached.

## Key files

- `desktop/src/renderer/index-renderer.js` — `loadProjects()`, `updateDisplay()`,
  `syncProjectSelectEnabled()`, `updateStartBtnState()`.
- `desktop/src/main/index.js` — tray "Start Timer" menu.
