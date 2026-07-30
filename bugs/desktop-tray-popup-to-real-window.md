# Desktop main window: tray popup → real application window

**Area:** Desktop agent — main window, window chrome, keyboard shortcuts
**Severity:** P2 (UX) — with two P2 functional defects surfaced en route
**Status:** ✅ FIXED on `feat/desktop-real-window-and-ui-redesign` (2026-07-30) — awaiting cross-platform QA
**Reported:** Owner, 2026-07-29 — _"the ui ux is broken … or we can create the new app which has close minimize and expand button just like a mac desktop app not a tray, same for windows same for linux"_

---

## Symptom

The agent window looked cramped and unfinished: eight stacked blocks (permission /
wallpaper / offline / idle banners, connection line, shift banner, timer,
all-projects total, project select, activity bar, actions, footer) crushed
together with no breathing room, a full-bleed yellow warning slab competing with
the timer for attention, and a saturated coral **Stop** slab filling the bottom
third.

It also did not behave like an application. It vanished when you clicked into
another window, it had no minimise/maximise/close, it did not appear in the
Dock or taskbar, and it could not be resized anywhere except Windows.

## Root cause

The crowding was a **symptom of the window, not the CSS**. `createPopupWindow()`
built a tray-anchored utility popup:

- `frame: false`, `skipTaskbar: true` — no native controls, no Dock/taskbar entry
- fixed `320x480`, `resizable: IS_POPUP_RESIZABLE` (Windows only)
- re-anchored to the tray icon on every show, always forced onto the primary display
- **hide-on-blur**, debounced, plus a macOS `_startUnpinnedFocusWatch()` poll that
  hid the window after ~600ms of sustained unfocus so a desktop/wallpaper click
  would dismiss it too

No layout survives eight blocks in 480px. Restyling alone could not fix it.

The old `alwaysOnTop` default of **true** existed only to defeat hide-on-blur —
pinning was the sole way to keep the popup visible while you worked.

## Two functional defects this surfaced

Both were survivable for a throwaway popup and are not for a real window:

1. **`Cmd/Ctrl+Q` signed the user out** instead of quitting.
   `index-renderer.js` bound it to `handleLogout()`. On a window with a Dock
   entry, Cmd+Q means quit, universally — and signing out is a much more
   destructive misfire than the user intended.
2. **`Escape` was dead.** It called `window.blur()` and relied on the hide-on-blur
   handler to dismiss the window. Removing that handler left it a no-op.

A third, latent: **no application menu was ever installed**, so Electron supplied
its stock default. Invisible behind a frameless window — but a framed one renders
that menu bar (*Reload*, *Toggle DevTools* included) inside the frame on
Windows/Linux.

## Fix

`src/main/window-geometry.js` (new, replaces `popup-size.js`) — pure, no Electron
import, unit-tested:

| Concern | Rule |
| --- | --- |
| Default size | `440x560` (natural content height is ~450px) |
| Minimum | `380x480` — verified: nothing clips, footer stays visible |
| Maximum | **none** — it is a normal window; the user may fill their screen |
| Persistence | full rect (x/y/w/h), debounced on `resize`+`move`, skipped while maximised/minimised |
| Off-screen rescue | a rect stranded by an unplugged monitor keeps its SIZE but is re-centred on the primary display |
| Chrome | per-platform, see below |

Per-platform chrome (`resolveWindowChrome()`) — all three get **native** controls:

- **macOS** — `titleBarStyle: 'hiddenInset'` + `trafficLightPosition`, so the
  traffic lights float over our own branded header row.
- **Windows** — `titleBarStyle: 'hidden'` + `titleBarOverlay`, so the OS paints
  minimise/maximise/close into the right of that same row.
- **Linux** — a plain native frame. `titleBarOverlay` support varies by WM and
  compositor (GNOME vs KDE, X11 vs Wayland), and a frameless window the WM
  refuses to decorate is **undraggable and unclosable**. The header row simply
  sits below the WM's own title bar.

Behaviour:

- **Close hides, it does not destroy** (`'close'` → `preventDefault()` + `hide()`
  unless `isQuitting`). Tidying your desktop can never kill a running timer.
  Quit stays deliberate — tray, or Cmd/Ctrl+Q — and still runs the `before-quit`
  graceful stop + offline-queue flush.
- **No hide-on-blur**, and `_startUnpinnedFocusWatch()` is retired to a no-op
  (kept as a function so its call sites and any stale interval still clear).
- `app.on('activate')` re-shows on Dock/taskbar click — mandatory once close only hides.
- `showPopup()` no longer re-anchors to the tray or forces the primary display;
  it restores where the user left it, applying only the off-screen rescue.
- **`alwaysOnTop` now defaults to `false`.** Only the "never chose" case flips;
  an explicit user choice is preserved.
- Application menu: `null` on Windows/Linux; a real menu on macOS, because
  without one Cmd+C/V/A, Cmd+W, Cmd+M and Cmd+Q all stop working there.
- Sign-in window gets the same native chrome (it is the first screen users see),
  with `useContentSize` so Linux's title bar is not taken out of a fixed,
  non-resizable form.

Layout (`index.html`): connection + shift collapsed onto one status strip; the
timer promoted to a content-sized hero card using `margin-block: auto` so free
space splits evenly above and below it; warning slabs replaced by compact
colour-ruled alert strips; a labelled control group; and a `max-height: 500px`
fallback where the hero surrenders padding first so the controls and footer are
never what clips.

## Evidence

| What | Where (pre-fix) |
| --- | --- |
| Frameless, taskbar-less, fixed-size popup | `desktop/src/main/index.js:3126-3152` |
| Hide-on-blur | `desktop/src/main/index.js:3220-3245` |
| macOS unfocused-ticks auto-hide | `desktop/src/main/index.js:2877-2935` |
| Tray re-anchor on every show | `desktop/src/main/index.js:3046-3069` |
| `alwaysOnTop` default true | `desktop/src/main/index.js:272-280` |
| Cmd+Q → sign out | `desktop/src/renderer/index-renderer.js` (keydown handler) |
| Escape → `window.blur()` | same handler |

## Verification

- `window-geometry.test.js` — 24 tests: size floor, no ceiling, fractional-DPI
  rounding, off-screen detection (incl. a title-bar-sliver case), unplugged
  second monitor, re-centre-keeps-size, and the per-platform chrome contract
  (notably: **Linux must never be frameless**).
- Full desktop suite green at **685**.
- Layout verified by screenshotting the real renderer against a stubbed preload
  across running / stopped / offline / light-theme / `380x480` minimum / sign-in.
  This is what caught the hero card swallowing ~150px of dead space and the Stop
  button reading as an error state.

## Known gaps — needs QA on real hardware

The chrome itself is OS-drawn and cannot be captured by `capturePage()`, so it is
covered by contract tests but **not** visually verified:

- macOS traffic-light inset alignment against the 80px header reserve
- Windows caption-overlay alignment against the 138px reserve (and Win 10 vs 11)
- Linux decorations across GNOME/KDE and X11/Wayland — the highest-risk surface
- Restoring a window saved on a monitor that is later unplugged
