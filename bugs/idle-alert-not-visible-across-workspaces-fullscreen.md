# Idle alert not visible across workspaces / fullscreen apps

**Status:** ✅ FIXED (2026-07-03, `fix/idle-alert-all-workspaces`) — owner testing, follow-up to the multi-monitor idle-alert fix.

**Scope:** Desktop idle detector alert window creation. `desktop/src/main/index.js`.

**Severity:** P1 — a user working in another virtual desktop / macOS Space, or inside a fullscreen app, never sees the idle alert (Keep / Discard / Reassign) and their tracked time is auto-resolved without their input.

## Symptom

Owner: with multiple workspaces/desktops in use (macOS Spaces, fullscreen apps, Windows/Linux virtual desktops), the idle alert only shows on the workspace where it was created. If the user is working in another workspace or a fullscreen app they never see it. By contrast the tray **popup** window follows the user everywhere ("the desktop app appears in each window").

## Root cause

`showIdleAlert()` created each alert window relying on the BrowserWindow **constructor option** `visibleOnAllWorkspaces: true`. Electron has **no such constructor option** — it is silently ignored. So the alert only ever inherited the plain `alwaysOnTop: true` (which uses the `'floating'` window level) and stayed pinned to the Space / virtual desktop it was born on. A macOS fullscreen app lives on its own dedicated Space, and `'floating'` does not rise above it, so the alert was doubly invisible there.

The tray popup does **not** have this problem because it applies the everywhere-visible treatment via the **method** `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` after window creation (see the popup show path and the Linux branch in `index.js`), not a constructor flag.

## Fix

Added `_applyIdleAlertEverywhereVisible(win)` and call it inside the shared `_createIdleWindowOnDisplay()` factory, so **every** alert window (the cursor-display primary **and** every per-display mirror) gets the same treatment the popup uses:

- `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` — appears on every macOS Space **and** over fullscreen apps (the `visibleOnFullScreen` flag is the critical part the constructor option could never provide).
- `setAlwaysOnTop(true, 'screen-saver')` — the highest standard always-on-top level; floats above a fullscreen Space and the menu bar where the default `'floating'` level does not.

Removed the dead `visibleOnAllWorkspaces: true` constructor option (it never did anything). Guarded the helper with `isDestroyed()` + try/catch so a torn-down window is a safe no-op.

The `win.focus()` in the existing `showAndSendData()` path is unchanged — the level only affects z-order / Space membership, not macOS activation policy, so it does not steal focus beyond what the code already did and the close / re-show state machine is untouched.

## Exact window options applied (per platform)

| Platform | `setVisibleOnAllWorkspaces(true, {visibleOnFullScreen:true})` | `setAlwaysOnTop(true, 'screen-saver')` | Result |
| --- | --- | --- | --- |
| macOS | Effective — every Space + over fullscreen apps | `'screen-saver'` level (NSScreenSaverWindowLevel-class) clears fullscreen Spaces + menu bar | Alert follows the user across every Space and surfaces over fullscreen apps |
| Windows | Documented no-op (no Spaces API) | Maps to `HWND_TOPMOST` | Alert sits over other apps (parity with popup always-on-top); Windows virtual desktops have no per-app "show on all" API, so a topmost window is the available behavior |
| Linux / X11 | Best-effort workspace pinning via the compositor | Maps to `_NET_WM_STATE_ABOVE` | Alert floats above other apps; workspace pinning honored by most EWMH compositors |
| Linux / Wayland | Advisory only — compositor owns workspace/output placement | Advisory only — compositor owns stacking | Alert appears on the active output; the app cannot force it onto every virtual desktop (same documented limitation as the multi-monitor fix) |

## Cross-platform notes

- Documented the Wayland compositor-owned limitation in-code, consistent with the multi-monitor fix.
- Electron security settings (`contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, `contextBridge` preload) preserved on every alert window. The multi-display creation + `dismissIdleAlert()` teardown logic is unchanged.

## Key files

- `desktop/src/main/index.js` — new `_applyIdleAlertEverywhereVisible()`; `_createIdleWindowOnDisplay()` now calls it and no longer passes the dead `visibleOnAllWorkspaces` constructor option.
- `desktop/test/idle-alert-window.test.js` — new "follows user across workspaces / fullscreen" suite asserting every created window (primary + all mirrors) gets `visibleOnFullScreen:true` + `'screen-saver'`.

## Verification

- `cd desktop && npx jest` → 539/539 passing (was 533; +6 new assertions in the workspace/fullscreen suite; replaced one stale stub test).

## Follow-up / QA note

Behavior verified statically + via unit tests (mocked BrowserWindow). Recommend targeted manual QA: go idle while (a) on a different macOS Space, (b) inside a macOS fullscreen app, (c) on a different Windows/Linux virtual desktop — confirm the alert surfaces in all three. On Wayland, confirm it appears on the active output.
