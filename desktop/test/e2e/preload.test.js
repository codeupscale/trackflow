/**
 * Preload script tests -- verifies the contextBridge API surface and
 * IPC channel mappings exposed to the renderer process.
 *
 * Covers: TC-100 through TC-103
 */

// The jest.config.js moduleNameMapper handles electron -> __mocks__/electron.js
// so we can require it directly
const { ipcRenderer, contextBridge } = require('electron');

let exposedApi;

// Set up the mock before requiring the preload script
contextBridge.exposeInMainWorld.mockImplementation((name, api) => {
  if (name === 'trackflow') exposedApi = api;
});

// Require the preload script -- this calls contextBridge.exposeInMainWorld
require('../../src/preload/index');

describe('Preload Script', () => {
  beforeEach(() => {
    // Only clear call counts, not the implementation or the captured API
    ipcRenderer.invoke.mockClear();
    ipcRenderer.on.mockClear();
    ipcRenderer.removeListener.mockClear();
  });

  // TC-100: contextBridge.exposeInMainWorld called with 'trackflow'
  test('TC-100: exposes API under "trackflow" namespace', () => {
    expect(contextBridge.exposeInMainWorld).toHaveBeenCalledWith('trackflow', expect.any(Object));
    expect(exposedApi).toBeDefined();
  });

  // TC-101: Each invoke method maps to correct IPC channel
  describe('TC-101: invoke methods map to correct IPC channels', () => {
    const invokeMethods = [
      ['getTimerState', 'get-timer-state', ['project-123']],
      ['startTimer', 'start-timer', ['project-123']],
      ['stopTimer', 'stop-timer', []],
      ['getProjects', 'get-projects', []],
      ['getLastProject', 'get-last-project', []],
      ['setLastProject', 'set-last-project', ['project-456']],
      ['logout', 'logout', []],
      ['login', 'login', ['test@example.com', 'password123']],
      ['googleLogin', 'google-login', []],
      ['selectOrganization', 'select-organization', ['org-1', { email: 'test@example.com' }]],
      ['openDashboard', 'open-dashboard', []],
      ['resolveIdle', 'resolve-idle', ['keep', undefined, undefined]],
      ['checkScreenPermission', 'check-screen-permission', []],
      ['requestScreenPermission', 'request-screen-permission', []],
      ['openScreenRecordingSettings', 'open-screen-recording-settings', []],
      ['getTheme', 'get-theme', []],
      ['installUpdate', 'install-update', []],
    ];

    test.each(invokeMethods)(
      '%s() calls ipcRenderer.invoke with "%s"',
      (method, channel, args) => {
        expect(exposedApi[method]).toBeInstanceOf(Function);
        exposedApi[method](...args);
        expect(ipcRenderer.invoke).toHaveBeenCalledWith(channel, ...args);
      }
    );
  });

  // TC-102 / TC-103: Event listeners replace previous listener (safeOn)
  describe('TC-102/103: event listeners use safeOn to prevent leaks', () => {
    const eventMethods = [
      ['onOrgSelection', 'org-selection-required'],
      ['onGoogleAuthError', 'google-auth-error'],
      ['onPermissionStatus', 'permission-status'],
      ['onScreenshotPermissionIssue', 'screenshot-permission-issue'],
      ['onThemeChange', 'theme-changed'],
      ['onTimerStarted', 'timer-started'],
      ['onTimerStopped', 'timer-stopped'],
      ['onTimerTick', 'timer-tick'],
      ['onSyncTimer', 'sync-timer'],
      ['onProjectsReady', 'projects-ready'],
      ['onIdleData', 'idle-data'],
      ['onUpdateReady', 'update-ready'],
    ];

    test.each(eventMethods)(
      '%s() registers listener on "%s" channel',
      (method, channel) => {
        const callback = jest.fn();
        expect(exposedApi[method]).toBeInstanceOf(Function);
        exposedApi[method](callback);
        expect(ipcRenderer.on).toHaveBeenCalledWith(channel, expect.any(Function));
      }
    );

    test('registering same event twice removes previous listener', () => {
      const cb1 = jest.fn();
      const cb2 = jest.fn();

      exposedApi.onTimerStarted(cb1);
      const firstCallCount = ipcRenderer.on.mock.calls.filter(c => c[0] === 'timer-started').length;
      expect(firstCallCount).toBeGreaterThanOrEqual(1);

      // Clear to track the second registration
      ipcRenderer.removeListener.mockClear();

      // Register again -- should remove old listener first
      exposedApi.onTimerStarted(cb2);
      expect(ipcRenderer.removeListener).toHaveBeenCalledWith('timer-started', expect.any(Function));
    });
  });

  // Verify the complete API surface is present
  test('exposes all expected methods', () => {
    const expectedMethods = [
      'getTimerState', 'startTimer', 'stopTimer', 'getProjects',
      'getLastProject', 'setLastProject', 'logout', 'login',
      'googleLogin', 'selectOrganization', 'openDashboard',
      'onOrgSelection', 'onGoogleAuthError', 'resolveIdle',
      'checkScreenPermission', 'requestScreenPermission',
      'openScreenRecordingSettings', 'onPermissionStatus',
      'onScreenshotPermissionIssue', 'getTheme', 'onThemeChange',
      'onTimerStarted', 'onTimerStopped', 'onTimerTick',
      'onSyncTimer', 'onProjectsReady', 'onIdleData',
      'onUpdateReady', 'installUpdate',
    ];

    for (const method of expectedMethods) {
      expect(exposedApi).toHaveProperty(method);
      expect(typeof exposedApi[method]).toBe('function');
    }
  });
});
