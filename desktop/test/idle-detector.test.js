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
});
