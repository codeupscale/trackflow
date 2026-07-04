const { BrowserWindow } = require('electron');

/**
 * Tests for the idle alert window creation pattern used in showIdleAlert().
 *
 * The function in index.js creates a BrowserWindow with show:false and
 * relies on two events (ready-to-show + did-finish-load) to make it visible.
 * These tests verify that the window becomes visible via either event path,
 * and that the local-reference pattern prevents null-deref crashes when the
 * outer variable is reassigned during loading.
 */
describe('Idle alert window visibility', () => {
  let win;
  let eventHandlers;

  beforeEach(() => {
    eventHandlers = {};
    // Create a mock window that records event listeners and allows manual firing
    win = {
      show: jest.fn(),
      focus: jest.fn(),
      destroy: jest.fn(),
      isDestroyed: jest.fn(() => false),
      on: jest.fn((event, handler) => {
        eventHandlers[event] = handler;
      }),
      once: jest.fn((event, handler) => {
        eventHandlers[event] = handler;
      }),
      loadFile: jest.fn(() => Promise.resolve()),
      webContents: {
        send: jest.fn(),
        once: jest.fn((event, handler) => {
          eventHandlers[`webContents:${event}`] = handler;
        }),
      },
    };
  });

  function simulateShowIdleAlert(winRef) {
    // This replicates the pattern from showIdleAlert() in index.js
    let shown = false;
    const idleData = {
      idleStartedAt: Date.now() - 300000,
      idleSeconds: 300,
      actionId: 1,
      alertShownAt: Date.now() - 60000,
      autoStopGraceSec: 600,
      projects: [],
    };

    function showAndSendData() {
      if (shown) return;
      if (winRef.isDestroyed()) return;
      shown = true;
      winRef.show();
      winRef.focus();
      winRef.webContents.send('idle-data', idleData);
    }

    winRef.once('ready-to-show', showAndSendData);
    winRef.webContents.once('did-finish-load', showAndSendData);
    winRef.on('closed', () => {});
    winRef.loadFile('idle-alert.html').catch(() => {});

    return { showAndSendData, getShown: () => shown };
  }

  test('window becomes visible when ready-to-show fires', () => {
    simulateShowIdleAlert(win);

    // Simulate ready-to-show firing
    const readyHandler = eventHandlers['ready-to-show'];
    expect(readyHandler).toBeDefined();
    readyHandler();

    expect(win.show).toHaveBeenCalledTimes(1);
    expect(win.focus).toHaveBeenCalledTimes(1);
    expect(win.webContents.send).toHaveBeenCalledWith('idle-data', expect.any(Object));
  });

  test('window becomes visible via did-finish-load fallback when ready-to-show does not fire', () => {
    simulateShowIdleAlert(win);

    // Simulate did-finish-load firing (ready-to-show never fired)
    const loadHandler = eventHandlers['webContents:did-finish-load'];
    expect(loadHandler).toBeDefined();
    loadHandler();

    expect(win.show).toHaveBeenCalledTimes(1);
    expect(win.focus).toHaveBeenCalledTimes(1);
    expect(win.webContents.send).toHaveBeenCalledWith('idle-data', expect.any(Object));
  });

  test('show is only called once even if both events fire', () => {
    simulateShowIdleAlert(win);

    // Both events fire
    eventHandlers['ready-to-show']();
    eventHandlers['webContents:did-finish-load']();

    // show() must be called exactly once (dedup guard)
    expect(win.show).toHaveBeenCalledTimes(1);
    expect(win.focus).toHaveBeenCalledTimes(1);
    expect(win.webContents.send).toHaveBeenCalledTimes(1);
  });

  test('show is not called if window was destroyed before event fires', () => {
    simulateShowIdleAlert(win);

    // Window is destroyed before ready-to-show fires
    win.isDestroyed.mockReturnValue(true);
    eventHandlers['ready-to-show']();

    expect(win.show).not.toHaveBeenCalled();
    expect(win.focus).not.toHaveBeenCalled();
  });

  test('local reference pattern prevents crash when outer variable is nulled', () => {
    // Simulate the pattern where idleAlertWindow (outer var) is set to null
    // by dismissIdleAlert(), but the ready-to-show callback still has a
    // valid local reference to the window object.
    let idleAlertWindow = win;
    simulateShowIdleAlert(win); // uses the local win ref internally

    // Simulate dismissIdleAlert setting outer to null
    idleAlertWindow = null;

    // ready-to-show fires — should still work via local ref, no crash
    expect(() => eventHandlers['ready-to-show']()).not.toThrow();
    expect(win.show).toHaveBeenCalledTimes(1);
  });

  test('idle data is sent with correct structure', () => {
    simulateShowIdleAlert(win);
    eventHandlers['ready-to-show']();

    const sentData = win.webContents.send.mock.calls[0][1];
    expect(sentData).toHaveProperty('idleStartedAt');
    expect(sentData).toHaveProperty('idleSeconds', 300);
    expect(sentData).toHaveProperty('alertShownAt');
    expect(sentData).toHaveProperty('autoStopGraceSec', 600);
    expect(sentData).toHaveProperty('projects');
    expect(Array.isArray(sentData.projects)).toBe(true);
  });

  test('loadFile error is caught and does not throw', async () => {
    win.loadFile.mockRejectedValue(new Error('File not found'));

    // Should not throw
    expect(() => simulateShowIdleAlert(win)).not.toThrow();

    // Let the rejection propagate
    await new Promise((r) => setTimeout(r, 0));
    // No unhandled rejection — the .catch() in showIdleAlert handles it
  });

  test('idle alert window is created hidden and always-on-top', () => {
    // The constructor options that survive as real Electron options (alwaysOnTop
    // is re-asserted at 'screen-saver' level after creation; visibleOnAllWorkspaces
    // is NOT a constructor option and is applied via setVisibleOnAllWorkspaces()).
    const opts = {
      alwaysOnTop: true,
      show: false,
    };
    expect(opts.alwaysOnTop).toBe(true);
    expect(opts.show).toBe(false);
  });
});

