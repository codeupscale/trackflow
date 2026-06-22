# Idle reassign dropdown loses the selected project

**Status:** ✅ FIXED (2026-06-22, `develop`)

**Scope:** Desktop agent — idle alert reassign project picker (`idle-alert.js`).

**Severity:** P2 — selecting a project for reassign didn't "stick"; the dropdown snapped back to the placeholder.

## Symptom

In the idle alert, pick a project from the **Reassign** dropdown and it doesn't show as
selected — it reverts to "Reassign to project…" (and the Reassign button stays disabled).

## Root cause

The main process re-sends the `idle-data` IPC to the open alert in several cases — most reliably
`refreshProjectsIfStale()` fired on alert show (`index.js`), which async-reloads projects and
pushes `idle-data` again once the fetch lands; also the 30-min refresh interval and
resume-after-sleep. The renderer's `onIdleData` handler **unconditionally rebuilt the `<select>`
via `sel.innerHTML = …`**, which reset any user selection back to the placeholder. So a project
picked between show and the (slightly later) refresh push got wiped.

## Fix

`onIdleData` now only rebuilds the options when the project list actually changed (or the select
is empty), and **preserves/restores the current selection** across a rebuild, then re-evaluates
the Reassign button's disabled state. Identical re-sends no longer touch the selection.

## Verify

- `cd desktop && npm test` — 480/480.
- Manual: trigger idle → open Reassign dropdown → pick a project → it stays selected and the
  Reassign button enables, even as the background project refresh lands.

## Key files

- `desktop/src/renderer/idle-alert.js` — `onIdleData` reassign-select population.
