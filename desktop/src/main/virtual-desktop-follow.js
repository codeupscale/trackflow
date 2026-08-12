/**
 * Windows virtual-desktop follow — PURE decision logic (no Electron import, so
 * it is unit-testable under Jest like window-geometry.js).
 *
 * WHY THIS EXISTS
 * ---------------
 * Pinning the window ("Always on Top") keeps it above other apps on macOS and
 * Linux AND makes it visible on every Space / workspace, because Electron's
 * `setVisibleOnAllWorkspaces()` is implemented there. On Windows that method is
 * a documented NO-OP, and Windows exposes no supported API to place a window on
 * every virtual desktop — the shell's own "Show this window on all desktops"
 * lives behind an undocumented COM interface (IVirtualDesktopManagerInternal /
 * IVirtualDesktopPinnedApps) whose IIDs change with every Windows build, so
 * calling it would break on the next Patch Tuesday.
 *
 * What IS reliable on Windows: a window is (re)assigned to the ACTIVE virtual
 * desktop when it is shown. So instead of being on all desktops at once, the
 * pinned window FOLLOWS the user — the moment it is no longer on the desktop the
 * user is looking at, it is re-shown, which teleports it to the current one.
 *
 * Detecting "the user walked away to another virtual desktop" needs no native
 * code: Chromium marks a window that sits on another virtual desktop as
 * occluded, which stops its animation frames and flips `document.visibilityState`
 * to `hidden`. The renderer reports that as `composited: false`; this module
 * decides what the main process should do about it.
 */

// How long the window must look non-composited before we act. Guards against a
// transient frame stall (a window drag, a GPU hiccup) yanking the window around.
const OFF_DESKTOP_CONFIRM_MS = 400;

// Never re-show more often than this — a move must not turn into a flicker loop.
const MIN_MOVE_INTERVAL_MS = 1500;

// If this many consecutive moves fail to bring the window back into view, stop
// trying until something changes (it became visible again, or the pin was
// re-toggled). Better a pin that under-delivers on an exotic WM than a window
// that hides and re-shows itself forever.
const MAX_FOLLOW_ATTEMPTS = 3;

/**
 * @param {object} state
 * @param {string}  state.platform        process.platform
 * @param {boolean} state.pinned          "Always on Top" is on
 * @param {boolean} state.windowVisible   BrowserWindow.isVisible()
 * @param {boolean} state.minimized       BrowserWindow.isMinimized()
 * @param {?number} state.offDesktopSince epoch ms the window stopped being
 *                                        composited, or null if it is on screen
 * @param {number}  state.lastMoveAt      epoch ms of the last follow move (0 = never)
 * @param {number}  state.attempts        consecutive follow moves that did not stick
 * @param {number}  state.now             epoch ms
 * @returns {{action: 'move'|'wait'|'none', reason: string, retryInMs?: number}}
 */
function decideFollowAction(state) {
    const {
        platform,
        pinned,
        windowVisible,
        minimized,
        offDesktopSince,
        lastMoveAt = 0,
        attempts = 0,
        now,
        confirmMs = OFF_DESKTOP_CONFIRM_MS,
        minMoveIntervalMs = MIN_MOVE_INTERVAL_MS,
        maxAttempts = MAX_FOLLOW_ATTEMPTS,
    } = state || {};

    // macOS/Linux already do this natively via setVisibleOnAllWorkspaces().
    if (platform !== "win32") return { action: "none", reason: "not-windows" };

    // Unpinned means "behave like an ordinary window": stay on the desktop the
    // user left it on. Following is exactly what the pin is asking for.
    if (!pinned) return { action: "none", reason: "not-pinned" };

    // Hidden to tray (close button / Escape) or minimised: the user deliberately
    // put it away. Re-showing it here would resurrect a window they dismissed —
    // the single worst failure mode this feature could have.
    if (!windowVisible) return { action: "none", reason: "window-hidden" };
    if (minimized) return { action: "none", reason: "minimized" };

    if (!offDesktopSince)
        return { action: "none", reason: "on-current-desktop" };

    const offFor = now - offDesktopSince;
    if (offFor < confirmMs) {
        return {
            action: "wait",
            reason: "confirming",
            retryInMs: confirmMs - offFor,
        };
    }

    if (attempts >= maxAttempts) return { action: "none", reason: "gave-up" };

    const sinceMove = lastMoveAt ? now - lastMoveAt : Infinity;
    if (sinceMove < minMoveIntervalMs) {
        return {
            action: "wait",
            reason: "cooldown",
            retryInMs: minMoveIntervalMs - sinceMove,
        };
    }

    return { action: "move", reason: "off-desktop" };
}

module.exports = {
    decideFollowAction,
    OFF_DESKTOP_CONFIRM_MS,
    MIN_MOVE_INTERVAL_MS,
    MAX_FOLLOW_ATTEMPTS,
};
