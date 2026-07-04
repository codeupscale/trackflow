# Desktop: close button should be disabled while modal is pinned

**Status:** ✅ FIXED (2026-07-02, `fix/qa-build-1.0.41-dev.64-batch`) — QA build 1.0.41-dev.64, issue #9 (P2).

**Scope:** Desktop popup pin/unpin logic + close-button state. `desktop/src/renderer/index-renderer.js`, `desktop/src/main/index.js`.

**Severity:** P2 — UX/consistency: a pinned (always-on-top) modal should only be closable after unpinning.

## Symptom

When the modal is pinned, the close button is still active. Per product intent the modal should only be closable after it is unpinned.

## Fix

- **Renderer (`index-renderer.js`):** `updatePinUI` now sets `hideBtn.disabled = pinned`, with dimmed styling and an "Unpin to close" tooltip. Because the popup defaults to pinned, the close button starts disabled.
- **Main (`index.js`):** the `hide-window` IPC also refuses to hide while `isAlwaysOnTop` (defense in depth). The tray-toggle and blur-hide paths call `popupWindow.hide()` directly and are intentionally unaffected — those are legitimate non-user-close paths.

## Cross-platform notes

Pure UI-state + IPC guard; no platform-specific branches. `isAlwaysOnTop` is cross-platform. Verified statically.

## Key files

- `desktop/src/renderer/index-renderer.js` — `updatePinUI` disables/dims the close button while pinned.
- `desktop/src/main/index.js` — `hide-window` IPC refuses to hide while pinned.

## Verification

- `cd desktop && npx jest` → 519/519.
