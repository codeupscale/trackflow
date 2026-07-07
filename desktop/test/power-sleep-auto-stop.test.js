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
