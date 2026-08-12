/**
 * Upload cadence: tracking is local and continuous, uploading is a periodic batch.
 *
 * Owner decision (2026-08-03): the agent must NOT push to the server on every user
 * action. It tracks locally and uploads on a fixed 10-minute interval. The only
 * out-of-band flushes left are the ones that protect data rather than freshen a
 * dashboard — launch (previous run's backlog), sign-out, quit, pre-update — because
 * after those the process may not be alive for the next tick.
 *
 * AMENDED 2026-08-10, on the owner's instruction after watching the dashboard read
 * 41:21 against the desktop's 20:09: the four instants at which a session BOUNDARY
 * moves — start, stop, idle resolution, project switch — are announced immediately.
 * Everything else is unchanged. Bulk data (screenshots, heartbeats, the routine
 * re-push of the live session) still rides the 10-minute batch; a boundary push is a
 * handful of bytes for one row, and it is the only way the server can stop attributing
 * work to a session the user already ended. The rule this file guards is therefore no
 * longer "nothing but data-protection flushes" but "boundaries and data protection,
 * and nothing else" — a periodic heartbeat of pushes for freshness is still banned.
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

    test("only data-protection flushes and session boundaries trigger an upload", () => {
        const reasons = [...SRC.matchAll(/syncNow\(\s*"([a-z-]+)"/g)].map(
            (m) => m[1],
        );
        const boundaries = [
            ...SRC.matchAll(/pushSessionBoundary\(\s*"([a-z-]+)"/g),
        ].map((m) => m[1]);

        // Sorted for a stable failure message.
        expect(reasons.sort()).toEqual(
            ["logout", "pre-update", "quit", "startup"].sort(),
        );
        expect(boundaries.sort()).toEqual(
            [
                "idle-resolved",
                "project-switch",
                "timer-start",
                "timer-stop",
            ].sort(),
        );
    });

    test.each(["midnight-split", "wake", "online", "tick", "reconnect"])(
        "the %s trigger stays gone",
        (reason) => {
            // These are not boundaries the USER can see moving; they were freshness
            // pushes, and re-adding one would walk back toward a push per event.
            expect(SRC).not.toContain(`syncNow("${reason}"`);
            expect(SRC).not.toContain(`pushSessionBoundary("${reason}")`);
        },
    );

    test("a boundary push never blocks the local write, and ignores backoff", () => {
        const helper = SRC.slice(
            SRC.indexOf("function pushSessionBoundary("),
            SRC.indexOf("function resumeTimerAfterIdle("),
        );
        // Tracked time is durable in SQLite before this runs; the push is announcement
        // only, so it must not be awaited on any timer path.
        expect(helper).toMatch(/ignoreBackoff: true/);
        expect(SRC).not.toMatch(/await pushSessionBoundary\(/);
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
