# Desktop — tray popup too vertically condensed

**Status:** ✅ DONE (2026-07-28)
**Severity:** P3 — UX / readability, no functional impact
**Area:** Desktop agent popup layout (`desktop/src/renderer/index.html`, `desktop/src/main/popup-size.js`)
**Branch:** `fix/idle-alert-lock-offline-screenshots-and-signout-sync`
**Reported by:** Owner — "the UI is looking so condensed, please increase vertical space so it stays user friendly."

## Symptom

At the designed 320×400 the popup is comfortable only in the empty state. In a real
tracking session the column carries, top to bottom:

offline banner → connection status line → shift banner → big timer → status row →
"Today, all projects" line → project select → activity header + bar → Start/Stop →
footer (Open Dashboard / Sign out)

Every block sat on its neighbour with 2–8px between them. The 11px footer text on a
10px padding-top gave a small hit target for the two links, and the "Today, all
projects" line visually merged into the status row above it.

## Fix

Sizing (`popup-size.js` — single source of truth, shared with the Windows resize
envelope):

| | before | after |
|---|---|---|
| design / min height | 400 | **480** |
| max height | 640 | **720** |
| width | 320 | 320 (unchanged) |

Spacing (`index.html`):

- `.content` padding `12/16/16` → `14/18/18`
- `.timer-display` padding `20px 0` → `26px 0 22px`; `.time` 42 → 44px with an explicit `line-height`
- `.status` margin-top `4` → `10px`; `.total-sum` `11px/3px` → `12px/8px`
- `.select-wrap` `8px 0` → `12px 0 4px`; `.actions` padding `8px 0` → `12px 0 6px`, button padding `10` → `12px`
- `.activity-section` `4/8` → `12/4`; header margin-bottom `4` → `7px`; bar `6px` → `8px` (radius 3 → 4)
- `.shift-info` padding `6/10` → `9/11`, radius 6 → 8; `.conn-status` padding `2px 0` → `6px 0 2px`
- `.footer` gains `margin-top:12px`, padding-top `10` → `14px`, font 11 → 12px, and `.footer a { padding: 4px 0 }` for a real hit target
- `.permission-banner` padding `8/12` → `10/12`, margin-bottom `8` → `10px`

The existing flex hardening from
[desktop-relogin-start-footer-collapse.md](desktop-relogin-start-footer-collapse.md)
(`min-height:0` on `.content`/`.timer-display`, `flex-shrink:0` on the interactive
rows) is untouched, so the layout still degrades gracefully below the floor under
fractional DPI — the timer block absorbs the shrink and the footer never clips.

## Verification

`desktop/test/popup-size.test.js` updated to the new 320×480 / 480×720 envelope
(the DPI-drift regression case became `318×477`). Full desktop suite: **671 passed
/ 41 suites**.

Manual QA recommended on Windows fractional DPI (the resizable platform) and on a
small-height display.
