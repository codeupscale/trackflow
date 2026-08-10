/**
 * Upload cadence: tracking is local and continuous, uploading is a periodic batch.
 *
 * Owner decision (2026-08-03): the agent must NOT push to the server on every user
 * action. It tracks locally and uploads on a fixed 10-minute interval. The only
 * out-of-band flushes left are the ones that protect data rather than freshen a
 * dashboard — launch (previous run's backlog), sign-out, quit, pre-update — because
 * after those the process may not be alive for the next tick.
 */

const fs = require("fs");
const path = require("path");

const {
    SYNC_INTERVAL_MS,
} = require("../src/main/session-sync-worker");

const SRC = fs.readFileSync(
    path.join(__dirname, "..", "src", "main", "index.js"),
    "utf8",
);

describe("session upload cadence", () => {
    test("uploads run on a 10-minute interval", () => {
        expect(SYNC_INTERVAL_MS).toBe(10 * 60 * 1000);
    });

    test("no routine action triggers an upload", () => {
        const reasons = [...SRC.matchAll(/syncNow\(\s*"([a-z-]+)"/g)].map(
            (m) => m[1],
        );
        // Sorted for a stable failure message.
        expect(reasons.sort()).toEqual(
            ["logout", "pre-update", "quit", "startup"].sort(),
        );
    });

    test.each([
        "timer-start",
        "timer-stop",
        "project-switch",
        "idle-discard",
        "idle-resolved",
        "midnight-split",
        "wake",
        "online",
    ])("the %s trigger is gone", (reason) => {
        expect(SRC).not.toContain(`syncNow("${reason}"`);
    });

    test("stopping the timer does not make the displayed total drop", () => {
        // With no push on stop, the server's today-total cannot contain the session
        // that just ended. The local unsynced-completed seconds must be added on top,
        // or the total visibly shrinks by the length of the work just finished.
        const stopBlock = SRC.slice(
            SRC.indexOf("Post-stop async work"),
            SRC.indexOf("Post-stop async work") + 2500,
        );
        expect(stopBlock).toMatch(/getUnsyncedCompletedSecondsForToday\(\)/);
    });

    test("stopping the timer does not double-count the session it just closed", () => {
        // The mirror of the test above. The stop is not pushed, so the server still
        // holds the entry OPEN and folds its elapsed-to-now into every today figure —
        // while the row is ALSO counted locally. The refresh must therefore read the
        // status payload (which reports that elapsed) and subtract it; reading the bare
        // `/timer/today-total` number cannot express the overlap, and left the total
        // counting the finished session twice and climbing after Stop.
        const stopBlock = SRC.slice(
            SRC.indexOf("Post-stop async work"),
            SRC.indexOf("Post-stop async work") + 2500,
        );
        expect(stopBlock).toMatch(/getTimerStatus\(null\)/);
        expect(stopBlock).toMatch(/serverGlobal - \(status\.elapsed_seconds/);
        expect(stopBlock).not.toMatch(/getTodayTotal\(null\)/);
    });
});
