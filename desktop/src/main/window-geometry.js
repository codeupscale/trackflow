// Main-window geometry — single source of truth for the app window's default
// size, its minimum size, and the persist/restore rules.
//
// This replaces the old `popup-size` module. The window used to be a fixed
// 320x480 frameless tray popup that was re-anchored to the tray icon on every
// show; it is now an ordinary resizable desktop window with native minimise /
// maximise / close, so what has to survive a restart is the full RECT
// (position + size), not just a width/height.
//
// The rules live here, free of any Electron import, so they can be unit-tested
// directly (index.js requires this module and delegates to it).

// Default size for a first run. Wider and taller than the old 320x480 popup:
// the real-world stack (connection + shift line, timer, project select,
// activity bar, actions, footer) had no breathing room at the popup size and
// every block collapsed onto its neighbour.
const WINDOW_WIDTH = 440;
// 560, not 600: the natural content height is ~450px, so 600 left the timer hero
// floating in ~150px of dead space. 560 keeps real breathing room — the whole
// point of leaving the 320x480 popup behind — without the layout looking sparse.
const WINDOW_HEIGHT = 560;

// Never let the window collapse below the layout's design floor. The flex
// layout in index.html is authored against this; smaller than this and the
// footer starts to clip.
const WINDOW_MIN_WIDTH = 380;
const WINDOW_MIN_HEIGHT = 480;

// How much of the window must remain on a display for a restored position to
// count as "visible". Enough that the title bar is always grabbable — a window
// restored from a monitor that has since been unplugged must never come back
// off-screen where it cannot be dragged into view.
const MIN_VISIBLE_WIDTH = 120;
const MIN_VISIBLE_HEIGHT = 40;

/**
 * Clamp an arbitrary (possibly fractional / NaN / undersized) width+height to
 * the window's minimum envelope, rounding to whole pixels. Invalid input falls
 * back to the default size so callers can never end up below the design floor.
 *
 * Unlike the old popup there is deliberately NO maximum: this is a normal
 * window and the user is allowed to make it as large as their screen.
 */
function clampWindowSize(w, h) {
    const width = Math.round(Number(w));
    const height = Math.round(Number(h));
    return {
        width: Math.max(
            WINDOW_MIN_WIDTH,
            Number.isFinite(width) ? width : WINDOW_WIDTH,
        ),
        height: Math.max(
            WINDOW_MIN_HEIGHT,
            Number.isFinite(height) ? height : WINDOW_HEIGHT,
        ),
    };
}

/** Area of the overlap between two rects (0 when they do not intersect). */
function _overlap(a, b) {
    const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    return { x, y };
}

/**
 * True when `bounds` overlaps at least one display's work area by enough for
 * the user to see and grab the window.
 */
function isVisibleOnAnyDisplay(bounds, displays) {
    if (!bounds || !Array.isArray(displays) || displays.length === 0) {
        return false;
    }
    return displays.some((d) => {
        const area = d && (d.workArea || d.bounds);
        if (!area) return false;
        const o = _overlap(bounds, area);
        return o.x >= MIN_VISIBLE_WIDTH && o.y >= MIN_VISIBLE_HEIGHT;
    });
}

/** Centre a width x height rect inside a display's work area. */
function centerOnDisplay(display, width, height) {
    const area = (display && (display.workArea || display.bounds)) || {
        x: 0,
        y: 0,
        width,
        height,
    };
    return {
        x: Math.round(area.x + (area.width - width) / 2),
        y: Math.round(area.y + (area.height - height) / 2),
        width,
        height,
    };
}

/**
 * Resolve the bounds the window should open at.
 *
 * - No persisted rect (first run, or a corrupted prefs file) → the default size
 *   centred on the primary display.
 * - A persisted rect that still lands on a connected display → restored as-is,
 *   with its size clamped up to the minimum.
 * - A persisted rect stranded off-screen (monitor unplugged, resolution change)
 *   → the persisted SIZE is kept but re-centred on the primary display, so the
 *   user gets their window back rather than an invisible one.
 */
function resolveWindowBounds(persisted, displays, primaryDisplay) {
    const primary =
        primaryDisplay || (Array.isArray(displays) ? displays[0] : null);

    const hasSize =
        persisted &&
        Number.isFinite(Number(persisted.width)) &&
        Number.isFinite(Number(persisted.height));

    const size = hasSize
        ? clampWindowSize(persisted.width, persisted.height)
        : { width: WINDOW_WIDTH, height: WINDOW_HEIGHT };

    const hasPosition =
        persisted &&
        Number.isFinite(Number(persisted.x)) &&
        Number.isFinite(Number(persisted.y));

    if (hasPosition) {
        const candidate = {
            x: Math.round(Number(persisted.x)),
            y: Math.round(Number(persisted.y)),
            width: size.width,
            height: size.height,
        };
        if (isVisibleOnAnyDisplay(candidate, displays)) {
            return candidate;
        }
    }

    return centerOnDisplay(primary, size.width, size.height);
}

// Height of the branded header row, kept in sync with `.titlebar` in
// shared.css so the Windows overlay buttons line up with it.
const TITLEBAR_HEIGHT = 40;

/**
 * The BrowserWindow chrome options that give the window real, native
 * minimise/maximise/close on a given platform.
 *
 *   - darwin : 'hiddenInset' floats the traffic lights over the LEFT of our own
 *              header row — the standard modern macOS look, branding intact.
 *   - win32  : 'hidden' + titleBarOverlay has the OS paint the caption buttons
 *              into the RIGHT of that same row.
 *   - linux  : a plain native frame. titleBarOverlay support varies by
 *              compositor and WM (GNOME vs KDE, X11 vs Wayland) and a frameless
 *              window that the WM refuses to decorate is an undraggable,
 *              unclosable window — so the WM's own decorations are the only
 *              safe choice. Our header row simply sits below them.
 *
 * Returned as a plain object so index.js can spread it into the window options
 * and so the per-platform contract is unit-testable without Electron.
 */
function resolveWindowChrome(platform, colors) {
    const c = colors || {};
    if (platform === "darwin") {
        return {
            titleBarStyle: "hiddenInset",
            trafficLightPosition: { x: 14, y: 13 },
        };
    }
    if (platform === "win32") {
        return {
            titleBarStyle: "hidden",
            titleBarOverlay: {
                color: c.background || "#121110",
                symbolColor: c.symbol || "#a8a29e",
                height: TITLEBAR_HEIGHT,
            },
        };
    }
    return { frame: true };
}

module.exports = {
    WINDOW_WIDTH,
    WINDOW_HEIGHT,
    WINDOW_MIN_WIDTH,
    WINDOW_MIN_HEIGHT,
    MIN_VISIBLE_WIDTH,
    MIN_VISIBLE_HEIGHT,
    TITLEBAR_HEIGHT,
    clampWindowSize,
    isVisibleOnAnyDisplay,
    centerOnDisplay,
    resolveWindowBounds,
    resolveWindowChrome,
};
