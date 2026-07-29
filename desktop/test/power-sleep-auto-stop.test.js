// Unit tests for power-manager sleep auto-stop and startup gap detection.

const { powerMonitor } = require("electron");
const PowerManager = require("../src/main/power-manager");

describe("PowerManager", () => {
    describe("evaluateStartupGap", () => {
        const now = new Date("2026-06-20T11:00:00.000Z").getTime();

        test("does not close when no open session", () => {
            const r = PowerManager.evaluateStartupGap({
                lastActiveAtMs: now - 3600_000,
                nowMs: now,
                gapThresholdSec: 180,
                hasOpenSession: false,
            });
            expect(r.shouldClose).toBe(false);
        });

        test("does not close when gap is within threshold", () => {
            const r = PowerManager.evaluateStartupGap({
                lastActiveAtMs: now - 60_000,
                nowMs: now,
                gapThresholdSec: 180,
                hasOpenSession: true,
            });
            expect(r.shouldClose).toBe(false);
            expect(r.gapSec).toBe(60);
        });

        test("closes at lastActiveAt when gap exceeds threshold", () => {
            const lastActive = now - 600_000;
            const r = PowerManager.evaluateStartupGap({
                lastActiveAtMs: lastActive,
                nowMs: now,
                gapThresholdSec: 180,
                hasOpenSession: true,
            });
            expect(r.shouldClose).toBe(true);
            expect(r.stopAtMs).toBe(lastActive);
            expect(r.gapSec).toBe(600);
        });
    });

    // Regression cover for the "20 hours tracked" report: laptop slept overnight
    // with the timer running. The idle detector cannot catch a sleep (frozen
    // interval; OS idle counter resets on wake), so the resume path is the only
    // thing standing between an overnight sleep and a 20h entry.
    describe("evaluateSleepGap", () => {
        const IDLE_THRESHOLD_SEC = 600; // 10 min, matching Settings → Idle detection
        const suspendedAt = new Date("2026-07-16T13:00:00.000Z").getTime();
        const lastActive = new Date("2026-07-16T12:58:00.000Z").getTime();

        const evaluate = (over) =>
            PowerManager.evaluateSleepGap({
                sleepSec: 60,
                gapThresholdSec: IDLE_THRESHOLD_SEC,
                lastActiveAtMs: lastActive,
                suspendedAtMs: suspendedAt,
                hasOpenSession: true,
                ...over,
            });

        test("short sleep keeps the timer running (lunch / quick lid close)", () => {
            // Product policy: sleeps within the idle window are NOT interrupted.
            const r = evaluate({ sleepSec: IDLE_THRESHOLD_SEC - 1 });
            expect(r.shouldClose).toBe(false);
            expect(r.stopAtMs).toBeNull();
        });

        test("sleep exactly at the threshold keeps running (boundary)", () => {
            const r = evaluate({ sleepSec: IDLE_THRESHOLD_SEC });
            expect(r.shouldClose).toBe(false);
        });

        test("sleep one second past the threshold closes the entry", () => {
            const r = evaluate({ sleepSec: IDLE_THRESHOLD_SEC + 1 });
            expect(r.shouldClose).toBe(true);
            expect(r.stopAtMs).toBe(lastActive);
        });

        test("overnight sleep back-dates the stop to the last activity, not to wake time", () => {
            // The actual reported bug: ~20h sleep. The stop must land at 12:58,
            // NOT at wake — back-dating is what keeps the 20h out of the entry.
            const twentyHoursSec = 20 * 60 * 60;
            const r = evaluate({ sleepSec: twentyHoursSec });
            expect(r.shouldClose).toBe(true);
            expect(r.stopAtMs).toBe(lastActive);
            expect(r.gapSec).toBe(twentyHoursSec);
        });

        test("falls back to the suspend instant when lastActiveAt is missing", () => {
            const r = evaluate({ sleepSec: 20 * 3600, lastActiveAtMs: null });
            expect(r.shouldClose).toBe(true);
            expect(r.stopAtMs).toBe(suspendedAt);
        });

        test("never closes without an open session", () => {
            const r = evaluate({ sleepSec: 20 * 3600, hasOpenSession: false });
            expect(r.shouldClose).toBe(false);
        });

        test("does not close when no anchor exists at all — never credits the gap", () => {
            // With no lastActiveAt and no suspend instant there is no honest stop
            // point. Closing at now() would credit the whole sleep — the bug.
            const r = evaluate({
                sleepSec: 20 * 3600,
                lastActiveAtMs: null,
                suspendedAtMs: null,
            });
            expect(r.shouldClose).toBe(false);
            expect(r.stopAtMs).toBeNull();
        });

        test("a zero/unknown threshold never closes", () => {
            const r = evaluate({ sleepSec: 20 * 3600, gapThresholdSec: 0 });
            expect(r.shouldClose).toBe(false);
        });
    });

    // Regression cover for the "12 hours tracked while asleep" phantom, mode 2:
    // the machine stayed AWAKE (clamshell on charger / external display, or the
    // user simply walked away) so NO suspend event fired and evaluateSleepGap
    // never ran. This is the awake-but-idle watchdog backstop.
    describe("evaluateIdleHardStop", () => {
        const now = new Date("2026-07-23T14:00:00.000Z").getTime();
        // cap = threshold(10m) + fixed grace(10m) + margin(2m) = 22m = 1320s
        const CAP_SEC = 10 * 60 + 10 * 60 + 120;

        test("does not stop while idle is under the cap", () => {
            const r = PowerManager.evaluateIdleHardStop({
                systemIdleSec: CAP_SEC - 1,
                hardStopSec: CAP_SEC,
                nowMs: now,
                lastActiveAtMs: null,
            });
            expect(r.shouldStop).toBe(false);
            expect(r.stopAtMs).toBeNull();
        });

        test("hard-stops once idle exceeds the cap, back-dated to last input", () => {
            const idleSec = 12 * 60 * 60; // 12h idle (the reported phantom)
            const r = PowerManager.evaluateIdleHardStop({
                systemIdleSec: idleSec,
                hardStopSec: CAP_SEC,
                nowMs: now,
                lastActiveAtMs: null,
            });
            expect(r.shouldStop).toBe(true);
            // Back-dated to now - idle (true last input), NOT to now.
            expect(r.stopAtMs).toBe(now - idleSec * 1000);
            expect(r.idleSec).toBe(idleSec);
        });

        test("prefers an EARLIER last-active anchor over the OS idle estimate", () => {
            const idleSec = 60 * 60; // 1h
            const lastActive = now - 90 * 60 * 1000; // 90m ago — earlier than now-idle
            const r = PowerManager.evaluateIdleHardStop({
                systemIdleSec: idleSec,
                hardStopSec: CAP_SEC,
                nowMs: now,
                lastActiveAtMs: lastActive,
            });
            expect(r.shouldStop).toBe(true);
            // Conservative: never credit more than the honest last-activity time.
            expect(r.stopAtMs).toBe(lastActive);
        });

        test("ignores a later last-active anchor (uses the OS idle estimate)", () => {
            const idleSec = 60 * 60; // 1h → now-idle is earlier than lastActive
            const lastActive = now - 10 * 60 * 1000; // 10m ago
            const r = PowerManager.evaluateIdleHardStop({
                systemIdleSec: idleSec,
                hardStopSec: CAP_SEC,
                nowMs: now,
                lastActiveAtMs: lastActive,
            });
            expect(r.stopAtMs).toBe(now - idleSec * 1000);
        });

        test("a zero/unknown cap never stops", () => {
            const r = PowerManager.evaluateIdleHardStop({
                systemIdleSec: 20 * 60 * 60,
                hardStopSec: 0,
                nowMs: now,
                lastActiveAtMs: null,
            });
            expect(r.shouldStop).toBe(false);
        });

        test("the cap is bounded — a 12h idle exceeds it regardless of config", () => {
            // Worst-case: max threshold (30m) + fixed grace + margin. Even that is
            // far below 12h, so a 12h phantom is impossible.
            const maxCap = 30 * 60 + 10 * 60 + 120;
            const r = PowerManager.evaluateIdleHardStop({
                systemIdleSec: 12 * 60 * 60,
                hardStopSec: maxCap,
                nowMs: now,
                lastActiveAtMs: null,
            });
            expect(r.shouldStop).toBe(true);
        });
    });

    describe("formatTimeShortLocal", () => {
        test("formats hours and minutes in 12-hour format", () => {
            const d = new Date();
            d.setHours(14, 5, 30, 0);
            expect(PowerManager.formatTimeShortLocal(d)).toBe("2:05 PM");
        });

        test("handles midnight and noon boundaries", () => {
            const d = new Date();
            d.setHours(0, 0, 0, 0);
            expect(PowerManager.formatTimeShortLocal(d)).toBe("12:00 AM");
            d.setHours(12, 0, 0, 0);
            expect(PowerManager.formatTimeShortLocal(d)).toBe("12:00 PM");
        });
    });

    // ── FIX D5: idle teardown on suspend ──
    describe("onSuspendCleanup on suspend", () => {
        // Grab the handler registered for a given powerMonitor event.
        function getRegisteredHandler(eventName) {
            const call = powerMonitor.on.mock.calls.find(
                (c) => c[0] === eventName,
            );
            return call ? call[1] : null;
        }

        afterEach(() => {
            PowerManager.unregisterPowerHandlers();
        });

        test("fires onSuspendCleanup even when the timer is not running", async () => {
            powerMonitor.on.mockClear();
            const onSuspendCleanup = jest.fn();
            const autoStopForPowerEvent = jest
                .fn()
                .mockResolvedValue(undefined);
            PowerManager.registerPowerHandlers({
                isTimerRunning: () => false,
                autoStopForPowerEvent,
                onSuspendCleanup,
            });

            const suspendHandler = getRegisteredHandler("suspend");
            expect(typeof suspendHandler).toBe("function");
            await suspendHandler();

            // Idle teardown runs regardless; auto-stop is skipped (no running timer)
            expect(onSuspendCleanup).toHaveBeenCalledTimes(1);
            expect(autoStopForPowerEvent).not.toHaveBeenCalled();
        });

        test("does not auto-stop by default when the timer is running", async () => {
            powerMonitor.on.mockClear();
            const onSuspendCleanup = jest.fn();
            const autoStopForPowerEvent = jest
                .fn()
                .mockResolvedValue(undefined);
            PowerManager.registerPowerHandlers({
                isTimerRunning: () => true,
                autoStopForPowerEvent,
                onSuspendCleanup,
            });

            const suspendHandler = getRegisteredHandler("suspend");
            await suspendHandler();

            expect(onSuspendCleanup).toHaveBeenCalledTimes(1);
            expect(autoStopForPowerEvent).not.toHaveBeenCalled();
        });

        test("auto-stops only when shouldAutoStopOnSuspend returns true", async () => {
            powerMonitor.on.mockClear();
            const onSuspendCleanup = jest.fn();
            const autoStopForPowerEvent = jest
                .fn()
                .mockResolvedValue(undefined);
            PowerManager.registerPowerHandlers({
                isTimerRunning: () => true,
                shouldAutoStopOnSuspend: () => true,
                autoStopForPowerEvent,
                onSuspendCleanup,
            });

            const suspendHandler = getRegisteredHandler("suspend");
            await suspendHandler();

            expect(onSuspendCleanup).toHaveBeenCalledTimes(1);
            expect(autoStopForPowerEvent).toHaveBeenCalledTimes(1);
        });

        // ── Paired-event coalescing: one lid-close emits lock-screen + suspend ──
        test("coalesces lock-screen + suspend into a single auto-stop when hard-stop enabled", async () => {
            powerMonitor.on.mockClear();
            const autoStopForPowerEvent = jest
                .fn()
                .mockResolvedValue(undefined);
            PowerManager.registerPowerHandlers({
                isTimerRunning: () => true,
                shouldAutoStopOnSuspend: () => true,
                autoStopForPowerEvent,
                onSuspendCleanup: jest.fn(),
            });

            const lockHandler = getRegisteredHandler("lock-screen");
            const suspendHandler = getRegisteredHandler("suspend");

            // Lid close: both fire back-to-back before any resume.
            await lockHandler();
            await suspendHandler();

            // Only the first event performs the stop; the trailing one is ignored.
            expect(autoStopForPowerEvent).toHaveBeenCalledTimes(1);
            expect(autoStopForPowerEvent).toHaveBeenCalledWith(
                "lock-screen",
                expect.any(Number),
            );
        });

        test("a new sleep cycle after resume can hard-stop again when enabled", async () => {
            powerMonitor.on.mockClear();
            const autoStopForPowerEvent = jest
                .fn()
                .mockResolvedValue(undefined);
            PowerManager.registerPowerHandlers({
                isTimerRunning: () => true,
                shouldAutoStopOnSuspend: () => true,
                autoStopForPowerEvent,
                onSuspendCleanup: jest.fn(),
                onResumeAfterSleep: jest.fn(),
            });

            const suspendHandler = getRegisteredHandler("suspend");
            const resumeHandler = getRegisteredHandler("resume");

            await suspendHandler(); // first cycle stops
            await resumeHandler(); // wake — clears the coalescing guard
            await suspendHandler(); // second, independent sleep stops again

            expect(autoStopForPowerEvent).toHaveBeenCalledTimes(2);
        });
    });
});
