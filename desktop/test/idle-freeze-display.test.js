// Regression tests for: the idle prompt's own on-screen duration was being added
// to the tracked time (bugs/desktop-idle-window-time-counted-while-paused.md).
//
// Repro: track 4 min → go idle → idle window appears → the timer showed "Tracking"
// and kept climbing (4:00 → 6:30) while the entry was in fact paused. Turning the
// network off at the moment of the prompt made it reproduce every time, because the
// offline paths (wake/reconnect/phantom-stop recovery) re-arm the tray tick.
//
// The mutation logic lives in src/main/index.js, which cannot be imported without
// booting Electron, so — per the convention in timer-sync-invariants.test.js — the
// pure rules are mirrored here exactly as coded and asserted. Each block cites the
// function it mirrors.

describe("idle freeze — displayed time excludes the idle window", () => {
    const START = new Date("2026-07-28T09:00:00.000Z").getTime();
    const IDLE_START = START + 4 * 60 * 1000; // last real activity: 4 min in
    const NOW = IDLE_START + 2 * 60 * 1000 + 30 * 1000; // prompt has sat 2m30s

    // Mirrors displayAnchorMs() in src/main/index.js.
    function displayAnchorMs({
        isTimerPaused,
        idleStartedAt,
        idleFreezeAnchorMs,
        nowMs,
    }) {
        if (!isTimerPaused) return nowMs;
        if (idleStartedAt != null) {
            const ms = new Date(idleStartedAt).getTime();
            if (Number.isFinite(ms) && ms > 0) return ms;
        }
        if (Number.isFinite(idleFreezeAnchorMs)) return idleFreezeAnchorMs;
        return nowMs;
    }

    // Mirrors computeDisplaySeconds() in src/main/index.js.
    function computeDisplaySeconds(state) {
        const {
            cachedStartedAtMs,
            todayTotalCurrentProject,
            pendingOfflineReassignIdleSec = 0,
        } = state;
        if (!cachedStartedAtMs) return todayTotalCurrentProject;
        const elapsed = Math.floor(
            (displayAnchorMs(state) - cachedStartedAtMs) / 1000,
        );
        return (
            todayTotalCurrentProject +
            Math.max(0, elapsed - pendingOfflineReassignIdleSec)
        );
    }

    const paused = {
        isTimerPaused: true,
        idleStartedAt: IDLE_START,
        idleFreezeAnchorMs: IDLE_START,
        cachedStartedAtMs: START,
        todayTotalCurrentProject: 0,
        nowMs: NOW,
    };

    test("while idle-paused the display is the TRACKED time, not wall-clock", () => {
        // 4 minutes of real work — NOT 6:30.
        expect(computeDisplaySeconds(paused)).toBe(240);
    });

    test("the value does not grow as the prompt stays on screen", () => {
        const after10Min = { ...paused, nowMs: NOW + 10 * 60 * 1000 };
        expect(computeDisplaySeconds(after10Min)).toBe(
            computeDisplaySeconds(paused),
        );
    });

    test("today's completed total is still added to the frozen session", () => {
        expect(
            computeDisplaySeconds({ ...paused, todayTotalCurrentProject: 3600 }),
        ).toBe(3600 + 240);
    });

    test("falls back to the captured freeze anchor when the detector re-armed", () => {
        // idleDetector.idleStartedAt is nulled by resolveIdle()/start(); without the
        // _idleFreezeAnchorMs backstop the anchor would silently become `now` and the
        // whole idle window would be absorbed into the total.
        const detectorLost = { ...paused, idleStartedAt: null };
        expect(computeDisplaySeconds(detectorLost)).toBe(240);
    });

    test("ignores a garbage detector anchor rather than trusting it", () => {
        const bad = { ...paused, idleStartedAt: "not-a-date" };
        expect(computeDisplaySeconds(bad)).toBe(240);
    });

    test("once resumed the display follows the clock again (idle kept)", () => {
        const resumed = {
            ...paused,
            isTimerPaused: false,
            idleFreezeAnchorMs: null,
        };
        expect(computeDisplaySeconds(resumed)).toBe(390); // 6:30
    });

    test("an offline reassign's idle seconds are still deducted", () => {
        expect(
            computeDisplaySeconds({
                ...paused,
                pendingOfflineReassignIdleSec: 60,
            }),
        ).toBe(180);
    });
});

