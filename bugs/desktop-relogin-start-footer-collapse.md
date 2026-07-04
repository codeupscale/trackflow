# Desktop: Sign Out / Dashboard buttons collapse against modal edge after re-login + Start

**Status:** ✅ FIXED (2026-07-02, `fix/qa-build-1.0.41-dev.64-batch`) — QA build 1.0.41-dev.64, issue #7 (P2).

**Scope:** Desktop popup window sizing + layout state across logout/login. `desktop/src/main/index.js`, `desktop/src/renderer/index.html`.

**Severity:** P2 — layout defect after a specific sequence; functionality works but the footer buttons clip against the window edge.

## Symptom

Sequence: sign out → sign back in → click **Start**. The Sign Out and Dashboard buttons collapse/clip against the app modal edge. A fresh launch does not exhibit this.

## Root cause

Two compounding factors:
1. The popup rebuilt after logout/login could be a few pixels shorter than the intended 320×400 under **fractional DPI**, and the new "Today, all projects" line (issue #1) added height. When the activity section becomes visible on Start, the footer got pushed out and clipped.
2. The flex column layout let the timer block hold its intrinsic height, so there was no room left to shrink when the activity section appeared.

## Fix

- **Main process:** re-assert `setContentSize(POPUP_WIDTH, POPUP_HEIGHT)` on `ready-to-show` in the window-create branch, so a rebuilt popup always gets the exact intended dimensions regardless of DPI rounding.
- **CSS hardening (`index.html`):** `min-height:0` on `.content` and `.timer-display` (allow the flex children to shrink); `flex-shrink:0` on `.select-wrap`, `.activity-section.visible`, `.actions`, and `.footer` so the footer is never compressed/clipped when the activity section appears.

## Cross-platform notes

`setContentSize` is cross-platform; the DPI rounding that triggered this is most visible on **Windows fractional DPI**. Verified statically. CSS changes are platform-agnostic.

## Key files

- `desktop/src/main/index.js` — `setContentSize` re-assert on `ready-to-show`.
- `desktop/src/renderer/index.html` — flex `min-height`/`flex-shrink` hardening.

## Verification

- `cd desktop && npx jest` → 519/519.

## Follow-up / QA note

Recommend manual QA of the sign out → sign in → Start sequence on a Windows machine with fractional (125%/150%) display scaling.
