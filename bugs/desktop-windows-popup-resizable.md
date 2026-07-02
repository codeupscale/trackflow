# Desktop: make the tray popup user-resizable on Windows (drag edges/corners)

**Status:** ✅ DONE (2026-07-02, `feat/desktop-windows-popup-resizable`) — QA build 1.0.41-dev.64, enhancement #10 (P3, enhancement).

**Scope:** Desktop tray popup window sizing. `desktop/src/main/index.js`, `desktop/src/main/popup-size.js` (new), `desktop/src/renderer/index.html`, `desktop/src/renderer/index-renderer.js`.

**Severity:** P3 — enhancement, not a defect. The popup worked correctly; QA wanted Windows users to be able to resize it like a normal desktop app.

## Request

The popup is a frameless, fixed-size (`POPUP_WIDTH`×`POPUP_HEIGHT` = 320×400), non-resizable `BrowserWindow`. On macOS QA is satisfied. QA asked for **Windows** users to be able to resize the window by dragging its edges/corners.

## Feasibility decision (per platform)

| Platform | Resizable? | Reasoning |
| --- | --- | --- |
| **Windows** | ✅ Yes | Frameless windows support native edge/corner resize when `resizable: true` + the default `thickFrame` (WS_THICKFRAME) is kept. This is exactly what QA asked for. |
| **macOS** | ❌ No (unchanged) | QA is already satisfied on macOS. The popup relies on fixed-size positioning and the issue #8 focus-loss poll; enabling resize adds risk with no requested benefit. |
| **Linux (X11 + Wayland)** | ❌ No (unchanged) | Not requested. On Wayland window geometry is compositor-owned, so a "resizable" flag is unreliable anyway. Kept fixed to avoid any regression. |

Only Windows changes behaviour. Everywhere else the code paths resolve to the exact previous fixed-size behaviour.

## Implementation

- **New module `popup-size.js`** — single source of truth for the popup dimensions and the pure clamp/resolve rules (unit-tested; no Electron dependency). `index.js` now sources `POPUP_WIDTH/HEIGHT/MIN/MAX` from it.
  - `POPUP_MIN_WIDTH/HEIGHT` = 320×400 (the designed floor — the issue #7 flex layout is authored against it, so content can never collapse below it).
  - `POPUP_MAX_WIDTH/HEIGHT` = **480×640** (1.5× the design size in each axis — keeps the tray popup a compact utility window; decision: capped rather than unbounded so it can't be blown up to fill the screen).
  - `clampPopupSize()` rounds to whole px and clamps to `[min, max]`, falling back to min on NaN/invalid.
  - `resolvePopupSize(persisted, isResizable)` — non-resizable platforms **always** get the fixed design size regardless of any persisted value.
- **Window creation (`index.js`)** — `resizable: IS_POPUP_RESIZABLE` (`process.platform === 'win32'`). On Windows only: `thickFrame: true` + `minWidth/minHeight/maxWidth/maxHeight`. macOS/Linux get no size constraints (untouched).
- **Persistence** — Windows only. The chosen size is saved (debounced, 400ms) on the window `resize` event via the existing `user-prefs.json` store (`saveUserPrefsPatch({ popupSize })`), and restored on next create/show. Survives hide/show and app restarts. `savePopupSize()`/`loadPopupSize()` are no-ops that return the fixed size off Windows.
- **Issue #7 interplay (critical, preserved)** — the `ready-to-show` `setContentSize(...)` re-assert (added in commit `79abfeb5` to fix fractional-DPI footer clipping after relogin) now re-asserts the **persisted** size on Windows instead of the fixed 320×400, but always via `loadPopupSize()` which clamps to the 320×400 minimum — so the footer can never clip. On macOS/Linux `loadPopupSize()` returns exactly `{POPUP_WIDTH, POPUP_HEIGHT}`, i.e. byte-for-byte the previous issue #7 behaviour. The reshow reposition (`_repositionToPrimaryDisplay`, the SHRINK/anti-drift path) likewise re-asserts the persisted size on Windows so a user-resized window isn't snapped back to 320×400 on every reshow.
- **Renderer (`index.html` + `index-renderer.js`)** — the `.titlebar` is a `-webkit-app-region: drag` region covering the top edge, which blocks the native top-edge resize handle on frameless Windows. Added a thin (6px) `-webkit-app-region: no-drag` strip (`.resize-edge-top`) pinned to the very top. It is `display:none` everywhere and only shown under `html.platform-win` (class set from `navigator.platform` in `index-renderer.js`), so macOS/Linux keep the full-height drag titlebar with zero change. Left/right/bottom edges are already no-drag (`.content` is not a drag region), so only the top edge needed carving out. The existing issue #7 flex hardening (`min-height:0` on `.content`/`.timer-display`, `flex-shrink:0` on `.select-wrap`/`.activity-section.visible`/`.actions`/`.footer`) keeps the layout fluid at larger sizes.

## Security

Electron settings unchanged: `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true` on all windows; IPC still contextBridge-only. No new IPC surface (size persistence lives entirely in the main process, driven by the native `resize` event).

## Cross-platform notes

Verified statically that macOS/Linux resolve to the previous fixed-size code paths (`IS_POPUP_RESIZABLE === false` → no constraints, `resolvePopupSize(..., false)` → design size, `.resize-edge-top` hidden). Windows edge-resize + persistence needs manual QA on a real Windows machine (incl. fractional 125%/150% DPI).

## Key files

- `desktop/src/main/popup-size.js` — new: dimensions + clamp/resolve rules.
- `desktop/src/main/index.js` — `resizable`/`thickFrame`/min-max, debounced resize persistence, persisted-size restore on create/reshow/ready-to-show.
- `desktop/src/renderer/index.html` — `.resize-edge-top` element + CSS.
- `desktop/src/renderer/index-renderer.js` — `html.platform-win` class from `navigator.platform`.
- `desktop/test/popup-size.test.js` — new: clamp / min-floor / max-ceiling / platform-gate regression tests.

## Verification

- `cd desktop && npx jest` → 533/533 (523 prior + 10 new `popup-size` tests).

## Follow-up / QA note

Manual QA on Windows 10/11: drag each edge and corner; confirm it won't shrink below 320×400 or grow past 480×640; resize, hide to tray, reshow → size preserved; resize, restart app → size preserved; confirm the top-edge resize works despite the titlebar drag region; confirm macOS/Linux popup is still fixed-size and the titlebar still drags the window.
