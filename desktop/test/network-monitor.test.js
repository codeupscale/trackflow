/**
 * NetworkMonitor Tests
 *
 * Tests online/offline detection, event emission, start/stop lifecycle.
 */

const { net } = require('electron');
const NetworkMonitor = require('../src/main/network-monitor');

// Mock electron net module
jest.mock('electron', () => ({
  net: {
    isOnline: jest.fn(() => true),
  },
  app: {
    getPath: jest.fn(() => '/tmp/trackflow-test'),
    quit: jest.fn(),
    exit: jest.fn(),
    isPackaged: false,
    requestSingleInstanceLock: jest.fn(() => true),
    setLoginItemSettings: jest.fn(),
    on: jest.fn(),
    dock: { hide: jest.fn(), show: jest.fn() },
    getVersion: jest.fn(() => '1.0.0'),
  },
}));

describe('NetworkMonitor', () => {
  let monitor;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    net.isOnline.mockReturnValue(true);
    monitor = new NetworkMonitor();
  });

  afterEach(() => {
    monitor.stop();
    jest.useRealTimers();
  });

  test('should start as online', () => {
    expect(monitor.isOnline).toBe(true);
  });

  test('start() should begin polling', () => {
    monitor.start();
    expect(monitor._checkInterval).not.toBeNull();
  });

  test('stop() should clear interval', () => {
    monitor.start();
    monitor.stop();
    expect(monitor._checkInterval).toBeNull();
  });

  test('should emit "offline" when network goes down', () => {
    const offlineCallback = jest.fn();
    const changeCallback = jest.fn();
    monitor.on('offline', offlineCallback);
    monitor.on('change', changeCallback);

    monitor.start();

    // Simulate going offline
    net.isOnline.mockReturnValue(false);
    jest.advanceTimersByTime(15000);

    expect(offlineCallback).toHaveBeenCalledTimes(1);
    expect(changeCallback).toHaveBeenCalledTimes(1);
    expect(monitor.isOnline).toBe(false);
  });

  test('should emit "online" when network comes back', () => {
    const onlineCallback = jest.fn();
    monitor.on('online', onlineCallback);

    // Start as offline
    net.isOnline.mockReturnValue(false);
    monitor._isOnline = false;
    monitor.start();

    // Simulate coming online
    net.isOnline.mockReturnValue(true);
    jest.advanceTimersByTime(15000);

    expect(onlineCallback).toHaveBeenCalledTimes(1);
    expect(monitor.isOnline).toBe(true);
  });

  test('should NOT emit events when state does not change', () => {
    const changeCallback = jest.fn();
    monitor.on('change', changeCallback);
    monitor.start();

    // Stay online
    net.isOnline.mockReturnValue(true);
    jest.advanceTimersByTime(15000);
    jest.advanceTimersByTime(15000);
    jest.advanceTimersByTime(15000);

    expect(changeCallback).not.toHaveBeenCalled();
  });

  test('should handle net.isOnline() throwing an error', () => {
    monitor.start();
    net.isOnline.mockImplementation(() => { throw new Error('net error'); });

    // Should not throw
    expect(() => jest.advanceTimersByTime(15000)).not.toThrow();
    // State should remain unchanged
    expect(monitor.isOnline).toBe(true);
  });

  test('should handle listener errors gracefully', () => {
    const errorCallback = jest.fn(() => { throw new Error('listener error'); });
    monitor.on('offline', errorCallback);
    monitor.start();

    net.isOnline.mockReturnValue(false);
    // Should not throw even though listener throws
    expect(() => jest.advanceTimersByTime(15000)).not.toThrow();
  });

  test('should support multiple listeners per event', () => {
    const cb1 = jest.fn();
    const cb2 = jest.fn();
    monitor.on('offline', cb1);
    monitor.on('offline', cb2);
    monitor.start();

    net.isOnline.mockReturnValue(false);
    jest.advanceTimersByTime(15000);

    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  test('on() with invalid event should not throw', () => {
    expect(() => monitor.on('invalid-event', jest.fn())).not.toThrow();
  });

  test('multiple start/stop cycles should not leak intervals', () => {
    monitor.start();
    monitor.start(); // Double start
    monitor.stop();
    expect(monitor._checkInterval).toBeNull();

    monitor.start();
    monitor.stop();
    monitor.stop(); // Double stop
    expect(monitor._checkInterval).toBeNull();
  });
});