describe("startTrayTimer gate — no path may resume counting mid-idle", () => {
    // Mirrors the two guards added to startTrayTimer() in src/main/index.js: the
    // entry gate and the in-interval gate. Callers that used to restart the count
    // while an idle decision was open: onResumeAfterSleep (wake/unlock), the idle
    // alert window's `closed` handler, and phantom-stop recovery in the sync tick.
    function shouldTick({ isTimerRunning, isTimerPaused }) {
        if (!isTimerRunning) return false;
        if (isTimerPaused) return false;
        return true;
    }

    test("does not tick while an idle decision is pending", () => {
        expect(
            shouldTick({ isTimerRunning: true, isTimerPaused: true }),
        ).toBe(false);
    });

    test("ticks normally when running and not paused", () => {
        expect(shouldTick({ isTimerRunning: true, isTimerPaused: false })).toBe(
            true,
        );
    });

    test("does not tick when the timer is stopped", () => {
        expect(
            shouldTick({ isTimerRunning: false, isTimerPaused: false }),
        ).toBe(false);
    });
});

describe("renderer state precedence — paused outranks running", () => {
    // Mirrors syncTimerState() in src/renderer/index-renderer.js. Main keeps
    // isRunning TRUE through an idle pause (the entry is still open, just frozen),
    // so testing isRunning first painted "Tracking" and re-armed ticking mid-idle.
    function resolveView(state) {
        if (state.isPaused) return "paused";
        if (state.isRunning) return "running";
        return "stopped";
    }

    test("idle pause renders Paused (idle), not Tracking", () => {
        expect(resolveView({ isRunning: true, isPaused: true })).toBe("paused");
    });

    test("a plain running timer still renders Tracking", () => {
        expect(resolveView({ isRunning: true, isPaused: false })).toBe(
            "running",
        );
    });

    test("stopped renders stopped", () => {
        expect(resolveView({ isRunning: false, isPaused: false })).toBe(
            "stopped",
        );
    });
});

describe("renderer tick filter — stale live ticks dropped while paused", () => {
    // Mirrors the onTimerTick handler in src/renderer/index-renderer.js.
    // A tick flagged isPaused is the authoritative frozen value from
    // renderIdleFreeze(); an UNflagged tick arriving while paused is a stale live
    // tick whose elapsed is measured to `now` — applying it re-introduces the bug.
    function shouldApplyTick(data, { isRunning, isPaused }) {
        const pausedTick = data?.isPaused === true;
        if (!pausedTick && (!isRunning || isPaused)) return false;
        return true;
    }

    test("drops a live tick that arrives while paused", () => {
        expect(
            shouldApplyTick(
                { totalSeconds: 390 },
                { isRunning: true, isPaused: true },
            ),
        ).toBe(false);
    });

    test("applies the flagged frozen tick even when already paused", () => {
        expect(
            shouldApplyTick(
                { totalSeconds: 240, isPaused: true },
                { isRunning: true, isPaused: true },
            ),
        ).toBe(true);
    });

    test("applies the flagged frozen tick when the popup still thinks it is running", () => {
        // This is the transition tick: it is what flips the popup to Paused (idle).
        expect(
            shouldApplyTick(
                { totalSeconds: 240, isPaused: true },
                { isRunning: true, isPaused: false },
            ),
        ).toBe(true);
    });

    test("applies a normal live tick while running", () => {
        expect(
            shouldApplyTick(
                { totalSeconds: 100 },
                { isRunning: true, isPaused: false },
            ),
        ).toBe(true);
    });

    test("drops live ticks once stopped", () => {
        expect(
            shouldApplyTick(
                { totalSeconds: 100 },
                { isRunning: false, isPaused: false },
            ),
        ).toBe(false);
    });
});
