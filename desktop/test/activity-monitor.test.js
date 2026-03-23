const { uIOhook } = require('uiohook-napi');
const ActivityMonitor = require('../src/main/activity-monitor');

describe('ActivityMonitor', () => {
  let monitor;
  let mockApiClient;
  let mockOfflineQueue;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();

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

  test('start should initialize uiohook', () => {
    monitor.start();
    expect(uIOhook.on).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(uIOhook.on).toHaveBeenCalledWith('click', expect.any(Function));
    expect(uIOhook.on).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(uIOhook.start).toHaveBeenCalled();
  });

  test('keyboard events should increment counter', () => {
    monitor.start();
    // Simulate keyboard events via bound handler
    monitor._onKeydown();
    monitor._onKeydown();
    monitor._onKeydown();
    expect(monitor.keyboardCount).toBe(3);
  });

  test('mouse events should increment counter', () => {
    monitor.start();
    monitor._onClick();
    monitor._onMousemove();
    monitor._onMousemove();
    expect(monitor.mouseCount).toBe(3);
  });

  test('sendHeartbeat should send counts and reset', async () => {
    // Use real timers for this async test (execFile has internal timeouts)
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
});
