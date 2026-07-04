// Popup window sizing — single source of truth for the tray popup's dimensions
// and the clamp/resolve rules used by the Windows resize feature (QA #10).
//
// The popup is a fixed 320x400 utility window on macOS/Linux. On Windows it is
// user-resizable (drag edges/corners), so its size is persisted and restored,
// always clamped between the designed minimum and a compact maximum. Keeping the
// numbers and the pure resolve/clamp logic here makes them unit-testable without
// pulling in Electron (index.js requires this module and delegates to it).

const POPUP_WIDTH = 320;
const POPUP_HEIGHT = 400;

// Never collapse below the designed size — the flex layout in index.html (issue
// #7 hardening) is authored against this floor, so a smaller window clips the
// footer / activity section.
const POPUP_MIN_WIDTH = POPUP_WIDTH; // 320
const POPUP_MIN_HEIGHT = POPUP_HEIGHT; // 400

// A sensible ceiling so the tray popup stays a compact utility window and can't
// be blown up to fill the screen. 1.5x the design size in each axis.
const POPUP_MAX_WIDTH = 480;
const POPUP_MAX_HEIGHT = 640;

/**
 * Clamp an arbitrary (possibly fractional / NaN / out-of-range) width+height to
 * the popup's [min, max] envelope, rounding to whole pixels. Invalid input
 * falls back to the minimum so callers can never end up below the design floor.
 */
function clampPopupSize(w, h) {
    const width = Math.round(Number(w));
    const height = Math.round(Number(h));
    return {
        width: Math.min(
            POPUP_MAX_WIDTH,
            Math.max(
                POPUP_MIN_WIDTH,
                Number.isFinite(width) ? width : POPUP_MIN_WIDTH,
            ),
        ),
        height: Math.min(
            POPUP_MAX_HEIGHT,
            Math.max(
                POPUP_MIN_HEIGHT,
                Number.isFinite(height) ? height : POPUP_MIN_HEIGHT,
            ),
        ),
    };
}

/**
 * Resolve the size the popup should open/restore at.
 * - Non-resizable platforms (macOS/Linux) always get the fixed design size,
 *   regardless of any persisted value — so their behaviour never changes.
 * - Resizable platforms (Windows) restore a persisted { width, height } clamped
 *   to the envelope, or fall back to the design size when nothing valid is saved.
 */
function resolvePopupSize(persisted, isResizable) {
    if (!isResizable) {
        return { width: POPUP_WIDTH, height: POPUP_HEIGHT };
    }
    if (
        persisted &&
        typeof persisted.width === "number" &&
        typeof persisted.height === "number"
    ) {
        return clampPopupSize(persisted.width, persisted.height);
    }
    return { width: POPUP_WIDTH, height: POPUP_HEIGHT };
}

module.exports = {
    POPUP_WIDTH,
    POPUP_HEIGHT,
    POPUP_MIN_WIDTH,
    POPUP_MIN_HEIGHT,
    POPUP_MAX_WIDTH,
    POPUP_MAX_HEIGHT,
    clampPopupSize,
    resolvePopupSize,
};
