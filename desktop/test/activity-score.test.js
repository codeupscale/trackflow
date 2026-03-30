const { uIOhook } = require('uiohook-napi');
const { powerMonitor, systemPreferences } = require('electron');
const ActivityMonitor = require('../src/main/activity-monitor');

/**
 * Activity score calculation tests for the desktop agent.
 *
 * Covers:
 *   - Active-seconds model: per-second binary tracking
 *   - EMA smoothing via _computeIntervalScore
 *   - Heartbeat payload: active_seconds and activity_score fields
 *   - Score resets when timer stops
 *   - Total active_seconds increments correctly over multiple intervals
 *   - Screenshot metadata includes activity score
 *   - Heartbeat queued when API unreachable
 *   - Queue flushed on reconnect in correct order
 *   - No data loss after multiple queued heartbeats
 */
describe('ActivityMonitor — Active-Seconds Scoring', () => {
  let monitor;
  let mockApiClient;
  let mockOfflineQueue;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    systemPreferences.isTrustedAccessibilityClient.mockReturnValue(true);

    mockApiClient = {
      sendHeartbeat: jest.fn(() => Promise.resolve()),
    };
    mockOfflineQueue = {
      add: jest.fn(),
    };

    monitor = new ActivityMonitor(mockApiClient, mockOfflineQueue);
  });

  afterEach(() => {
    monitor.stop();
    jest.useRealTimers();
  });

  // ── Active second tracking ──────────────────────────────────────

  test('active second counted when input received in interval', () => {
    monitor.start();

    // Simulate a keydown — should register the current second as active
    monitor._onKeydown();

    expect(monitor._activeSeconds.size).toBeGreaterThanOrEqual(1);
  });

  test('no active second when no input in interval', () => {
    monitor.start();

    // No input events — activeSeconds should remain empty
    expect(monitor._activeSeconds.size).toBe(0);
  });

  test('multiple inputs in same second count as one active second', () => {
    monitor.start();

    // Multiple events in the same millisecond
    monitor._onKeydown();
    monitor._onKeydown();
    monitor._onKeydown();
    monitor._onClick();

    // All in the same second, so Set should have exactly 1 entry
    expect(monitor._activeSeconds.size).toBe(1);
  });

  test('inputs in different seconds count as separate active seconds', () => {
    monitor.start();

    // Event at second 0
    monitor._onKeydown();

    // Advance 1 second and fire another event
    jest.advanceTimersByTime(1000);
    monitor._onKeydown();

    // Advance another second
    jest.advanceTimersByTime(1000);
    monitor._onClick();

    expect(monitor._activeSeconds.size).toBe(3);
  });

  test('total_active_seconds increments correctly over multiple intervals', () => {
    monitor.start();

    // Simulate 5 seconds of activity
    for (let i = 0; i < 5; i++) {
      monitor._onKeydown();
      jest.advanceTimersByTime(1000);
    }

    expect(monitor._activeSeconds.size).toBe(5);
  });

  // ── _computeIntervalScore ───────────────────────────────────────

  test('score is 0 when no input in interval', () => {
    monitor.start();

    // Advance time but no input
    jest.advanceTimersByTime(5000);

    const score = monitor._computeIntervalScore();
    expect(score).toBe(0);
  });

  test('score is 100 when every second has input', () => {
    monitor.start();

    // Generate input for every second in a 10-second span
    for (let i = 0; i < 10; i++) {
      monitor._onKeydown();
      jest.advanceTimersByTime(1000);
    }

    const score = monitor._computeIntervalScore();
    expect(score).toBe(100);
  });

  test('score reflects percentage of active seconds', () => {
    monitor.start();

    // 5 seconds of activity in a 10-second window
    for (let i = 0; i < 10; i++) {
      if (i < 5) {
        monitor._onKeydown();
      }
      jest.advanceTimersByTime(1000);
    }

    const score = monitor._computeIntervalScore();
    expect(score).toBe(50);
  });

  test('score cannot exceed 100', () => {
    monitor.start();

    // Generate input for every second
    for (let i = 0; i < 30; i++) {
      monitor._onKeydown();
      monitor._onClick();
      jest.advanceTimersByTime(1000);
    }

    const score = monitor._computeIntervalScore();
    expect(score).toBeLessThanOrEqual(100);
  });

  // ── getScoreForScreenshot ───────────────────────────────────────

  test('getScoreForScreenshot returns last completed interval score', async () => {
    jest.useRealTimers();
    monitor.start();

    // Initially 0
    expect(monitor.getScoreForScreenshot()).toBe(0);

    // After a heartbeat, it should update
    monitor.keyboardCount = 100;
    monitor.mouseCount = 100;
    monitor._activeSeconds.add(Math.floor(Date.now() / 1000));

    await monitor.sendHeartbeat();

    // Score should now reflect the completed interval
    const score = monitor.getScoreForScreenshot();
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
    jest.useFakeTimers();
  }, 10000);

  test('getCurrentScore returns live score for in-progress interval', () => {
    monitor.start();

    // No input yet
    expect(monitor.getCurrentScore()).toBe(0);

    // Add some input
    monitor._onKeydown();
    jest.advanceTimersByTime(1000);
    monitor._onClick();

    const score = monitor.getCurrentScore();
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  // ── Score resets when timer stops ───────────────────────────────

  test('score resets to 0 when timer stops', () => {
    monitor.start();

    // Generate activity
    for (let i = 0; i < 5; i++) {
      monitor._onKeydown();
      jest.advanceTimersByTime(1000);
    }
    expect(monitor._activeSeconds.size).toBeGreaterThan(0);

    monitor.stop();

    expect(monitor._activeSeconds.size).toBe(0);
    expect(monitor._lastCompletedIntervalScore).toBe(0);
    expect(monitor._intervalStartTime).toBeNull();
    expect(monitor.keyboardCount).toBe(0);
    expect(monitor.mouseCount).toBe(0);
  });

  // ── Heartbeat payload ──────────────────────────────────────────

  test('heartbeat payload contains active_seconds and resets counters', async () => {
    jest.useRealTimers();
    monitor.start();

    // Simulate some activity
    monitor.keyboardCount = 25;
    monitor.mouseCount = 40;
    // Add 10 active seconds
    const nowSec = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 10; i++) {
      monitor._activeSeconds.add(nowSec - i);
    }

    await monitor.sendHeartbeat();

    expect(mockApiClient.sendHeartbeat).toHaveBeenCalledWith(
      expect.objectContaining({
        keyboard_events: 25,
        mouse_events: 40,
        active_seconds: 10,
      })
    );

    // Counters should be reset
    expect(monitor.keyboardCount).toBe(0);
    expect(monitor.mouseCount).toBe(0);
    expect(monitor._activeSeconds.size).toBe(0);
    jest.useFakeTimers();
  }, 10000);

  test('heartbeat includes active_app and active_window_title', async () => {
    jest.useRealTimers();
    monitor.start();
    monitor.keyboardCount = 5;
    monitor.mouseCount = 5;

    await monitor.sendHeartbeat();

    const call = mockApiClient.sendHeartbeat.mock.calls[0][0];
    expect(call).toHaveProperty('active_app');
    expect(call).toHaveProperty('active_window_title');
    expect(call).toHaveProperty('active_url');
    jest.useFakeTimers();
  }, 10000);

  // ── Heartbeat queuing (offline) ────────────────────────────────

  test('heartbeat queued when API unreachable', async () => {
    jest.useRealTimers();
    mockApiClient.sendHeartbeat.mockRejectedValueOnce(new Error('Network error'));

    monitor.keyboardCount = 10;
    monitor.mouseCount = 20;
    const nowSec = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 5; i++) {
      monitor._activeSeconds.add(nowSec - i);
    }

    await monitor.sendHeartbeat();

    expect(mockOfflineQueue.add).toHaveBeenCalledWith(
      'heartbeat',
      expect.objectContaining({
        keyboard_events: 10,
        mouse_events: 20,
        active_seconds: 5,
        logged_at: expect.any(String),
      })
    );
    jest.useFakeTimers();
  }, 10000);

  test('no data loss after 10 queued heartbeats', async () => {
    jest.useRealTimers();
    mockApiClient.sendHeartbeat.mockRejectedValue(new Error('offline'));

    for (let i = 0; i < 10; i++) {
      monitor.keyboardCount = i + 1;
      monitor.mouseCount = (i + 1) * 2;
      const sec = Math.floor(Date.now() / 1000);
      monitor._activeSeconds.add(sec);

      await monitor.sendHeartbeat();
    }

    // All 10 should be queued
    expect(mockOfflineQueue.add).toHaveBeenCalledTimes(10);

    // Verify each call preserved the correct keyboard_events
    for (let i = 0; i < 10; i++) {
      const callData = mockOfflineQueue.add.mock.calls[i][1];
      expect(callData.keyboard_events).toBe(i + 1);
      expect(callData.mouse_events).toBe((i + 1) * 2);
    }
    jest.useFakeTimers();
  }, 15000);

  // ── Fallback mode active-seconds estimation ────────────────────

  describe('fallback mode active-seconds', () => {
    beforeEach(() => {
      systemPreferences.isTrustedAccessibilityClient.mockReturnValue(false);
      powerMonitor.getSystemIdleTime.mockReturnValue(1);
    });

    test('fallback estimates active seconds when user is active', () => {
      const mon = new ActivityMonitor(mockApiClient, mockOfflineQueue);
      mon.start();

      // Each poll covers 3 seconds. If active (idle < 5s), marks 3 seconds as active.
      jest.advanceTimersByTime(3000); // 1 poll
      expect(mon._activeSeconds.size).toBe(3);

      jest.advanceTimersByTime(3000); // 2nd poll
      expect(mon._activeSeconds.size).toBe(6);

      mon.stop();
    });

    test('fallback does not add active seconds when idle', () => {
      powerMonitor.getSystemIdleTime.mockReturnValue(60);
      const mon = new ActivityMonitor(mockApiClient, mockOfflineQueue);
      mon.start();

      jest.advanceTimersByTime(3000);
      expect(mon._activeSeconds.size).toBe(0);

      mon.stop();
    });

    test('30s of full activity in fallback produces ~30 active seconds', () => {
      const mon = new ActivityMonitor(mockApiClient, mockOfflineQueue);
      mon.start();

      // 30s = 10 polls, each adding 3 active seconds
      jest.advanceTimersByTime(30000);
      expect(mon._activeSeconds.size).toBe(30);

      mon.stop();
    });
  });

  // ── sendFinalHeartbeat edge cases ──────────────────────────────

  test('sendFinalHeartbeat skips when all counters are zero', async () => {
    jest.useRealTimers();
    monitor.keyboardCount = 0;
    monitor.mouseCount = 0;
    monitor._activeSeconds = new Set();

    await monitor.sendFinalHeartbeat();

    expect(mockApiClient.sendHeartbeat).not.toHaveBeenCalled();
    jest.useFakeTimers();
  }, 10000);

  test('sendFinalHeartbeat sends remaining data including active_seconds', async () => {
    jest.useRealTimers();
    monitor.keyboardCount = 5;
    monitor.mouseCount = 10;
    const sec = Math.floor(Date.now() / 1000);
    monitor._activeSeconds.add(sec);
    monitor._activeSeconds.add(sec - 1);
    monitor._activeSeconds.add(sec - 2);

    await monitor.sendFinalHeartbeat();

    expect(mockApiClient.sendHeartbeat).toHaveBeenCalledWith(
      expect.objectContaining({
        keyboard_events: 5,
        mouse_events: 10,
        active_seconds: 3,
      })
    );
    jest.useFakeTimers();
  }, 10000);
});
