const { uIOhook } = require('uiohook-napi');
const { powerMonitor, systemPreferences } = require('electron');
const ActivityMonitor = require('../src/main/activity-monitor');

describe('ActivityMonitor', () => {
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

  test('should initialize with zero counts', () => {
    expect(monitor.keyboardCount).toBe(0);
    expect(monitor.mouseCount).toBe(0);
    expect(monitor.interval).toBeNull();
  });

  test('start should begin heartbeat interval', () => {
    monitor.start();
    expect(monitor.interval).not.toBeNull();
  });

  test('start should not double-start', () => {
    monitor.start();
    const firstInterval = monitor.interval;
    monitor.start();
    expect(monitor.interval).toBe(firstInterval);
  });

  test('start should initialize uiohook when accessibility granted', () => {
    monitor.start();
    expect(uIOhook.on).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(uIOhook.on).toHaveBeenCalledWith('click', expect.any(Function));
    expect(uIOhook.on).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(uIOhook.start).toHaveBeenCalled();
  });

  test('keyboard events should increment counter', () => {
    monitor.start();
    monitor._onKeydown();
    monitor._onKeydown();
    monitor._onKeydown();
    expect(monitor.keyboardCount).toBe(3);
  });

  test('mouse click events should increment counter', () => {
    monitor.start();
    monitor._onClick();
    monitor._onClick();
    expect(monitor.mouseCount).toBe(2);
  });

  test('mousemove should be throttled to 1 per 200ms', () => {
    monitor.start();
    const now = Date.now();

    // First move: counts (time is 0, last was 0 — diff >= 200)
    monitor._onMousemove();
    expect(monitor.mouseCount).toBe(1);

    // Rapid moves within 200ms: should NOT count
    // (fake timers means Date.now() doesn't advance unless we advance)
    monitor._onMousemove();
    monitor._onMousemove();
    monitor._onMousemove();
    // Still 1 because Date.now() hasn't advanced
    expect(monitor.mouseCount).toBe(1);

    // Advance 200ms
    jest.advanceTimersByTime(200);
    monitor._onMousemove();
    expect(monitor.mouseCount).toBe(2);
  });

  test('sendHeartbeat should send counts and reset', async () => {
    jest.useRealTimers();
    monitor.start();
    monitor.keyboardCount = 15;
    monitor.mouseCount = 30;

    await monitor.sendHeartbeat();

    expect(mockApiClient.sendHeartbeat).toHaveBeenCalledWith(
      expect.objectContaining({
        keyboard_events: 15,
        mouse_events: 30,
      })
    );
    expect(monitor.keyboardCount).toBe(0);
    expect(monitor.mouseCount).toBe(0);
    jest.useFakeTimers();
  }, 10000);

  test('sendHeartbeat should queue on failure', async () => {
    jest.useRealTimers();
    mockApiClient.sendHeartbeat.mockRejectedValueOnce(new Error('Network error'));
    monitor.keyboardCount = 5;
    monitor.mouseCount = 10;

    await monitor.sendHeartbeat();

    expect(mockOfflineQueue.add).toHaveBeenCalledWith('heartbeat', expect.objectContaining({
      keyboard_events: 5,
      mouse_events: 10,
      logged_at: expect.any(String),
    }));
    jest.useFakeTimers();
  }, 10000);

  test('sendFinalHeartbeat sends remaining data', async () => {
    jest.useRealTimers();
    monitor.keyboardCount = 7;
    monitor.mouseCount = 12;

    await monitor.sendFinalHeartbeat();

    expect(mockApiClient.sendHeartbeat).toHaveBeenCalledWith(
      expect.objectContaining({
        keyboard_events: 7,
        mouse_events: 12,
      })
    );
    jest.useFakeTimers();
  }, 10000);

  test('sendFinalHeartbeat skips when counts are zero', async () => {
    jest.useRealTimers();
    monitor.keyboardCount = 0;
    monitor.mouseCount = 0;

    await monitor.sendFinalHeartbeat();

    expect(mockApiClient.sendHeartbeat).not.toHaveBeenCalled();
    jest.useFakeTimers();
  }, 10000);

  test('stop should clear interval and counts', () => {
    monitor.start();
    expect(monitor.interval).not.toBeNull();
    monitor.stop();
    expect(monitor.interval).toBeNull();
    expect(monitor.keyboardCount).toBe(0);
    expect(monitor.mouseCount).toBe(0);
  });

  test('stop should remove uiohook listeners', () => {
    monitor.start();
    monitor.stop();
    expect(uIOhook.removeListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(uIOhook.removeListener).toHaveBeenCalledWith('click', expect.any(Function));
    expect(uIOhook.removeListener).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(uIOhook.stop).toHaveBeenCalled();
  });

  test('heartbeat interval should fire every 30 seconds', () => {
    const spy = jest.spyOn(monitor, 'sendHeartbeat').mockImplementation(() => Promise.resolve());
    monitor.start();

    jest.advanceTimersByTime(30000);
    expect(spy).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(30000);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  // ── Fallback mode tests ──

  describe('powerMonitor fallback mode', () => {
    beforeEach(() => {
      systemPreferences.isTrustedAccessibilityClient.mockReturnValue(false);
      powerMonitor.getSystemIdleTime.mockReturnValue(1);
    });

    test('uses fallback when accessibility not granted', () => {
      const mon = new ActivityMonitor(mockApiClient, mockOfflineQueue);
      mon.start();
      expect(uIOhook.on).not.toHaveBeenCalled();
      expect(mon._useIdleFallback).toBe(true);
      expect(mon._idlePollInterval).not.toBeNull();
      mon.stop();
    });

    test('fallback generates calibrated event counts when active', () => {
      const mon = new ActivityMonitor(mockApiClient, mockOfflineQueue);
      mon.start();

      jest.advanceTimersByTime(3000);
      expect(mon.keyboardCount).toBe(12);
      expect(mon.mouseCount).toBe(18);

      jest.advanceTimersByTime(3000);
      expect(mon.keyboardCount).toBe(24);
      expect(mon.mouseCount).toBe(36);

      mon.stop();
    });

    test('fallback generates zero events when idle', () => {
      powerMonitor.getSystemIdleTime.mockReturnValue(60);
      const mon = new ActivityMonitor(mockApiClient, mockOfflineQueue);
      mon.start();

      jest.advanceTimersByTime(3000);
      expect(mon.keyboardCount).toBe(0);
      expect(mon.mouseCount).toBe(0);

      mon.stop();
    });

    test('30s of full activity generates ~300 total events (matches backend maxExpected)', () => {
      const mon = new ActivityMonitor(mockApiClient, mockOfflineQueue);
      // Spy on sendHeartbeat to capture the event counts BEFORE reset
      const hbSpy = jest.spyOn(mon, 'sendHeartbeat').mockImplementation(async function() {
        // Snapshot counters the same way the real implementation does
        this._lastCapturedKeyboard = this.keyboardCount;
        this._lastCapturedMouse = this.mouseCount;
        this.keyboardCount = 0;
        this.mouseCount = 0;
        this._activeSeconds = new Set();
        this._intervalStartTime = Date.now();
      });
      mon.start();

      // Advance 30s — 10 fallback polls fire (3s each), then heartbeat fires at 30s
      // The heartbeat resets counters to 0, so we check the captured snapshot
      jest.advanceTimersByTime(30000);
      const total = mon._lastCapturedKeyboard + mon._lastCapturedMouse;
      expect(total).toBe(300);

      hbSpy.mockRestore();
      mon.stop();
    });

    test('fallback stops polling when stopped', () => {
      const mon = new ActivityMonitor(mockApiClient, mockOfflineQueue);
      mon.start();
      expect(mon._idlePollInterval).not.toBeNull();
      mon.stop();
      expect(mon._idlePollInterval).toBeNull();
    });
  });
});
