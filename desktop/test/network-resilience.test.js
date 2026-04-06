const NetworkMonitor = require('../src/main/network-monitor');

// Mock child_process.execFile for ping fallback
jest.mock('child_process', () => ({
  execFile: jest.fn((cmd, args, opts, cb) => {
    // Default: ping succeeds
    cb(null, 'PING ok', '');
  }),
}));

describe('Network Resilience', () => {
  let monitor;

  beforeEach(() => {
    jest.clearAllMocks();
    monitor = new NetworkMonitor();
  });

  afterEach(() => {
    monitor.stop();
  });

  test('initial state is online', () => {
    expect(monitor.isOnline).toBe(true);
  });

  test('emits "offline" when status changes to offline', (done) => {
    const { net } = require('electron');
    net.isOnline.mockReturnValue(false);

    monitor.on('offline', () => {
      expect(monitor.isOnline).toBe(false);
      done();
    });

    monitor._check();
  });

  test('emits "online" when status changes back to online', (done) => {
    const { net } = require('electron');

    // First go offline
    net.isOnline.mockReturnValue(false);
    monitor._check();

    // Then come back online
    net.isOnline.mockReturnValue(true);
    monitor.on('online', () => {
      expect(monitor.isOnline).toBe(true);
      done();
    });

    monitor._check();
  });

  test('emits "change" on any status transition', () => {
    const { net } = require('electron');
    const changeCb = jest.fn();
    monitor.on('change', changeCb);

    // offline
    net.isOnline.mockReturnValue(false);
    monitor._check();
    expect(changeCb).toHaveBeenCalledTimes(1);

    // online
    net.isOnline.mockReturnValue(true);
    monitor._check();
    expect(changeCb).toHaveBeenCalledTimes(2);
  });

  test('does not emit when status unchanged', () => {
    const { net } = require('electron');
    const changeCb = jest.fn();
    monitor.on('change', changeCb);

    // Stay online
    net.isOnline.mockReturnValue(true);
    monitor._check();
    monitor._check();
    monitor._check();

    expect(changeCb).toHaveBeenCalledTimes(0);
  });

  test('rapid reconnects do not cause multiple emissions for same state', () => {
    const { net } = require('electron');
    const onlineCb = jest.fn();
    const offlineCb = jest.fn();
    monitor.on('online', onlineCb);
    monitor.on('offline', offlineCb);

    // Flaky network: rapid on/off/on/off
    net.isOnline.mockReturnValue(false);
    monitor._check(); // offline
    net.isOnline.mockReturnValue(true);
    monitor._check(); // online
    net.isOnline.mockReturnValue(false);
    monitor._check(); // offline
    net.isOnline.mockReturnValue(true);
    monitor._check(); // online

    expect(offlineCb).toHaveBeenCalledTimes(2);
    expect(onlineCb).toHaveBeenCalledTimes(2);
  });

  test('start() begins interval polling', () => {
    jest.useFakeTimers();
    monitor.start();

    expect(monitor._checkInterval).toBeDefined();

    jest.advanceTimersByTime(15000);
    // At least one check should have happened
    jest.useRealTimers();
  });

  test('stop() clears the interval', () => {
    jest.useFakeTimers();
    monitor.start();
    expect(monitor._checkInterval).toBeDefined();

    monitor.stop();
    expect(monitor._checkInterval).toBeNull();
    jest.useRealTimers();
  });

  test('listener errors do not crash the monitor', () => {
    const { net } = require('electron');
    const errorCb = jest.fn(() => { throw new Error('listener crash'); });
    const normalCb = jest.fn();

    monitor.on('change', errorCb);
    monitor.on('change', normalCb);

    net.isOnline.mockReturnValue(false);
    // Should not throw
    expect(() => monitor._check()).not.toThrow();

    // Both callbacks should have been attempted
    expect(errorCb).toHaveBeenCalled();
    expect(normalCb).toHaveBeenCalled();
  });

  test('_check handles net.isOnline() exceptions gracefully', () => {
    const { net } = require('electron');
    net.isOnline.mockImplementation(() => { throw new Error('net error'); });

    // Should not throw
    expect(() => monitor._check()).not.toThrow();
    // State should remain unchanged
    expect(monitor.isOnline).toBe(true);
  });
});

describe('Network Monitor — Platform Detection', () => {
  test('stores platform from process.platform', () => {
    const monitor = new NetworkMonitor();
    expect(monitor._platform).toBe(process.platform);
    monitor.stop();
  });

  test('_pingCheck resolves true when ping succeeds', async () => {
    const { execFile } = require('child_process');
    execFile.mockImplementation((cmd, args, opts, cb) => cb(null, 'OK', ''));

    const monitor = new NetworkMonitor();
    const result = await monitor._pingCheck();
    expect(result).toBe(true);
    monitor.stop();
  });

  test('_pingCheck resolves false when ping fails', async () => {
    const { execFile } = require('child_process');
    execFile.mockImplementation((cmd, args, opts, cb) => cb(new Error('timeout'), '', ''));

    const monitor = new NetworkMonitor();
    const result = await monitor._pingCheck();
    expect(result).toBe(false);
    monitor.stop();
  });
});
