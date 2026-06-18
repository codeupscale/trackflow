# Timer Window — Pin Doesn't Hold, Click-Away Closes It, Window Shrinks on Each Click

**Status:** Fixed
**Found:** 2026-06-18 (QA on TrackFlow Desktop `1.0.41-dev.31`, post Electron 28 → 42 upgrade)
**Platform:** Windows (taskbar); pin/blur logic affects all platforms. DPI shrink is Windows fractional-scaling specific.
**Severity:** P1 — the timer popup is the primary desktop surface; it is unusable as a pinned window.

## Symptoms (as reported by QA)

1. **Pin does nothing.** Start the timer, click the Pin button — the timer window is not pinned.
2. **Click-away closes it.** Clicking any other area (another app/window) closes the TrackFlow popup.
3. **Window shrinks on every click.** Clicking TrackFlow from the taskbar makes the popup a little
   smaller each time, click after click.

## Root cause

Two independent bugs in [desktop/src/main/index.js](../desktop/src/main/index.js).

### A. Blur handler ignored the pin state (symptoms 1 & 2)

The popup's `blur` handler hid the window on **every** focus loss, regardless of whether the user
had pinned it. "Pin" only ever set the always-on-top **z-order** (`setAlwaysOnTop`) — it never
suppressed the auto-hide. So pinning had no visible effect: the moment you clicked into another
app, the popup lost focus and the blur handler hid it anyway. To the user, "pin is broken" and
"clicking elsewhere closes the window" are the same bug.

This logic predates the Electron 42 upgrade (the blur handler never checked `isAlwaysOnTop`), but
QA exercised the pin workflow on the new dev build and surfaced it. The default state is
`isAlwaysOnTop = true`, so even a fresh install was affected.

`blur` handler before the fix (~[index.js:1707](../desktop/src/main/index.js#L1707)):
```js
popupWindow.on('blur', () => {
  if (blurTimeout) { clearTimeout(blurTimeout); blurTimeout = null; }
  if (Date.now() - _lastTrayClickAt < 300) return;
  blurTimeout = setTimeout(() => {
    if (popupWindow && !popupWindow.isDestroyed() && !popupWindow.isFocused()) {
      popupWindow.hide();          // hides even when pinned
    }
  }, 150);
});
```

### B. Frameless window shrank on re-show under fractional DPI (symptom 3)

There is **no** app code that resizes the window — confirmed by grep across `main`, `renderer`,
and `preload` (no `setSize` / `setContentSize` / `setZoomFactor` / `resizeTo`). The shrink is an
Electron 42 (Chromium) behavior change: a `frame: false`, `resizable: false` window on a Windows
fractional-scaling display (125% / 150%) has its bounds rounded **down by the scale factor each
time it is re-shown**. Every taskbar/tray click runs `showPopup()` →
`_repositionToPrimaryDisplay()`, which called `win.setPosition(x, y)` — position only. Because the
size was never re-asserted, each show preserved the already-shrunk size and Electron shaved a bit
more off, so the popup got progressively smaller.

`_repositionToPrimaryDisplay` before the fix (~[index.js:1608](../desktop/src/main/index.js#L1608)):
```js
win.setPosition(x, y, false);   // never re-asserts width/height → drift accumulates
```

## Fix

### A. Pin suppresses blur-to-hide
The blur handler now returns early when the window is pinned. A pinned window stays visible while
the user works in other apps; it is still dismissable via the tray-icon click toggle
([index.js:1374](../desktop/src/main/index.js#L1374)) and the in-window close button
(`hide-window` IPC, [index.js:1844](../desktop/src/main/index.js#L1844)). Unpinning restores the
normal click-away-to-hide behavior.
```js
popupWindow.on('blur', () => {
  if (blurTimeout) { clearTimeout(blurTimeout); blurTimeout = null; }
  if (isAlwaysOnTop) return;      // PIN FIX: never auto-hide while pinned
  if (Date.now() - _lastTrayClickAt < 300) return;
  blurTimeout = setTimeout(() => { ... }, 150);
});
```

### B. Re-assert full bounds on every show
`_repositionToPrimaryDisplay` now sets the **full bounds** (position + intended size) instead of
position only. Because it always passes the constant `320 x 400`, the size resets to the intended
value on every show and can no longer drift smaller — independent of the exact DPI rounding.
```js
win.setBounds({ x, y, width: windowWidth, height: windowHeight }, false);
```
This path runs on every re-show of an existing popup (tray click, `second-instance` from a taskbar
relaunch), so the size is corrected on each interaction.

## Cross-platform check (desktop must work on Windows + macOS + Linux)

- **Pin/blur fix:** platform-agnostic — keys only off `isAlwaysOnTop`. macOS uses the `'floating'`
  level keepalive (unchanged); Linux keeps its debounced blur for spurious DE blur events when not
  pinned.
- **setBounds fix:** safe on all platforms — re-asserting the same constant size is a no-op where
  there is no DPI drift (macOS, Linux, 100%-scale Windows) and corrective where there is.

## Verification

- Build a desktop dev release and confirm on a Windows machine at 150% scaling:
  - Pin on → click into another app → popup stays visible. Pin off → click away → popup hides.
  - Repeated taskbar/tray clicks keep the popup at a constant 320×400 (no shrink).
- macOS/Linux: pin keeps the window on top and visible; tray click still toggles; no size change.

## Files touched
- [desktop/src/main/index.js](../desktop/src/main/index.js) — `blur` handler + `_repositionToPrimaryDisplay`
