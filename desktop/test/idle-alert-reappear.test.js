jest.mock('electron', () => ({
  powerMonitor: {
    getSystemIdleTime: jest.fn(() => 0),
  },
}));

const IdleDetector = require('../src/main/idle-detector');

describe('Idle Alert Re-appearance', () => {
  test('should re-show idle alert when closed without user action during active idle', () => {
    jest.useFakeTimers();

    const detector = new IdleDetector({ idle_timeout: 5, idle_check_interval_sec: 10 });

    detector.start();
    detector._state = 'ALERTING';
    detector.idleStartedAt = Date.now() - 300000;
    detector.alertShownAt = Date.now();
    detector._actionId = 1;

    expect(detector.isIdleActive()).toBe(true);
    expect(detector.getIdleDuration()).toBeGreaterThan(0);
    expect(detector.getActionId()).toBe(1);

    // The re-show logic in index.js checks:
    // 1. idleDetector.isIdleActive() — true
    // 2. isTimerRunning — true (simulated by caller)
    // Verify that the detector stays in ALERTING state when no resolve is called
    expect(detector.isIdleActive()).toBe(true);

    detector.stop();
    jest.useRealTimers();
  });

  test('should NOT re-show when idle has been resolved', () => {
    const detector = new IdleDetector({ idle_timeout: 5, idle_check_interval_sec: 10 });

    detector.start();
    detector._state = 'ALERTING';
    detector._actionId = 1;
    detector.idleStartedAt = Date.now() - 300000;

    detector.resolveIdle(1);

    expect(detector.isIdleActive()).toBe(false);

    detector.stop();
  });

  test('should NOT re-show after programmatic dismissal', () => {
    const detector = new IdleDetector({ idle_timeout: 5, idle_check_interval_sec: 10 });

    detector.start();
    detector._state = 'ALERTING';
    detector._actionId = 1;

    detector.resolveIdle(1);

    expect(detector.state).toBe('RESOLVED');
    expect(detector.isIdleActive()).toBe(false);

    detector.stop();
  });

  test('getIdleDuration returns 0 when idleStartedAt is null', () => {
    const detector = new IdleDetector({ idle_timeout: 5, idle_check_interval_sec: 10 });

    expect(detector.getIdleDuration()).toBe(0);

    detector.stop();
  });

  test('resolveIdle rejects stale actionId', () => {
    const detector = new IdleDetector({ idle_timeout: 5, idle_check_interval_sec: 10 });

    detector.start();
    detector._state = 'ALERTING';
    detector._actionId = 3;
    detector.idleStartedAt = Date.now() - 60000;

    const result = detector.resolveIdle(1);
    expect(result).toBeNull();
    expect(detector.isIdleActive()).toBe(true);

    detector.stop();
  });
});
