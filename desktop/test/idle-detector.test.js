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
        expect(detector.idleTimeoutSec).toBe(10 * 60); // 10 min default (raised from 5, 2026-07-16)
        // Auto-stop disabled (2026-07-23): the idle alert never auto-dismisses.
        expect(detector.alertAutoStopSec).toBe(0);
        expect(detector.hardStopGraceSec).toBe(0);
        expect(detector.enabled).toBe(true);
        expect(detector.state).toBe(IDLE_STATE.STOPPED);
    });

    test("should respect custom config (auto-stop stays disabled)", () => {
        detector = new IdleDetector({
            idle_timeout: 10,
            idle_alert_auto_stop_min: 20,
            idle_check_interval_sec: 30,
        });
        expect(detector.idleTimeoutSec).toBe(600);
        // idle_alert_auto_stop_min is intentionally ignored — the alert never
        // auto-dismisses regardless of the org setting.
        expect(detector.alertAutoStopSec).toBe(0);
        expect(detector.hardStopGraceSec).toBe(0);
        expect(detector.checkIntervalMs).toBe(30000);
    });

    test("idle_alert_auto_stop_min is ignored — auto-stop is always disabled", () => {
        // Whatever the org sets — a huge misconfigured value, a small value, or 0 —
        // auto-stop is off and the alert stays visible until the user resolves it.
        for (const min of [8600, 240, 2, 0]) {
            const d = new IdleDetector({ idle_alert_auto_stop_min: min });
            expect(d.alertAutoStopSec).toBe(0);
            expect(d.hardStopGraceSec).toBe(0);
            d.stop();
        }
    });

    // ── Never-auto-dismiss behavior ────────────────────────────────────────────
    describe("idle alert never auto-dismisses", () => {
        test("auto-stop never fires even with idle_alert_auto_stop_min set", () => {
            // Regression guard for the 2026-07-23 product change: the alert must
            // stay open until the user acts. Neither the (former) interactive
            // countdown nor the (former) hard-stop cap may terminate ALERTING.
            detector = new IdleDetector({
                idle_timeout: 5,
                idle_alert_auto_stop_min: 1, // ignored
                idle_check_interval_sec: 10,
            });
            const onAutoStop = jest.fn();
            detector.onAutoStop(onAutoStop);
            detector.start();

            const idleStartedAt = Date.now();
            detector.setAlertState(idleStartedAt);
            // The check interval MUST still run (ALERTING invariant preserved).
            expect(detector.checkInterval).not.toBeNull();

            // Advance far past any previous auto-stop threshold (30+ min).
            jest.advanceTimersByTime(30 * 60 * 1000);
            expect(onAutoStop).not.toHaveBeenCalled();
            expect(detector.state).toBe(IDLE_STATE.ALERTING);
            expect(detector.isIdleActive()).toBe(true);
        });

        test("auto-stop never fires for a preserved sleep re-show", () => {
            // A preserved idle alert re-shown after a long sleep must also stay
            // open — the disabled hard cap must not fire despite hours of total idle.
            detector = new IdleDetector({
                idle_timeout: 5,
                idle_alert_auto_stop_min: 0,
                idle_check_interval_sec: 10,
            });
            const onAutoStop = jest.fn();
            detector.onAutoStop(onAutoStop);
            detector.start();
            detector.suspend();
            detector.resume();

            // Re-show the alert with idleStartedAt 3 hours ago (long sleep gap).
            const idleStartedAt = Date.now() - 3 * 60 * 60 * 1000;
            detector.setAlertState(idleStartedAt);

            // First tick: must NOT fire despite 3h of total idle.
            jest.advanceTimersByTime(10 * 1000);
            expect(onAutoStop).not.toHaveBeenCalled();

            // Still open long after the former 10-min hard cap.
            jest.advanceTimersByTime(60 * 60 * 1000);
            expect(onAutoStop).not.toHaveBeenCalled();
            expect(detector.state).toBe(IDLE_STATE.ALERTING);
        });

        test("only an explicit user action terminates ALERTING", () => {
            detector = new IdleDetector({
                idle_timeout: 5,
                idle_alert_auto_stop_min: 1,
                idle_check_interval_sec: 10,
            });
            const onAutoStop = jest.fn();
            detector.onAutoStop(onAutoStop);
            detector.start();

            const actionId = detector.setAlertState(Date.now());
            jest.advanceTimersByTime(45 * 60 * 1000);
            expect(detector.state).toBe(IDLE_STATE.ALERTING);

            const result = detector.resolveIdle(actionId);
            expect(result).not.toBeNull();
            expect(detector.state).toBe(IDLE_STATE.RESOLVED);
            expect(detector.checkInterval).toBeNull();
            expect(onAutoStop).not.toHaveBeenCalled();
        });
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

    test("does NOT auto-stop after the alert has been shown a long time", () => {
        detector = new IdleDetector({
            idle_timeout: 5,
            idle_alert_auto_stop_min: 1, // ignored — auto-stop disabled
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

        // Advance well past any former auto-stop threshold — must stay open.
        powerMonitor.getSystemIdleTime.mockReturnValue(4000);
        jest.advanceTimersByTime(60 * 60 * 1000);
        expect(onAutoStop).not.toHaveBeenCalled();
        expect(detector.state).toBe(IDLE_STATE.ALERTING);
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

    test("setAlertState transitions to ALERTING and never auto-stops", () => {
        detector = new IdleDetector({
            idle_timeout: 1,
            idle_alert_auto_stop_min: 2, // ignored
            idle_check_interval_sec: 10,
        });
        const onAutoStop = jest.fn();
        detector.onAutoStop(onAutoStop);
        detector.start();

        // Simulate resume after a long sleep — set alert state externally.
        const sleepStart = Date.now() - 200000; // 200s ago
        const actionId = detector.setAlertState(sleepStart);
        expect(detector.state).toBe(IDLE_STATE.ALERTING);
        expect(detector.idleStartedAt).toBe(sleepStart);
        expect(actionId).toBeGreaterThan(0);

        // The check interval runs (ALERTING invariant) but never fires auto-stop.
        expect(detector.checkInterval).not.toBeNull();
        jest.advanceTimersByTime(60 * 60 * 1000);
        expect(onAutoStop).not.toHaveBeenCalled();
        expect(detector.state).toBe(IDLE_STATE.ALERTING);
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

    // ── Sleep/wake regression tests ────────────────────────────────────────────

    describe("sleep/wake idle preservation", () => {
        test("long sleep does NOT cause immediate auto-stop (and never auto-stops)", () => {
            // Core regression: closing a laptop for a long time must not fire
            // auto-stop before (or after) the idle alert is visible. With auto-stop
            // disabled the alert simply stays open on resume until the user acts.
            detector = new IdleDetector({
                idle_timeout: 5, // 5 min = 300s
                idle_alert_auto_stop_min: 10, // ignored
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

            // Immediately after re-show — no fire.
            jest.advanceTimersByTime(10000);
            expect(onAutoStop).not.toHaveBeenCalled();

            // Far past any former threshold — still open, never auto-stops.
            jest.advanceTimersByTime(60 * 60 * 1000);
            expect(onAutoStop).not.toHaveBeenCalled();
            expect(detector.state).toBe(IDLE_STATE.ALERTING);
        });

        test("user can resolve idle after long sleep (auto-stop never fires)", () => {
            detector = new IdleDetector({
                idle_timeout: 5,
                idle_alert_auto_stop_min: 10, // ignored
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

            // Auto-stop should never fire.
            jest.advanceTimersByTime(60 * 60 * 1000);
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

        test("a spurious start() during ALERTING does not fabricate an auto-stop", () => {
            const onAutoStop = jest.fn();
            detector = new IdleDetector({
                idle_timeout: 1,
                idle_alert_auto_stop_min: 1, // ignored
                idle_check_interval_sec: 10,
            });
            detector.onIdleDetected(jest.fn());
            detector.onAutoStop(onAutoStop);
            detector.start();

            powerMonitor.getSystemIdleTime.mockReturnValue(60);
            jest.advanceTimersByTime(10000);
            expect(detector.state).toBe(IDLE_STATE.ALERTING);

            // Spurious start() must NOT change the alert lifecycle.
            detector.start();

            // Auto-stop is disabled — advancing time must never fire it.
            jest.advanceTimersByTime(60 * 60 * 1000);
            expect(onAutoStop).not.toHaveBeenCalled();
            expect(detector.state).toBe(IDLE_STATE.ALERTING);
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

    // Regression: bugs/desktop-idle-alert-never-appears.md. A throwing callback
    // (there, `pauseTimerForIdle(...).catch()` on a function that had stopped
    // returning a promise) skipped the re-arm below it, stranding the detector in
    // DETECTED with no interval — idle never fired again for the whole session and
    // isIdleActive() stayed true forever, which also stood the idle hard-stop
    // watchdog down permanently.
    describe("a throwing onIdleDetected callback", () => {
        test("still leaves the detector armed in ALERTING", () => {
            detector = new IdleDetector({
                idle_timeout: 5,
                idle_check_interval_sec: 10,
            });
            jest.spyOn(console, "error").mockImplementation(() => {});
            detector.onIdleDetected(() => {
                throw new TypeError(
                    "Cannot read properties of undefined (reading 'catch')",
                );
            });
            detector.start();

            powerMonitor.getSystemIdleTime.mockReturnValue(300);
            expect(() => jest.advanceTimersByTime(10000)).not.toThrow();

            expect(detector.state).toBe(IDLE_STATE.ALERTING);
            expect(detector.checkInterval).not.toBeNull();
            expect(detector.isIdleActive()).toBe(true);
        });

        test("idle still works on the NEXT cycle after the user resolves it", () => {
            detector = new IdleDetector({
                idle_timeout: 5,
                idle_check_interval_sec: 10,
            });
            jest.spyOn(console, "error").mockImplementation(() => {});
            const onIdle = jest.fn(() => {
                throw new Error("boom");
            });
            detector.onIdleDetected(onIdle);
            detector.start();

            powerMonitor.getSystemIdleTime.mockReturnValue(300);
            jest.advanceTimersByTime(10000);
            expect(onIdle).toHaveBeenCalledTimes(1);

            // User answers the (absent) alert, comes back to the keyboard, and the
            // 60s post-resolve cooldown elapses.
            expect(detector.resolveIdle(detector.getActionId())).not.toBeNull();
            detector.start();
            powerMonitor.getSystemIdleTime.mockReturnValue(0);
            jest.advanceTimersByTime(70000);

            // Goes idle again — the detector must fire a second time.
            powerMonitor.getSystemIdleTime.mockReturnValue(300);
            jest.advanceTimersByTime(10000);
            expect(onIdle).toHaveBeenCalledTimes(2);
        });
    });

    // The `keep_idle_time` policies that never open a window resolve the cycle
    // inside the callback and re-arm WATCHING themselves. The detector must not
    // stomp that with ALERTING — doing so orphaned the interval start() had just
    // armed and silently killed idle detection for those orgs.
    test("a callback that resolves and re-starts is left in WATCHING", () => {
        detector = new IdleDetector({
            idle_timeout: 5,
            idle_check_interval_sec: 10,
        });
        const onIdle = jest.fn((_sec, _startedAt, actionId) => {
            detector.resolveIdle(actionId); // policy 'always': keep the time
            detector.start();
        });
        detector.onIdleDetected(onIdle);
        detector.start();

        powerMonitor.getSystemIdleTime.mockReturnValue(300);
        jest.advanceTimersByTime(10000);

        expect(detector.state).toBe(IDLE_STATE.WATCHING);
        expect(detector.isIdleActive()).toBe(false);
        expect(detector.checkInterval).not.toBeNull();
    });
});
