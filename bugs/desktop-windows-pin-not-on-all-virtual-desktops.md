# Pinned desktop window does not appear on other Windows virtual desktops

| | |
|---|---|
| **Area** | Desktop agent — main window pin ("Always on Top") |
| **Platform** | Windows **only** (macOS correct, Linux correct) |
| **Severity** | P2 |
| **Reported** | 2026-07-31 (owner) |
| **Status** | ✅ FIXED (2026-07-31, branch `fix/desktop-windows-pin-all-virtual-desktops`) |

## Symptom

Pinning the window with the pin button keeps it above other apps, but on Windows
it only ever stays on the virtual desktop it was opened on. Switch to another
desktop (Win+Ctrl+←/→, Task View) and the pinned window is simply gone; switch
back and it is there again. On macOS the same pin works correctly across Spaces.

This is about the **Windows "multiple desktops"** feature, not multiple monitors —
a second monitor already worked, because the window keeps whatever rect the user
dragged it to.

## Root cause

`BrowserWindow.setVisibleOnAllWorkspaces()` — the API that makes a window follow
the user across Spaces/workspaces — is a **documented no-op on Windows**
(`@platform darwin,linux`; the Electron typings literally say *"This API does
nothing on Windows"*). The pin path therefore only ever called `setAlwaysOnTop()`,
which controls z-order **within** the window's own virtual desktop and says
nothing about desktop membership.

Windows exposes no supported API to place a window on every virtual desktop
either. The shell's own "Show this window on all desktops" (taskbar right-click)
goes through `IVirtualDesktopManagerInternal` / `IVirtualDesktopPinnedApps`,
undocumented COM interfaces whose IIDs change with essentially every Windows
build — calling them would break on the next feature update and would require a
native module in a three-platform Electron build.

The same limitation was already recorded as a residual on the idle alert:
*"Residual: Windows can't mirror onto every virtual desktop (active desktop
only)"* — see `desktop-idle-window-multiscreen-and-sleep.md`.

## Fix — the pinned window FOLLOWS the user

Rather than being on all desktops at once (impossible without undocumented COM),
the pinned window is moved to whichever desktop the user switched to. Windows
re-assigns a window to the **active** virtual desktop when it is shown, so
`hide()` + `showInactive()` teleports it there. `showInactive`, never
`show()`/`focus()` — the user is typing in another app and a tracker must not
steal keystrokes.

Detecting "the user walked away" needs no native code: **Chromium marks a window
sitting on another virtual desktop as occluded**, which stops its animation
frames and flips `document.visibilityState` to `hidden`. The renderer reports
that state; the main process acts on it.

| File | Role |
|---|---|
| `desktop/src/main/virtual-desktop-follow.js` | **New.** Pure decision function `decideFollowAction()` — no Electron import, unit-tested (same pattern as `window-geometry.js`) |
| `desktop/src/main/index.js` | `_onRendererComposited()` → `_evaluateVirtualDesktopFollow()` → `_moveWindowToCurrentVirtualDesktop()`; `report-composited` IPC; `showPopup()` hides first when the window is parked elsewhere |
| `desktop/src/preload/index.js` | `reportComposited(bool)` (fire-and-forget `send`) |
| `desktop/src/renderer/index-renderer.js` | Windows-only compositing probe: `visibilitychange` (instant) + one-rAF-per-poll starvation backstop |
| `desktop/test/virtual-desktop-follow.test.js` | 12 tests |

### Guards (all in the pure module, all tested)

- **Windows only** — macOS/Linux return `none`; they pin across workspaces natively and must not pay for the probe.
- **Pinned only** — an unpinned window behaves like any ordinary window and stays where the user left it. The behaviour is tied to the pin button exactly as reported.
- **Never resurrects a dismissed window** — `isVisible()` false (hidden to tray via the close button / Escape) or `isMinimized()` ⇒ no action. This is the worst failure mode the feature could have, so it is the first thing checked.
- **400ms confirm** before acting, so a transient frame stall (window drag, GPU hiccup) can't yank the window around.
- **1.5s cooldown** between moves — a follow can never become a flicker loop.
- **Gives up after 3 failed moves** until the window is composited again or the pin is re-toggled: better a pin that under-delivers on an exotic setup than a window that hides and re-shows itself forever.

### Bonus fix in the same path

`showPopup()` (tray → "Open App Window", tray click) called `show()` on a window
that could be parked on another virtual desktop — Windows responds by dragging
**the user** across to that desktop. It now hides first when the window is known
to be off-desktop, so the window comes to the user instead.

## Why not the alternatives

| Option | Why not |
|---|---|
| `setVisibleOnAllWorkspaces(true)` on Windows | Documented no-op. This was the original (silent) failure. |
| `IVirtualDesktopPinnedApps::PinWindow` via native addon | Undocumented COM, IIDs change per Windows build; needs a compiled native module in the Windows build pipeline. Fragile by construction. |
| Poll `IVirtualDesktopManager::IsWindowOnCurrentVirtualDesktop` (public COM) | Still needs FFI/native or a long-lived PowerShell child process (memory budget + EDR noise) to reach a signal Chromium already computes for us. |
| Permanent `requestAnimationFrame` loop for detection | Pins the compositor at 60fps forever — unacceptable for an app with a <150MB idle / low-CPU budget. One rAF per 700ms poll costs a single frame. |

## Verification

- `npx jest` in `desktop/` — 42 suites / 727 tests pass (12 new).
- **Manual Windows QA required** (cannot be reproduced on macOS):
  1. Pin the window on Desktop 1 → Win+Ctrl+→ to Desktop 2 → the window appears there within ~1s, without stealing focus from the app you're typing in.
  2. Switch back to Desktop 1 → it follows back.
  3. Unpin → switch desktops → it correctly stays put (ordinary window behaviour).
  4. Close (X) to hide to tray → switch desktops → it does **not** reappear.
  5. Minimise → switch desktops → it stays minimised.
  6. Tray → "Open App Window" from a different desktop → the window comes to you, the desktop does **not** switch under you.
  7. macOS/Linux unaffected — pin still holds across Spaces/workspaces, no new polling.
