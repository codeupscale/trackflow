/**
 * The corpse guard: a live session whose machine has been dead must be CLOSED at the
 * last real input, never split across the midnights it slept through.
 *
 * Regression for the "63 hours" report. A session started Friday 15:31 was never
 * stopped; by Monday the midnight split had turned it into 3.47h + 24h + 24h +
 * 11.71h = 63.18 hours of "tracked work", and today's slice alone (11.71h) is what
 * the tray showed after a stop/start. The split was doing exactly what it is
 * designed to do — to a session that should have been closed on Friday.
 *
 * See bugs/desktop-force-quit-and-dead-machine-leave-time-open.md.
 */

const {
    staleLiveSessionDecision,
} = require("../src/main/session-rules");

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const THRESHOLD_SEC = 10 * 60; // the org idle threshold governs "away" and "asleep"

describe("staleLiveSessionDecision", () => {
    const now = Date.parse("2026-08-03T06:42:00Z");

    test("a session active seconds ago is alive — never touched", () => {
        const d = staleLiveSessionDecision({
            lastActiveAtMs: now - 5 * 1000,
            nowMs: now,
            thresholdSec: THRESHOLD_SEC,
        });
        expect(d.stale).toBe(false);
        expect(d.closeAtMs).toBeNull();
    });

    test("idle but inside the threshold is still alive", () => {
        const d = staleLiveSessionDecision({
            lastActiveAtMs: now - 9 * MIN,
            nowMs: now,
            thresholdSec: THRESHOLD_SEC,
        });
        expect(d.stale).toBe(false);
    });

    test("exactly at the threshold is not yet dead (idle detection owns that window)", () => {
        const d = staleLiveSessionDecision({
            lastActiveAtMs: now - 10 * MIN,
            nowMs: now,
            thresholdSec: THRESHOLD_SEC,
        });
        expect(d.stale).toBe(false);
    });

    test("the weekend case: dead 2.6 days, closed at Friday's last input", () => {
        const fridayLastInput = Date.parse("2026-07-31T15:35:00Z");
        const d = staleLiveSessionDecision({
            lastActiveAtMs: fridayLastInput,
            nowMs: now,
            thresholdSec: THRESHOLD_SEC,
            sessionStartedAtMs: Date.parse("2026-07-31T15:31:36Z"),
        });
        expect(d.stale).toBe(true);
        expect(d.closeAtMs).toBe(fridayLastInput);
        // ~63 hours of dead time, none of which may be billed.
        expect(d.deadSec).toBeGreaterThan(60 * HOUR / 1000);
    });

    test("never closes a session BEFORE it started", () => {
        const started = Date.parse("2026-08-03T06:00:00Z");
        const d = staleLiveSessionDecision({
            lastActiveAtMs: Date.parse("2026-08-02T20:00:00Z"), // older than the session
            nowMs: now,
            thresholdSec: THRESHOLD_SEC,
            sessionStartedAtMs: started,
        });
        expect(d.stale).toBe(true);
        // A zero-length row is recoverable; a negative-length one is corruption.
        expect(d.closeAtMs).toBe(started);
    });

    test("no last-active stamp at all = never stale (fail OPEN, never stop a live timer)", () => {
        expect(
            staleLiveSessionDecision({
                lastActiveAtMs: NaN,
                nowMs: now,
                thresholdSec: THRESHOLD_SEC,
            }).stale,
        ).toBe(false);
        expect(
            staleLiveSessionDecision({
                lastActiveAtMs: null,
                nowMs: now,
                thresholdSec: THRESHOLD_SEC,
            }).stale,
        ).toBe(false);
    });

    test("a missing or nonsense threshold never stops a timer", () => {
        for (const thresholdSec of [0, -1, NaN, undefined]) {
            expect(
                staleLiveSessionDecision({
                    lastActiveAtMs: now - 10 * HOUR,
                    nowMs: now,
                    thresholdSec,
                }).stale,
            ).toBe(false);
        }
    });
});

describe("the guard is actually wired into the midnight split", () => {
    const fs = require("fs");
    const path = require("path");
    const SRC = fs.readFileSync(
        path.join(__dirname, "..", "src", "main", "index.js"),
        "utf8",
    );
    const split = SRC.slice(
        SRC.indexOf("function maybeSplitAtMidnight()"),
        SRC.indexOf("function startTrayTimer()"),
    );

    test("staleness is checked BEFORE splitAtMidnightIfNeeded()", () => {
        const guardIdx = split.indexOf("staleLiveSessionDecision(");
        const splitIdx = split.indexOf("splitAtMidnightIfNeeded()");
        expect(guardIdx).toBeGreaterThan(-1);
        expect(splitIdx).toBeGreaterThan(guardIdx);
    });

    test("a dead session is stopped and the split is skipped entirely", () => {
        expect(split).toMatch(/autoStopTimerForPowerEvent\(\s*"stale-session"/);
        // `return` before the split call — not a fallthrough.
        const guarded = split.slice(
            split.indexOf("if (stale.stale"),
            split.indexOf("splitAtMidnightIfNeeded()"),
        );
        expect(guarded).toMatch(/return;/);
    });

    test("the last-active stamp comes from the OS idle counter, not a server ack", () => {
        expect(SRC).toMatch(/function _stampLastActiveFromOsIdle\(\)/);
        expect(SRC).toMatch(/powerMonitor\.getSystemIdleTime\(\)/);
        // Called from the 1s tray tick, so it keeps advancing with no network at all.
        const tick = SRC.slice(
            SRC.indexOf("function startTrayTimer()"),
            SRC.indexOf("function startTrayTimer()") + 3000,
        );
        expect(tick).toMatch(/_stampLastActiveFromOsIdle\(\);/);
    });
});

describe("every catchable termination closes the session", () => {
    const fs = require("fs");
    const path = require("path");
    const SRC = fs.readFileSync(
        path.join(__dirname, "..", "src", "main", "index.js"),
        "utf8",
    );

    test.each(["SIGTERM", "SIGINT", "SIGHUP"])(
        "%s is routed into the graceful quit path",
        (signal) => {
            expect(SRC).toContain(signal);
        },
    );

    test("the handler goes through app.quit() so before-quit's flush runs", () => {
        const block = SRC.slice(
            SRC.indexOf('for (const signal of ["SIGTERM"'),
            SRC.indexOf('app.on("before-quit"'),
        );
        expect(block).toMatch(/process\.on\(signal/);
        expect(block).toMatch(/app\.quit\(\)/);
    });
});
