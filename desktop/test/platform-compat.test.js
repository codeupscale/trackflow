const NetworkMonitor = require('../src/main/network-monitor');

// Mock child_process.execFile
jest.mock('child_process', () => ({
  execFile: jest.fn((cmd, args, opts, cb) => {
    cb(null, 'PING ok', '');
  }),
}));

describe('Platform Compatibility', () => {
  describe('macOS network detection', () => {
    test('uses net.isOnline() directly on macOS (no ping fallback)', async () => {
      const monitor = new NetworkMonitor();
      monitor._platform = 'darwin';
      const { net } = require('electron');
      const { execFile } = require('child_process');

      net.isOnline.mockReturnValue(true);
      await monitor._check();

      // On macOS, ping should NOT be called
      expect(execFile).not.toHaveBeenCalled();
      expect(monitor.isOnline).toBe(true);
      monitor.stop();
    });

    test('uses net.isOnline() directly on Linux (no ping fallback)', async () => {
      const monitor = new NetworkMonitor();
      monitor._platform = 'linux';
      const { net } = require('electron');
      const { execFile } = require('child_process');

      net.isOnline.mockReturnValue(true);
      jest.clearAllMocks();
      await monitor._check();

      expect(execFile).not.toHaveBeenCalled();
      monitor.stop();
    });
  });

  describe('Windows network detection with ping fallback', () => {
    test('on Windows, verifies with ping when net.isOnline() says online', async () => {
      const monitor = new NetworkMonitor();
      monitor._platform = 'win32';
      const { net } = require('electron');
      const { execFile } = require('child_process');

      net.isOnline.mockReturnValue(true);
      execFile.mockImplementation((cmd, args, opts, cb) => cb(null, 'OK', ''));

      // Start as online, go through a transition to force callback
      monitor._isOnline = false; // Pretend we were offline
      await monitor._check();

      // Ping should have been called
      expect(execFile).toHaveBeenCalledWith(
        'ping',
        ['-n', '1', '-w', '3000', '1.1.1.1'],
        expect.objectContaining({ timeout: 5000 }),
        expect.any(Function)
      );
      expect(monitor.isOnline).toBe(true);
      monitor.stop();
    });

    test('on Windows, stays offline when ping fails despite net.isOnline() saying online', async () => {
      const monitor = new NetworkMonitor();
      monitor._platform = 'win32';
      const { net } = require('electron');
      const { execFile } = require('child_process');

      net.isOnline.mockReturnValue(true);
      execFile.mockImplementation((cmd, args, opts, cb) => cb(new Error('timeout'), '', ''));

      // Pretend we're already offline
      monitor._isOnline = false;
      await monitor._check();

      // Ping failed — should stay offline (net.isOnline was unreliable)
      expect(monitor.isOnline).toBe(false);
      monitor.stop();
    });

    test('on Windows, no ping when net.isOnline() says offline', async () => {
      const monitor = new NetworkMonitor();
      monitor._platform = 'win32';
      const { net } = require('electron');
      const { execFile } = require('child_process');

      net.isOnline.mockReturnValue(false);
      jest.clearAllMocks();
      await monitor._check();

      // When net says offline, skip ping (no point pinging if OS says no network)
      expect(execFile).not.toHaveBeenCalled();
      monitor.stop();
    });
  });

  describe('Sleep/Wake behavior (power-manager)', () => {
    test('powerMonitor mock has getSystemIdleTime', () => {
      const { powerMonitor } = require('electron');
      expect(powerMonitor.getSystemIdleTime).toBeDefined();
      expect(typeof powerMonitor.getSystemIdleTime).toBe('function');
    });
  });
});
