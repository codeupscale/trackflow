const { powerMonitor } = require('electron');
const IdleDetector = require('../src/main/idle-detector');

describe('IdleDetector', () => {
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

  test('should initialize with default config', () => {
    detector = new IdleDetector();
    expect(detector.idleTimeoutSec).toBe(5 * 60); // 5 min default
    expect(detector.alertAutoStopSec).toBe(10 * 60); // 10 min default
    expect(detector.enabled).toBe(true);
  });

  test('should respect custom config', () => {
    detector = new IdleDetector({
      idle_timeout: 10,
      idle_alert_auto_stop_min: 20,
      idle_check_interval_sec: 30,
    });
    expect(detector.idleTimeoutSec).toBe(600);
    expect(detector.alertAutoStopSec).toBe(1200);
    expect(detector.checkIntervalMs).toBe(30000);
  });

  test('should not start if disabled', () => {
    detector = new IdleDetector({ idle_detection: false });
    expect(detector.enabled).toBe(false);
    detector.start();
    expect(detector.checkInterval).toBeNull();
  });

  test('should not start if idle_timeout is 0', () => {
    detector = new IdleDetector({ idle_timeout: 0 });
    expect(detector.enabled).toBe(false);
  });

  test('should detect idle when system idle exceeds threshold', () => {
    detector = new IdleDetector({ idle_timeout: 5, idle_check_interval_sec: 10 });
    const onIdle = jest.fn();
    detector.onIdleDetected(onIdle);
    detector.start();

    // Not idle yet
    powerMonitor.getSystemIdleTime.mockReturnValue(100);
    jest.advanceTimersByTime(10000);
    expect(onIdle).not.toHaveBeenCalled();

    // Now idle (300 sec = 5 min threshold)
    powerMonitor.getSystemIdleTime.mockReturnValue(300);
    jest.advanceTimersByTime(10000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(onIdle).toHaveBeenCalledWith(300, expect.any(Number));
    expect(detector.isIdle).toBe(true);
  });

  test('should not fire idle multiple times', () => {
    detector = new IdleDetector({ idle_timeout: 5, idle_check_interval_sec: 10 });
    const onIdle = jest.fn();
    detector.onIdleDetected(onIdle);
    detector.start();

    powerMonitor.getSystemIdleTime.mockReturnValue(300);
    jest.advanceTimersByTime(10000);
    jest.advanceTimersByTime(10000);
    jest.advanceTimersByTime(10000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  test('should auto-stop after alert timeout', () => {
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

  test('resolveIdle should reset idle state', () => {
    detector = new IdleDetector({ idle_timeout: 5, idle_check_interval_sec: 10 });
    detector.onIdleDetected(jest.fn());
    detector.start();

    powerMonitor.getSystemIdleTime.mockReturnValue(300);
    jest.advanceTimersByTime(10000);
    expect(detector.isIdle).toBe(true);

    detector.resolveIdle();
    expect(detector.isIdle).toBe(false);
    expect(detector.idleStartedAt).toBeNull();
    expect(detector.alertShownAt).toBeNull();
  });

  test('getIdleDuration should return correct duration', () => {
    detector = new IdleDetector({ idle_timeout: 5, idle_check_interval_sec: 10 });
    detector.start();

    // No idle = 0
    expect(detector.getIdleDuration()).toBe(0);

    // Simulate idle
    detector.isIdle = true;
    detector.idleStartedAt = Date.now() - 120000; // 2 minutes ago
    const duration = detector.getIdleDuration();
    expect(duration).toBeGreaterThanOrEqual(119);
    expect(duration).toBeLessThanOrEqual(121);
  });

  test('stop should clear all state', () => {
    detector = new IdleDetector({ idle_timeout: 5, idle_check_interval_sec: 10 });
    detector.start();
    expect(detector.checkInterval).not.toBeNull();

    detector.stop();
    expect(detector.checkInterval).toBeNull();
    expect(detector.isIdle).toBe(false);
    expect(detector.idleStartedAt).toBeNull();
  });

  test('updateConfig should update thresholds', () => {
    detector = new IdleDetector({ idle_timeout: 5 });
    expect(detector.idleTimeoutSec).toBe(300);

    detector.updateConfig({ idle_timeout: 10 });
    expect(detector.idleTimeoutSec).toBe(600);
  });

  // ── New tests: auto-stop fires based on total idle time ──────────────────

  test('auto-stop fires based on total idle time (idle_timeout + auto_stop), not just auto_stop from alert', () => {
    // Config: idle_timeout = 2 min (120s), auto_stop = 3 min (180s)
    // Total time before auto-stop should be 120 + 180 = 300s from when user went idle
    detector = new IdleDetector({
      idle_timeout: 2,              // 2 min = 120s
      idle_alert_auto_stop_min: 3,  // 3 min = 180s
      idle_check_interval_sec: 10,
    });
    const onIdle = jest.fn();
    const onAutoStop = jest.fn();
    detector.onIdleDetected(onIdle);
    detector.onAutoStop(onAutoStop);
    detector.start();

    // Become idle at exactly 120s of system idle time
    powerMonitor.getSystemIdleTime.mockReturnValue(120);
    jest.advanceTimersByTime(10000); // 1st check
    expect(onIdle).toHaveBeenCalledTimes(1);

    // At this point idleStartedAt = Date.now() - 120*1000 (backdated by system idle)
    // Auto-stop requires totalIdleDuration >= 120 + 180 = 300s from idleStartedAt
    // That means we need 180 more real seconds to pass (since 120s already accounted for)

    // After 170s more real time (17 checks), total idle = ~290s — should NOT auto-stop
    powerMonitor.getSystemIdleTime.mockReturnValue(290);
    jest.advanceTimersByTime(170000);
    expect(onAutoStop).not.toHaveBeenCalled();

    // After 20s more real time (2 checks), total idle = ~310s >= 300s — should auto-stop
    powerMonitor.getSystemIdleTime.mockReturnValue(310);
    jest.advanceTimersByTime(20000);
    expect(onAutoStop).toHaveBeenCalledTimes(1);
  });

  test('auto-stop fires after correct total duration with precise threshold', () => {
    // Config: idle_timeout = 1 min (60s), auto_stop = 2 min (120s)
    // Total threshold = 60 + 120 = 180s from idleStartedAt
    detector = new IdleDetector({
      idle_timeout: 1,              // 1 min = 60s
      idle_alert_auto_stop_min: 2,  // 2 min = 120s
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
    expect(detector.isIdle).toBe(true);
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

    // resolveIdle was called internally by auto-stop, but because systemIdleSec
    // still exceeds idleTimeoutSec, the next _check tick re-enters idle state.
    // Verify auto-stop only fired once (no double-fire in the same batch).
    expect(onAutoStop).toHaveBeenCalledTimes(1);
  });

  test('auto-stop does not fire if user returns (system idle drops below 5s)', () => {
    detector = new IdleDetector({
      idle_timeout: 1,              // 1 min = 60s
      idle_alert_auto_stop_min: 2,  // 2 min = 120s
      idle_check_interval_sec: 10,
    });
    const onIdle = jest.fn();
    const onAutoStop = jest.fn();
    detector.onIdleDetected(onIdle);
    detector.onAutoStop(onAutoStop);
    detector.start();

    // Become idle
    powerMonitor.getSystemIdleTime.mockReturnValue(60);
    jest.advanceTimersByTime(10000);
    expect(onIdle).toHaveBeenCalledTimes(1);

    // User returns — system idle drops below 5s
    // The _check method returns early without auto-stopping
    powerMonitor.getSystemIdleTime.mockReturnValue(2);
    jest.advanceTimersByTime(10000);
    expect(onAutoStop).not.toHaveBeenCalled();
    // Note: isIdle remains true because only the alert window resolves it
    expect(detector.isIdle).toBe(true);
  });

  test('getIdleDuration returns correct value during active idle tracking', () => {
    detector = new IdleDetector({
      idle_timeout: 1,
      idle_check_interval_sec: 10,
    });
    detector.onIdleDetected(jest.fn());
    detector.start();

    // Before idle, duration is 0
    expect(detector.getIdleDuration()).toBe(0);

    // Become idle — system reports 60s idle, so idleStartedAt is backdated 60s
    powerMonitor.getSystemIdleTime.mockReturnValue(60);
    jest.advanceTimersByTime(10000);
    expect(detector.isIdle).toBe(true);

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

  test('auto-stop callback receives total idle duration', () => {
    detector = new IdleDetector({
      idle_timeout: 1,              // 60s
      idle_alert_auto_stop_min: 1,  // 60s
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
    // Need 60 more real seconds to pass
    powerMonitor.getSystemIdleTime.mockReturnValue(130);
    jest.advanceTimersByTime(70000);
    expect(onAutoStop).toHaveBeenCalledTimes(1);

    // The callback arg should be the total idle duration in seconds
    const reportedDuration = onAutoStop.mock.calls[0][0];
    expect(reportedDuration).toBeGreaterThanOrEqual(120);
    expect(reportedDuration).toBeLessThanOrEqual(140);
  });
});
