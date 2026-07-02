# Idle alert shows on only one display (multi-monitor)

**Status:** ✅ FIXED (2026-07-02, `fix/qa-build-1.0.41-dev.64-batch`) — QA build 1.0.41-dev.64, issue #4 (P1).

**Scope:** Desktop idle detector alert window creation. `desktop/src/main/index.js`.

**Severity:** P1 — on multi-monitor setups the idle alert can be missed entirely if the user is looking at a secondary display.

## Symptom

QA: the idle alert (Keep / Discard / Reassign) appears on only one display. On multi-monitor setups it should appear on every active display.

## Root cause

`showIdleAlert()` created a single alert window with `center: true`, which places it on the **primary display only**. Users working on a secondary monitor never saw it.

## Fix

- Create one alert window per `screen.getAllDisplays()`, each centered on its own display's `workArea`.
- The window on the **cursor's current display** is the interactive primary and drives the full close / re-show state machine; the others are mirrors that share the same resolve path (any of them resolving the Keep/Discard/Reassign action applies once).
- `idle-data`, theme, and project-refresh broadcasts are sent to **all** alert windows so they stay in sync.
- `dismissIdleAlert()` and the unexpected-close teardown destroy **ALL** alert windows together, so no orphaned windows are left behind.
- Electron security settings (`contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, `contextBridge` preload) preserved on every alert window.

## Cross-platform notes

- **Windows / macOS:** `screen.getAllDisplays()` returns per-monitor bounds; windows centered on each `workArea`. Verified statically.
- **Linux / Wayland:** the compositor owns final window placement, so exact centering per output is compositor-dependent; the alert still appears on the active output. Documented caveat.

## Key files

- `desktop/src/main/index.js` — `showIdleAlert()` (per-display window creation), `dismissIdleAlert()` (teardown of all windows).

## Verification

- `cd desktop && npx jest` → 519/519 (new `test/idle-alert-window.test.js` covers per-display creation + teardown of all windows).

## Follow-up / QA note

Multi-monitor placement verified statically + via unit tests; recommend targeted manual QA on a real multi-monitor macOS and Windows setup, plus a Wayland session, to confirm compositor placement.
