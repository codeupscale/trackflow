const { powerMonitor } = require("electron");
const IdleDetector = require("../src/main/idle-detector");
const { IDLE_STATE } = require("../src/main/idle-detector");

describe("IdleDetector", () => {
    let detector;

    beforeEach(() => {
        jest.useFakeTimers();
        powerMonitor.getSystemIdleTime.mockReturnValue(0);
    });

    afterEach(() => {
        detector?.stop();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    test("should initialize with default config", () => {
        detector = new IdleDetector();
        expect(detector.idleTimeoutSec).toBe(5 * 60); // 5 min default
        expect(detector.alertAutoStopSec).toBe(10 * 60); // 10 min default
        expect(detector.enabled).toBe(true);
        expect(detector.state).toBe(IDLE_STATE.STOPPED);
    });

    test("should respect custom config", () => {
        detector = new IdleDetector({
            idle_timeout: 10,
            idle_alert_auto_stop_min: 20,
            idle_check_interval_sec: 30,
        });
        expect(detector.idleTimeoutSec).toBe(600);
        expect(detector.alertAutoStopSec).toBe(1200);
        expect(detector.checkIntervalMs).toBe(30000);
    });

    test("caps idle auto-stop at 4 hours regardless of a misconfigured org setting", () => {
        // Regression: an org setting of 8600 min (~6 days) produced an absurd
        // "auto-stop in 8597:40" countdown and a never-auto-stopping timer.
        detector = new IdleDetector({ idle_alert_auto_stop_min: 8600 });
        expect(detector.alertAutoStopSec).toBe(240 * 60); // clamped to 4h
    });

    test("does not raise a small auto-stop value to the cap", () => {
        detector = new IdleDetector({ idle_alert_auto_stop_min: 2 });
        expect(detector.alertAutoStopSec).toBe(120);
    });

    test("zero auto-stop minutes disables idle popup auto-stop", () => {
        detector = new IdleDetector({ idle_alert_auto_stop_min: 0 });
        expect(detector.alertAutoStopSec).toBe(0);

        detector.start();
        powerMonitor.getSystemIdleTime.mockReturnValue(600);
        jest.advanceTimersByTime(2000);

        detector.setAlertState();
        jest.advanceTimersByTime(30 * 60 * 1000);

        expect(detector.checkInterval).toBeNull();
    });

    test("should not start if disabled", () => {
        detector = new IdleDetector({ idle_detection: false });
        expect(detector.enabled).toBe(false);
        detector.start();
        expect(detector.checkInterval).toBeNull();
        expect(detector.state).toBe(IDLE_STATE.STOPPED);
    });

    test("floors idle_timeout 0 to 1 minute (idle detection cannot be disabled)", () => {
        detector = new IdleDetector({ idle_timeout: 0 });
        expect(detector.idleTimeoutSec).toBe(60);
        expect(detector.enabled).toBe(true);
    });

    test("should detect idle when system idle exceeds threshold", () => {
        detector = new IdleDetector({
            idle_timeout: 5,
            idle_check_interval_sec: 10,
        });
        const onIdle = jest.fn();
        detector.onIdleDetected(onIdle);
        detector.start();
        expect(detector.state).toBe(IDLE_STATE.WATCHING);

        // Not idle yet
        powerMonitor.getSystemIdleTime.mockReturnValue(100);
        jest.advanceTimersByTime(10000);
        expect(onIdle).not.toHaveBeenCalled();

        // Now idle (300 sec = 5 min threshold)
        powerMonitor.getSystemIdleTime.mockReturnValue(300);
        jest.advanceTimersByTime(10000);
        expect(onIdle).toHaveBeenCalledTimes(1);
        expect(onIdle).toHaveBeenCalledWith(
            300,
            expect.any(Number),
            expect.any(Number),
        );
        expect(detector.state).toBe(IDLE_STATE.ALERTING);
        expect(detector.isIdleActive()).toBe(true);
    });

    test("should not fire idle multiple times", () => {
        detector = new IdleDetector({
            idle_timeout: 5,
            idle_check_interval_sec: 10,
        });
        const onIdle = jest.fn();
        detector.onIdleDetected(onIdle);
        detector.start();

        powerMonitor.getSystemIdleTime.mockReturnValue(300);
        jest.advanceTimersByTime(10000);
        jest.advanceTimersByTime(10000);
        jest.advanceTimersByTime(10000);
        expect(onIdle).toHaveBeenCalledTimes(1);
    });

    test("should auto-stop after alert timeout", () => {
        detector = new IdleDetector({
            idle_timeout: 5,
            idle_alert_auto_stop_min: 1, // 1 min auto-stop for faster test
            idle_check_interval_sec: 10,
        });
        const onIdle = jest.fn();
        const onAutoStop = jest.fn();
        detector.onIdleDetected(onIdle);
        detector.onAutoStop(onAutoStop);
        detector.start();

        // Become idle
        powerMonitor.getSystemIdleTime.mockReturnValue(300);
        jest.advanceTimersByTime(10000);
        expect(onIdle).toHaveBeenCalledTimes(1);

        // Advance past auto-stop threshold (1 min)
        powerMonitor.getSystemIdleTime.mockReturnValue(400);
        jest.advanceTimersByTime(70000); // 7 more checks
        expect(onAutoStop).toHaveBeenCalledTimes(1);
    });

    test("resolveIdle should reset idle state and return idle info", () => {
        detector = new IdleDetector({
            idle_timeout: 5,
            idle_check_interval_sec: 10,
        });
        detector.onIdleDetected(jest.fn());
        detector.start();

        powerMonitor.getSystemIdleTime.mockReturnValue(300);
        jest.advanceTimersByTime(10000);
        expect(detector.state).toBe(IDLE_STATE.ALERTING);

        const actionId = detector.getActionId();
        const result = detector.resolveIdle(actionId);
        expect(result).not.toBeNull();
        expect(result.idleStartedAt).toBeDefined();
        expect(result.idleDuration).toBeGreaterThanOrEqual(0);
        expect(detector.state).toBe(IDLE_STATE.RESOLVED);
        expect(detector.idleStartedAt).toBeNull();
        expect(detector.alertShownAt).toBeNull();
    });

    test("resolveIdle returns null for stale action ID", () => {
        detector = new IdleDetector({
            idle_timeout: 5,
            idle_check_interval_sec: 10,
        });
        detector.onIdleDetected(jest.fn());
        detector.start();

        powerMonitor.getSystemIdleTime.mockReturnValue(300);
        jest.advanceTimersByTime(10000);

        const staleId = detector.getActionId() - 1;
        const result = detector.resolveIdle(staleId);
        expect(result).toBeNull();
        // State should be unchanged — still alerting
        expect(detector.state).toBe(IDLE_STATE.ALERTING);
    });

    test("resolveIdle returns null when not in alerting state", () => {
        detector = new IdleDetector({
            idle_timeout: 5,
            idle_check_interval_sec: 10,
        });
        detector.start();
        // Not idle — WATCHING state
        expect(detector.state).toBe(IDLE_STATE.WATCHING);
        const result = detector.resolveIdle();
        expect(result).toBeNull();
    });

    test("getIdleDuration should return correct duration", () => {
        detector = new IdleDetector({
            idle_timeout: 5,
            idle_check_interval_sec: 10,
        });
        detector.start();

        // No idle = 0
        expect(detector.getIdleDuration()).toBe(0);

        // Simulate idle via setAlertState
        const idleStart = Date.now() - 120000; // 2 minutes ago
        detector.setAlertState(idleStart);
        const duration = detector.getIdleDuration();
        expect(duration).toBeGreaterThanOrEqual(119);
        expect(duration).toBeLessThanOrEqual(121);
    });

    test("stop should clear all state", () => {
        detector = new IdleDetector({
            idle_timeout: 5,
            idle_check_interval_sec: 10,
        });
        detector.start();
        expect(detector.checkInterval).not.toBeNull();

        detector.stop();
        expect(detector.checkInterval).toBeNull();
        expect(detector.state).toBe(IDLE_STATE.STOPPED);
        expect(detector.idleStartedAt).toBeNull();
    });

    test("updateConfig should update thresholds", () => {
        detector = new IdleDetector({ idle_timeout: 5 });
        expect(detector.idleTimeoutSec).toBe(300);

        detector.updateConfig({ idle_timeout: 10 });
        expect(detector.idleTimeoutSec).toBe(600);
    });

    // ── State machine transition tests ─────────────────────────────────────────

    test("state transitions: STOPPED -> WATCHING -> ALERTING -> RESOLVED -> WATCHING", () => {
        detector = new IdleDetector({
            idle_timeout: 1,
            idle_check_interval_sec: 10,
        });
        detector.onIdleDetected(jest.fn());
        expect(detector.state).toBe(IDLE_STATE.STOPPED);

        detector.start();
        expect(detector.state).toBe(IDLE_STATE.WATCHING);

        // Trigger idle
        powerMonitor.getSystemIdleTime.mockReturnValue(60);
        jest.advanceTimersByTime(10000);
        expect(detector.state).toBe(IDLE_STATE.ALERTING);

        // Resolve
        const actionId = detector.getActionId();
        detector.resolveIdle(actionId);
        expect(detector.state).toBe(IDLE_STATE.RESOLVED);

        // Re-arm
        detector.start();
        expect(detector.state).toBe(IDLE_STATE.WATCHING);
    });

    test("suspend and resume transitions", () => {
        detector = new IdleDetector({
            idle_timeout: 5,
            idle_check_interval_sec: 10,
        });
        detector.start();
        expect(detector.state).toBe(IDLE_STATE.WATCHING);

        const snapshot = detector.suspend();
        expect(detector.state).toBe(IDLE_STATE.SUSPENDED);
        expect(snapshot.previousState).toBe(IDLE_STATE.WATCHING);
        expect(snapshot.isIdle).toBe(false);
        expect(detector.checkInterval).toBeNull();

        detector.resume();
        expect(detector.state).toBe(IDLE_STATE.STOPPED);
    });

    test("suspend preserves idle state in snapshot when alerting", () => {
        detector = new IdleDetector({
            idle_timeout: 1,
            idle_check_interval_sec: 10,
        });
        detector.onIdleDetected(jest.fn());
        detector.start();

        // Go idle
        powerMonitor.getSystemIdleTime.mockReturnValue(60);
        jest.advanceTimersByTime(10000);
        expect(detector.state).toBe(IDLE_STATE.ALERTING);
        const idleStart = detector.idleStartedAt;

        // Suspend
        const snapshot = detector.suspend();
        expect(snapshot.isIdle).toBe(true);
        expect(snapshot.idleStartedAt).toBe(idleStart);
        expect(detector.state).toBe(IDLE_STATE.SUSPENDED);
    });

    test("setAlertState transitions to ALERTING with auto-stop check", () => {
        detector = new IdleDetector({
            idle_timeout: 1,
            idle_alert_auto_stop_min: 2, // 2 min = 120s auto-stop after alert shown
            idle_check_interval_sec: 10,
        });
        const onAutoStop = jest.fn();
        detector.onAutoStop(onAutoStop);
        detector.start();

        // Simulate resume after a long sleep — set alert state externally.
        // Even though total idle exceeds the old (idleTimeout + autoStop) threshold,
        // auto-stop should NOT fire immediately. It now counts from when the alert
        // was shown (alertShownAt), giving the user the full autoStop window to respond.
        const sleepStart = Date.now() - 200000; // 200s ago
        const actionId = detector.setAlertState(sleepStart);
        expect(detector.state).toBe(IDLE_STATE.ALERTING);
        expect(detector.idleStartedAt).toBe(sleepStart);
        expect(actionId).toBeGreaterThan(0);

        // The auto-stop check interval should be running
        expect(detector.checkInterval).not.toBeNull();

        // After 10s of alert display, auto-stop should NOT fire (10s < 120s threshold)
        jest.advanceTimersByTime(10000);
        expect(onAutoStop).not.toHaveBeenCalled();

        // After 110s more (total 120s of alert display), auto-stop should fire
        jest.advanceTimersByTime(110000);
        expect(onAutoStop).toHaveBeenCalledTimes(1);

        // The reported total idle duration should reflect the full idle period
        // (from idleStartedAt to now), not just the alert display time
        const reportedDuration = onAutoStop.mock.calls[0][0];
        expect(reportedDuration).toBeGreaterThanOrEqual(300); // 200s sleep + 120s alert
    });

    // ── Auto-stop tests (updated from original) ───────────────────────────────

    test("auto-stop fires based on total idle time (idle_timeout + auto_stop)", () => {
        detector = new IdleDetector({
            idle_timeout: 2, // 2 min = 120s
            idle_alert_auto_stop_min: 3, // 3 min = 180s
            idle_check_interval_sec: 10,
        });
        const onIdle = jest.fn();
        const onAutoStop = jest.fn();
        detector.onIdleDetected(onIdle);
        detector.onAutoStop(onAutoStop);
        detector.start();

        // Become idle at exactly 120s of system idle time
        powerMonitor.getSystemIdleTime.mockReturnValue(120);
        jest.advanceTimersByTime(10000);
        expect(onIdle).toHaveBeenCalledTimes(1);

        // After 170s more real time, total idle ~290s — should NOT auto-stop
        powerMonitor.getSystemIdleTime.mockReturnValue(290);
        jest.advanceTimersByTime(170000);
        expect(onAutoStop).not.toHaveBeenCalled();

        // After 20s more, total idle ~310s >= 300s — should auto-stop
        powerMonitor.getSystemIdleTime.mockReturnValue(310);
        jest.advanceTimersByTime(20000);
        expect(onAutoStop).toHaveBeenCalledTimes(1);
    });

    test("auto-stop fires after correct total duration with precise threshold", () => {
        detector = new IdleDetector({
            idle_timeout: 1, // 1 min = 60s
            idle_alert_auto_stop_min: 2, // 2 min = 120s
            idle_check_interval_sec: 10,
        });
        const onIdle = jest.fn();
        const onAutoStop = jest.fn();
        detector.onIdleDetected(onIdle);
        detector.onAutoStop(onAutoStop);
        detector.start();

        // Become idle at 60s
        powerMonitor.getSystemIdleTime.mockReturnValue(60);
        jest.advanceTimersByTime(10000);
        expect(onIdle).toHaveBeenCalledTimes(1);
        expect(detector.state).toBe(IDLE_STATE.ALERTING);
        expect(detector.idleStartedAt).not.toBeNull();

        // Verify idleStartedAt was backdated: it should be ~60s before current time
        const expectedIdleStart = Date.now() - 60 * 1000;
        expect(detector.idleStartedAt).toBe(expectedIdleStart);

        // Advance 110s — total idle from idleStartedAt = ~170s (< 180s threshold)
        powerMonitor.getSystemIdleTime.mockReturnValue(170);
        jest.advanceTimersByTime(110000);
        expect(onAutoStop).not.toHaveBeenCalled();

        // Advance 10s more — total idle from idleStartedAt = ~180s (>= 180s threshold)
        powerMonitor.getSystemIdleTime.mockReturnValue(180);
        jest.advanceTimersByTime(10000);
        expect(onAutoStop).toHaveBeenCalledTimes(1);

        // auto-stop should only fire once
        expect(onAutoStop).toHaveBeenCalledTimes(1);
    });

    test("auto-stop callback receives total idle duration and actionId", () => {
        detector = new IdleDetector({
            idle_timeout: 1, // 60s
            idle_alert_auto_stop_min: 1, // 60s
            idle_check_interval_sec: 10,
        });
        const onAutoStop = jest.fn();
        detector.onIdleDetected(jest.fn());
        detector.onAutoStop(onAutoStop);
        detector.start();

        // Become idle at 60s
        powerMonitor.getSystemIdleTime.mockReturnValue(60);
        jest.advanceTimersByTime(10000);

        // Auto-stop threshold = 60 + 60 = 120s from idleStartedAt
        powerMonitor.getSystemIdleTime.mockReturnValue(130);
        jest.advanceTimersByTime(70000);
        expect(onAutoStop).toHaveBeenCalledTimes(1);

        // The callback args should be (totalIdleDuration, actionId)
        const reportedDuration = onAutoStop.mock.calls[0][0];
        expect(reportedDuration).toBeGreaterThanOrEqual(120);
        expect(reportedDuration).toBeLessThanOrEqual(140);

        const reportedActionId = onAutoStop.mock.calls[0][1];
        expect(typeof reportedActionId).toBe("number");
        expect(reportedActionId).toBeGreaterThan(0);
    });

    test("getIdleDuration returns correct value during active idle tracking", () => {
        detector = new IdleDetector({
            idle_timeout: 1,
            idle_check_interval_sec: 10,
        });
        detector.onIdleDetected(jest.fn());
        detector.start();

        // Before idle, duration is 0
        expect(detector.getIdleDuration()).toBe(0);

        // Become idle
        powerMonitor.getSystemIdleTime.mockReturnValue(60);
        jest.advanceTimersByTime(10000);
        expect(detector.state).toBe(IDLE_STATE.ALERTING);

        // Immediately after detection, getIdleDuration should reflect the backdated start
        const durationAtDetection = detector.getIdleDuration();
        expect(durationAtDetection).toBeGreaterThanOrEqual(59);
        expect(durationAtDetection).toBeLessThanOrEqual(61);

        // Advance 30 more seconds — duration should increase accordingly
        jest.advanceTimersByTime(30000);
        const durationAfter30s = detector.getIdleDuration();
        expect(durationAfter30s).toBeGreaterThanOrEqual(89);
        expect(durationAfter30s).toBeLessThanOrEqual(91);
    });

    // ── Cooldown / re-detection tests ──────────────────────────────────────────

    test("after resolveIdle, does not re-detect until fresh input arrives", () => {
        detector = new IdleDetector({
            idle_timeout: 1,
            idle_check_interval_sec: 10,
        });
        const onIdle = jest.fn();
        detector.onIdleDetected(onIdle);
        detector.start();

        // Become idle
        powerMonitor.getSystemIdleTime.mockReturnValue(60);
        jest.advanceTimersByTime(10000);
        expect(onIdle).toHaveBeenCalledTimes(1);

        // Resolve and restart
        detector.resolveIdle(detector.getActionId());
        detector.start();

        // System still idle — should NOT fire again (cooldown active)
        powerMonitor.getSystemIdleTime.mockReturnValue(120);
        jest.advanceTimersByTime(10000);
        expect(onIdle).toHaveBeenCalledTimes(1); // no second fire

        // User provides input — cooldown clears after 60s minimum window
        powerMonitor.getSystemIdleTime.mockReturnValue(5);
        jest.advanceTimersByTime(60000); // advance 60s so elapsed >= MIN_COOLDOWN_MS

        // User goes idle again — should fire
        powerMonitor.getSystemIdleTime.mockReturnValue(60);
        jest.advanceTimersByTime(10000);
        expect(onIdle).toHaveBeenCalledTimes(2);
    });

    // ── Double-action prevention tests ─────────────────────────────────────────

    test("double resolveIdle with same actionId returns null on second call", () => {
        detector = new IdleDetector({
            idle_timeout: 1,
            idle_check_interval_sec: 10,
        });
        detector.onIdleDetected(jest.fn());
        detector.start();

        powerMonitor.getSystemIdleTime.mockReturnValue(60);
        jest.advanceTimersByTime(10000);

        const actionId = detector.getActionId();
        const first = detector.resolveIdle(actionId);
        expect(first).not.toBeNull();

        const second = detector.resolveIdle(actionId);
        expect(second).toBeNull(); // Already resolved
    });

    // ── Sleep/wake regression tests (auto-stop timing fix) ────────────────────

    describe("sleep/wake auto-stop timing", () => {
        test("long sleep (> idle + autoStop) does NOT cause immediate auto-stop", () => {
            // This is the core regression test for the bug where closing a laptop
            // for > 15 minutes caused auto-stop to fire before the idle alert was
            // visible, resulting in the timer being stopped without the user seeing
            // the idle popup.
            detector = new IdleDetector({
                idle_timeout: 5, // 5 min = 300s
                idle_alert_auto_stop_min: 10, // 10 min = 600s
                idle_check_interval_sec: 10,
            });
            const onAutoStop = jest.fn();
            detector.onAutoStop(onAutoStop);

            // Simulate: timer running, laptop sleeps for 20 minutes
            detector.start();
            detector.suspend();

            // Resume after 20 minutes of sleep
            detector.resume();
            const sleepStart = Date.now() - 20 * 60 * 1000; // 20 min ago
            detector.setAlertState(sleepStart);

            // After 10 seconds (first check interval), auto-stop should NOT fire
            // because the alert has only been shown for 10 seconds, not 10 minutes
            jest.advanceTimersByTime(10000);
            expect(onAutoStop).not.toHaveBeenCalled();

            // After 5 minutes (300s) of alert display, still should not fire
            jest.advanceTimersByTime(290000); // total: 300s
            expect(onAutoStop).not.toHaveBeenCalled();

            // After 10 minutes (600s) of alert display, auto-stop should fire
            jest.advanceTimersByTime(300000); // total: 600s
            expect(onAutoStop).toHaveBeenCalledTimes(1);

            // The callback should report the TOTAL idle duration (sleep + alert time)
            const totalDuration = onAutoStop.mock.calls[0][0];
            expect(totalDuration).toBeGreaterThanOrEqual(20 * 60 + 600); // ~30 min total
        });

        test("moderate sleep (5-15 min) gives user full autoStop window", () => {
            detector = new IdleDetector({
                idle_timeout: 5, // 5 min = 300s
                idle_alert_auto_stop_min: 10, // 10 min = 600s
                idle_check_interval_sec: 10,
            });
            const onAutoStop = jest.fn();
            detector.onAutoStop(onAutoStop);

            // Sleep for 7 minutes (exceeds idle threshold but not autoStop total)
            detector.start();
            detector.suspend();
            detector.resume();
            const sleepStart = Date.now() - 7 * 60 * 1000;
            detector.setAlertState(sleepStart);

            // User has 10 minutes to respond, regardless of how long the sleep was
            jest.advanceTimersByTime(5 * 60 * 1000); // 5 min of alert
            expect(onAutoStop).not.toHaveBeenCalled();

            jest.advanceTimersByTime(5 * 60 * 1000); // 10 min of alert total
            expect(onAutoStop).toHaveBeenCalledTimes(1);
        });

        test("user can resolve idle before auto-stop after long sleep", () => {
            detector = new IdleDetector({
                idle_timeout: 5,
                idle_alert_auto_stop_min: 10,
                idle_check_interval_sec: 10,
            });
            const onAutoStop = jest.fn();
            detector.onAutoStop(onAutoStop);

            // 30 minute sleep — way past old auto-stop threshold
            detector.start();
            detector.suspend();
            detector.resume();
            const sleepStart = Date.now() - 30 * 60 * 1000;
            const actionId = detector.setAlertState(sleepStart);

            // User responds after 5 seconds
            jest.advanceTimersByTime(5000);
            const result = detector.resolveIdle(actionId);
            expect(result).not.toBeNull();
            expect(result.idleStartedAt).toBe(sleepStart);
            expect(detector.state).toBe(IDLE_STATE.RESOLVED);

            // Auto-stop should never fire since idle was resolved
            jest.advanceTimersByTime(20 * 60 * 1000);
            expect(onAutoStop).not.toHaveBeenCalled();
        });

        test("suspend during ALERTING preserves idle state for resume", () => {
            detector = new IdleDetector({
                idle_timeout: 1,
                idle_check_interval_sec: 10,
            });
            detector.onIdleDetected(jest.fn());
            detector.start();

            // Go idle
            powerMonitor.getSystemIdleTime.mockReturnValue(60);
            jest.advanceTimersByTime(10000);
            expect(detector.state).toBe(IDLE_STATE.ALERTING);
            const idleStart = detector.idleStartedAt;

            // Suspend (laptop lid closes while idle alert is showing)
            const snapshot = detector.suspend();
            expect(snapshot.isIdle).toBe(true);
            expect(snapshot.idleStartedAt).toBe(idleStart);
            expect(detector.state).toBe(IDLE_STATE.SUSPENDED);

            // Resume
            detector.resume();
            expect(detector.state).toBe(IDLE_STATE.STOPPED);

            // Caller should use snapshot to restore alert state
            const actionId = detector.setAlertState(snapshot.idleStartedAt);
            expect(detector.state).toBe(IDLE_STATE.ALERTING);
            expect(detector.idleStartedAt).toBe(idleStart);
            expect(actionId).toBeGreaterThan(0);
        });
    });

    // BUG B: a spurious start() (e.g. from the timer sync loop seeing a transient
    // `status.running && !isTimerRunning` tick) must NOT clobber a live idle alert.
    // Before the fix, start() reset idleStartedAt/alertShownAt to null and cleared
    // the auto-stop interval, flipping isIdleActive() to false and causing the
    // idle popup to "sometimes not appear" (showIdleAlert's guard swallowed it).
    describe("start() does not clobber a live alert (BUG B)", () => {
        test("start() during ALERTING is a no-op and preserves idle state", () => {
            detector = new IdleDetector({
                idle_timeout: 1,
                idle_check_interval_sec: 10,
            });
            detector.onIdleDetected(jest.fn());
            detector.start();

            powerMonitor.getSystemIdleTime.mockReturnValue(60);
            jest.advanceTimersByTime(10000);
            expect(detector.state).toBe(IDLE_STATE.ALERTING);

            const idleStart = detector.idleStartedAt;
            const shownAt = detector.alertShownAt;
            const actionId = detector.getActionId();

            // Spurious re-arm while the alert is live
            detector.start();

            expect(detector.state).toBe(IDLE_STATE.ALERTING);
            expect(detector.isIdleActive()).toBe(true);
            expect(detector.idleStartedAt).toBe(idleStart);
            expect(detector.alertShownAt).toBe(shownAt);
            expect(detector.getActionId()).toBe(actionId);
        });

        test("start() during DETECTED is a no-op (callback mid-flight)", () => {
            detector = new IdleDetector({
                idle_timeout: 1,
                idle_check_interval_sec: 10,
            });
            // Simulate a callback that re-enters start() while still DETECTED, before
            // _check() promotes the state to ALERTING.
            detector.onIdleDetected(() => {
                expect(detector.state).toBe(IDLE_STATE.DETECTED);
                detector.start(); // must be ignored
                expect(detector.state).toBe(IDLE_STATE.DETECTED);
                expect(detector.idleStartedAt).not.toBeNull();
            });
            detector.start();

            powerMonitor.getSystemIdleTime.mockReturnValue(60);
            jest.advanceTimersByTime(10000);

            // _check() still completes the promotion to ALERTING afterward
            expect(detector.state).toBe(IDLE_STATE.ALERTING);
            expect(detector.isIdleActive()).toBe(true);
        });

        test("auto-stop still fires after a spurious start() during ALERTING", () => {
            const onAutoStop = jest.fn();
            detector = new IdleDetector({
                idle_timeout: 1,
                idle_alert_auto_stop_min: 1,
                idle_check_interval_sec: 10,
            });
            detector.onIdleDetected(jest.fn());
            detector.onAutoStop(onAutoStop);
            detector.start();

            powerMonitor.getSystemIdleTime.mockReturnValue(60);
            jest.advanceTimersByTime(10000);
            expect(detector.state).toBe(IDLE_STATE.ALERTING);

            // Spurious start() must NOT cancel the auto-stop interval
            detector.start();

            // Advance past the 1-minute auto-stop window
            jest.advanceTimersByTime(60 * 1000);
            expect(onAutoStop).toHaveBeenCalledTimes(1);
        });

        test("start() during SUSPENDED is a no-op (sleep-preserved idle)", () => {
            detector = new IdleDetector({
                idle_timeout: 1,
                idle_check_interval_sec: 10,
            });
            detector.onIdleDetected(jest.fn());
            detector.start();
            powerMonitor.getSystemIdleTime.mockReturnValue(60);
            jest.advanceTimersByTime(10000);
            expect(detector.state).toBe(IDLE_STATE.ALERTING);

            const snap = detector.suspend();
            expect(detector.state).toBe(IDLE_STATE.SUSPENDED);
            expect(snap.idleStartedAt).not.toBeNull();
            const preservedStart = detector.idleStartedAt;

            detector.start();

            expect(detector.state).toBe(IDLE_STATE.SUSPENDED);
            expect(detector.idleStartedAt).toBe(preservedStart);
        });
    });
});