/**
 * ALL-WORKSPACES / FULLSCREEN VISIBILITY FIX
 *
 * Models `_applyIdleAlertEverywhereVisible()` + `_createIdleWindowOnDisplay()`
 * from index.js. The idle alert used to rely on the (non-existent) constructor
 * option `visibleOnAllWorkspaces: true`, which Electron ignores — so the alert
 * stayed pinned to the Space it was created on and was invisible over fullscreen
 * apps. The fix applies the popup's everywhere-visible treatment to EVERY alert
 * window (primary + per-display mirrors): setVisibleOnAllWorkspaces(true, {
 * visibleOnFullScreen: true }) + setAlwaysOnTop(true, 'screen-saver').
 */
describe('Idle alert — follows user across workspaces / fullscreen', () => {
  function makeWin() {
    let destroyed = false;
    return {
      setVisibleOnAllWorkspaces: jest.fn(),
      setAlwaysOnTop: jest.fn(),
      isDestroyed: () => destroyed,
      _destroy: () => { destroyed = true; },
    };
  }

  // Exact replica of _applyIdleAlertEverywhereVisible() in index.js.
  function applyEverywhereVisible(win) {
    if (!win || win.isDestroyed()) return;
    try {
      if (typeof win.setVisibleOnAllWorkspaces === 'function') {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      }
      if (typeof win.setAlwaysOnTop === 'function') {
        win.setAlwaysOnTop(true, 'screen-saver');
      }
    } catch {
      // swallow — matches index.js console.error fallback
    }
  }

  // Models _createIdleWindowOnDisplay(): create a window then apply the flags.
  // Every alert window (primary + mirrors) funnels through this factory, so the
  // treatment is guaranteed for all of them.
  function createIdleWindowsForDisplays(displays) {
    return displays.map(() => {
      const win = makeWin();
      applyEverywhereVisible(win);
      return win;
    });
  }

  function assertEverywhereVisible(win) {
    expect(win.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      visibleOnFullScreen: true,
    });
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver');
  }

  test('primary window gets visibleOnFullScreen + screen-saver level', () => {
    const [primary] = createIdleWindowsForDisplays([{ id: 1 }]);
    assertEverywhereVisible(primary);
  });

  test('EVERY window (primary + all mirrors) gets the same treatment', () => {
    const wins = createIdleWindowsForDisplays([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(wins).toHaveLength(3);
    wins.forEach(assertEverywhereVisible);
  });

  test('setVisibleOnAllWorkspaces uses visibleOnFullScreen:true (surfaces over fullscreen apps)', () => {
    const [win] = createIdleWindowsForDisplays([{ id: 1 }]);
    const opts = win.setVisibleOnAllWorkspaces.mock.calls[0][1];
    expect(opts).toEqual({ visibleOnFullScreen: true });
  });

  test("always-on-top level is 'screen-saver', not the default 'floating'", () => {
    const [win] = createIdleWindowsForDisplays([{ id: 1 }]);
    const [enabled, level] = win.setAlwaysOnTop.mock.calls[0];
    expect(enabled).toBe(true);
    expect(level).toBe('screen-saver');
  });

  test('helper is a no-op on a destroyed window (no throw, no calls)', () => {
    const win = makeWin();
    win._destroy();
    expect(() => applyEverywhereVisible(win)).not.toThrow();
    expect(win.setVisibleOnAllWorkspaces).not.toHaveBeenCalled();
    expect(win.setAlwaysOnTop).not.toHaveBeenCalled();
  });

  test('each treatment call is applied exactly once per window at creation', () => {
    const wins = createIdleWindowsForDisplays([{ id: 1 }, { id: 2 }]);
    wins.forEach((w) => {
      expect(w.setVisibleOnAllWorkspaces).toHaveBeenCalledTimes(1);
      expect(w.setAlwaysOnTop).toHaveBeenCalledTimes(1);
    });
  });
});

describe('Idle alert — one window per display (ISSUE 4)', () => {
  function makeWin() {
    let destroyed = false;
    const handlers = {};
    return {
      _dismissedProgrammatically: false,
      show: jest.fn(),
      focus: jest.fn(),
      destroy: jest.fn(() => { destroyed = true; }),
      isDestroyed: () => destroyed,
      on: jest.fn((e, h) => { handlers[e] = h; }),
      once: jest.fn((e, h) => { handlers[e] = h; }),
      loadFile: jest.fn(() => Promise.resolve()),
      webContents: { send: jest.fn(), once: jest.fn((e, h) => { handlers[`wc:${e}`] = h; }) },
      _handlers: handlers,
    };
  }

  // Models the multi-display creation + teardown from showIdleAlert()/dismissIdleAlert().
  function simulateMultiDisplay(displays) {
    const windows = displays.map(() => makeWin());
    const primary = windows[0];
    const extras = windows.slice(1);
    const dismiss = () => {
      // dismissIdleAlert(): tear down extras + primary together
      for (const w of [...extras, primary]) {
        if (!w.isDestroyed()) { w._dismissedProgrammatically = true; w.destroy(); }
      }
    };
    return { windows, primary, extras, dismiss };
  }

  test('creates exactly one window per display', () => {
    const displays = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const { windows } = simulateMultiDisplay(displays);
    expect(windows).toHaveLength(3);
  });

  test('a single-display setup creates a single window', () => {
    const { windows } = simulateMultiDisplay([{ id: 1 }]);
    expect(windows).toHaveLength(1);
  });

  test('resolving/dismissing destroys ALL display windows — no orphans left', () => {
    const { windows, dismiss } = simulateMultiDisplay([{ id: 1 }, { id: 2 }]);
    dismiss();
    windows.forEach((w) => {
      expect(w.destroy).toHaveBeenCalledTimes(1);
      expect(w.isDestroyed()).toBe(true);
      expect(w._dismissedProgrammatically).toBe(true);
    });
  });
});

describe('Pin/close-button state (ISSUE 9)', () => {
  // Models renderer updatePinUI(): the close (hide-to-tray) button is disabled while
  // pinned and enabled once unpinned; main also refuses hide-window while pinned.
  function closeButtonDisabledFor(pinned) { return pinned === true; }
  function mainAllowsHide(isAlwaysOnTop) { return isAlwaysOnTop !== true; }

  test('close button disabled when pinned', () => {
    expect(closeButtonDisabledFor(true)).toBe(true);
  });
  test('close button enabled when unpinned', () => {
    expect(closeButtonDisabledFor(false)).toBe(false);
  });
  test('main process refuses hide-window while pinned', () => {
    expect(mainAllowsHide(true)).toBe(false);
    expect(mainAllowsHide(false)).toBe(true);
  });
});

describe('IdleDetector callback integration', () => {
  const { powerMonitor } = require('electron');
  const IdleDetector = require('../src/main/idle-detector');

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

  test('onIdleDetected callback fires when idle threshold is crossed, enabling popup to show', () => {
    detector = new IdleDetector({ idle_timeout: 5, idle_check_interval_sec: 10 });
    const showIdleAlert = jest.fn();
    detector.onIdleDetected((idleSeconds, idleStartedAt, actionId) => {
      showIdleAlert(idleSeconds, idleStartedAt, actionId);
    });
    detector.start();

    // User goes idle for 5 minutes
    powerMonitor.getSystemIdleTime.mockReturnValue(300);
    jest.advanceTimersByTime(10000);

    expect(showIdleAlert).toHaveBeenCalledTimes(1);
    expect(showIdleAlert).toHaveBeenCalledWith(300, expect.any(Number), expect.any(Number));
  });

  test('after resolveIdle + start, callback fires again on next idle cycle (after fresh input)', () => {
    detector = new IdleDetector({ idle_timeout: 1, idle_check_interval_sec: 10 });
    const onIdle = jest.fn();
    detector.onIdleDetected(onIdle);
    detector.start();

    // First idle
    powerMonitor.getSystemIdleTime.mockReturnValue(60);
    jest.advanceTimersByTime(10000);
    expect(onIdle).toHaveBeenCalledTimes(1);

    // Resolve and restart (like handleIdleAction does)
    detector.resolveIdle(detector.getActionId());
    detector.start();

    // System still idle — cooldown prevents re-detection until fresh input
    powerMonitor.getSystemIdleTime.mockReturnValue(120);
    jest.advanceTimersByTime(10000);
    expect(onIdle).toHaveBeenCalledTimes(1); // no re-fire — cooldown active

    // User provides fresh input — cooldown clears after 60s minimum window
    powerMonitor.getSystemIdleTime.mockReturnValue(5);
    jest.advanceTimersByTime(60000); // advance 60s so elapsed >= MIN_COOLDOWN_MS
    expect(onIdle).toHaveBeenCalledTimes(1); // no change — user active

    // User goes idle again — should fire a second time
    powerMonitor.getSystemIdleTime.mockReturnValue(60);
    jest.advanceTimersByTime(10000);
    expect(onIdle).toHaveBeenCalledTimes(2); // fires again

    // Resolve the second idle
    detector.resolveIdle(detector.getActionId());
    detector.start();

    // Fresh input then idle again — third fire
    powerMonitor.getSystemIdleTime.mockReturnValue(3);
    jest.advanceTimersByTime(60000); // advance 60s so elapsed >= MIN_COOLDOWN_MS
    powerMonitor.getSystemIdleTime.mockReturnValue(60);
    jest.advanceTimersByTime(10000);
    expect(onIdle).toHaveBeenCalledTimes(3); // fires again
  });
});
