/**
 * Windows virtual-desktop follow — decision logic.
 *
 * Covers the bug: a PINNED window stayed on the virtual desktop it was opened on
 * and never appeared on the user's other Windows desktops, because Electron's
 * setVisibleOnAllWorkspaces() is a no-op on Windows.
 */

const {
    decideFollowAction,
    OFF_DESKTOP_CONFIRM_MS,
    MIN_MOVE_INTERVAL_MS,
    MAX_FOLLOW_ATTEMPTS,
} = require("../src/main/virtual-desktop-follow");

const NOW = 1_700_000_000_000;

function state(overrides = {}) {
    return {
        platform: "win32",
        pinned: true,
        windowVisible: true,
        minimized: false,
        offDesktopSince: NOW - 5000,
        lastMoveAt: 0,
        attempts: 0,
        now: NOW,
        ...overrides,
    };
}

describe("decideFollowAction", () => {
    it("moves a pinned window that has been off the active desktop long enough", () => {
        expect(decideFollowAction(state()).action).toBe("move");
    });

    it("never runs on macOS or Linux — they pin across workspaces natively", () => {
        expect(decideFollowAction(state({ platform: "darwin" })).action).toBe(
            "none",
        );
        expect(decideFollowAction(state({ platform: "linux" })).action).toBe(
            "none",
        );
    });

    it("does nothing when the window is not pinned", () => {
        const d = decideFollowAction(state({ pinned: false }));
        expect(d.action).toBe("none");
        expect(d.reason).toBe("not-pinned");
    });

    it("never resurrects a window the user hid to the tray", () => {
        const d = decideFollowAction(state({ windowVisible: false }));
        expect(d.action).toBe("none");
        expect(d.reason).toBe("window-hidden");
    });

    it("never un-minimises a minimised window", () => {
        const d = decideFollowAction(state({ minimized: true }));
        expect(d.action).toBe("none");
        expect(d.reason).toBe("minimized");
    });

    it("does nothing while the window is on the current desktop", () => {
        const d = decideFollowAction(state({ offDesktopSince: null }));
        expect(d.action).toBe("none");
        expect(d.reason).toBe("on-current-desktop");
    });

    it("waits out a transient frame stall instead of yanking the window", () => {
        const d = decideFollowAction(
            state({ offDesktopSince: NOW - (OFF_DESKTOP_CONFIRM_MS - 100) }),
        );
        expect(d.action).toBe("wait");
        expect(d.reason).toBe("confirming");
        expect(d.retryInMs).toBe(100);
    });

    it("moves once the confirm window has elapsed", () => {
        expect(
            decideFollowAction(
                state({ offDesktopSince: NOW - OFF_DESKTOP_CONFIRM_MS }),
            ).action,
        ).toBe("move");
    });

    it("rate-limits moves so a follow can never become a flicker loop", () => {
        const d = decideFollowAction(
            state({ lastMoveAt: NOW - (MIN_MOVE_INTERVAL_MS - 500) }),
        );
        expect(d.action).toBe("wait");
        expect(d.reason).toBe("cooldown");
        expect(d.retryInMs).toBe(500);
    });

    it("moves again after the cooldown expires", () => {
        expect(
            decideFollowAction(
                state({ lastMoveAt: NOW - MIN_MOVE_INTERVAL_MS, attempts: 1 }),
            ).action,
        ).toBe("move");
    });

    it("gives up after repeated moves fail rather than hiding/showing forever", () => {
        const d = decideFollowAction(
            state({ attempts: MAX_FOLLOW_ATTEMPTS, lastMoveAt: NOW - 60_000 }),
        );
        expect(d.action).toBe("none");
        expect(d.reason).toBe("gave-up");
    });

    it("survives a missing state object", () => {
        expect(decideFollowAction().action).toBe("none");
        expect(decideFollowAction(null).action).toBe("none");
    });
});
