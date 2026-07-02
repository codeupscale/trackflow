# Desktop: unpinned modal doesn't close when clicking away to the desktop

**Status:** ✅ FIXED (2026-07-02, `fix/qa-build-1.0.41-dev.64-batch`) — QA build 1.0.41-dev.64, issue #8 (P2).

**Scope:** Desktop popup window blur / focus-loss handling. `desktop/src/main/index.js`.

**Severity:** P2 — minor UX: an unpinned popup should auto-hide when it loses focus but lingers when the user clicks the desktop/wallpaper.

## Symptom

When the modal is **unpinned**, clicking away to the desktop/wallpaper does not close it; it stays open until the user clicks somewhere that fires a blur.

## Root cause

The auto-hide relied solely on the window `blur` event. On **macOS**, clicking the wallpaper/desktop moves focus to no window and does **not** reliably fire `blur` on the popup, so it stayed visible.

## Fix

- **macOS only:** added a lightweight focus-loss poll that runs while the popup is visible and unpinned. Two consecutive unfocused samples (~600ms) hide the popup. The poll is tied to show/hide/focus and both pin toggles, and is cleaned up on logout (no stale timers, consistent with store/timer hygiene).
- **Windows / Linux:** intentionally keep the existing `blur` event — it already fires on desktop clicks there, and a focus poll would wrongly hide the popup while a **native `<select>` dropdown** is open (the OS moves focus to the dropdown). This preserves the fix in `desktop-windows-project-dropdown-selection-lost.md`.

## Cross-platform notes

- macOS: focus-loss poll (new). Verified statically.
- Windows/Linux: unchanged blur behavior — deliberately not switched to polling to avoid regressing the native-select dropdown interaction.

## Key files

- `desktop/src/main/index.js` — macOS focus-loss poll, tied to show/hide/focus/pin, cleaned up on logout.

## Verification

- `cd desktop && npx jest` → 519/519.

## Follow-up / QA note

Recommend manual QA on macOS confirming: click wallpaper → popup hides; open project dropdown → popup stays; and on Windows/Linux confirm the dropdown still works while pinned.
