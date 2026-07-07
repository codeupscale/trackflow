// Bug A — idle alert reliability on multi-screen / multiple virtual desktops.
//
// Covers the three surfacing fixes in showIdleAlert()/_createIdleWindowOnDisplay()/
// _revealIdleAlertWindow() in desktop/src/main/index.js, plus the unique-id toast
// path in system-notifications.js:
//   A1  unique-id system Notification (defeats Windows Action Center dedup)
//   A2  macOS: fullScreenable:false + re-assert setVisibleOnAllWorkspaces after show()
//   A3  Windows: flashFrame(true) + moveTop() after show() (defeat foreground-lock)
//   A4  show-race guard: an existing-but-never-shown window is force-revealed
//
// index.js requires the Electron runtime and is excluded from unit loading, so the
// window-creation/reveal logic is modelled by exact replicas of the source (the
// established pattern in idle-alert-window.test.js). The notification test exercises
// the REAL system-notifications.js helper.

describe('Bug A1 — idle notification uses a unique toast id (Windows dedup fix)', () => {
  const { Notification } = require('electron');
  const { showSystemNotification } = require('../src/main/system-notifications');
  let prevResourcesPath;

  beforeAll(() => {
    // system-notifications' icon resolver joins process.resourcesPath — undefined
    // outside the Electron runtime, which throws inside path.join. Point it at the
    // test tmp dir so the resolver falls through to "no icon" instead of throwing.
    prevResourcesPath = process.resourcesPath;
    process.resourcesPath = '/tmp/trackflow-test';
  });

  afterAll(() => {
    process.resourcesPath = prevResourcesPath;
  });

  beforeEach(() => {
    Notification.mockClear();
  });

  test('forwards a caller-supplied unique id to the OS Notification', () => {
    showSystemNotification({
      title: 'TrackFlow — You appear to be idle',
      body: "You've been idle for 5 minutes",
      silent: false,
      id: 'trackflow-idle-7',
    });

    expect(Notification).toHaveBeenCalledTimes(1);
    const opts = Notification.mock.calls[0][0];
    expect(opts.id).toBe('trackflow-idle-7');
    expect(opts.silent).toBe(false);
  });

  test('back-to-back idle alerts get DISTINCT ids (so Windows does not dedup/suppress)', () => {
    // Each idle cycle carries a monotonic actionId → id `trackflow-idle-<actionId>`.
    showSystemNotification({ title: 't', body: 'b', id: 'trackflow-idle-1' });
    showSystemNotification({ title: 't', body: 'b', id: 'trackflow-idle-2' });

    expect(Notification).toHaveBeenCalledTimes(2);
    const id1 = Notification.mock.calls[0][0].id;
    const id2 = Notification.mock.calls[1][0].id;
    expect(id1).not.toBe(id2);
  });

  test('auto-generates a unique id when none supplied', () => {
    showSystemNotification({ title: 't', body: 'b' });
    const opts = Notification.mock.calls[0][0];
    expect(typeof opts.id).toBe('string');
    expect(opts.id).toMatch(/^trackflow-/);
  });
});

describe('Bug A2/A3 — _revealIdleAlertWindow platform behavior', () => {
  // Exact replica of _revealIdleAlertWindow() in index.js. Kept in lockstep with
  // the source; asserts the per-platform surfacing calls.
  function revealIdleAlertWindow(win, platform) {
    if (!win || win.isDestroyed()) return;
    try {
      win.show();
      win._shown = true;
      if (platform === 'darwin') {
        if (typeof win.setVisibleOnAllWorkspaces === 'function') {
          win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        }
      }
      if (platform === 'win32' && typeof win.flashFrame === 'function') {
        win.flashFrame(true);
      }
      if (typeof win.moveTop === 'function') win.moveTop();
      win.focus();
    } catch {
      // matches index.js console.error fallback
    }
  }

  function makeWin() {
    let destroyed = false;
    return {
      _shown: false,
      show: jest.fn(),
      hide: jest.fn(),
      focus: jest.fn(),
      moveTop: jest.fn(),
      flashFrame: jest.fn(),
      setVisibleOnAllWorkspaces: jest.fn(),
      isDestroyed: () => destroyed,
      _destroy: () => { destroyed = true; },
    };
  }

  test('macOS: shows, re-asserts all-workspaces AFTER show, no flashFrame', () => {
    const win = makeWin();
    revealIdleAlertWindow(win, 'darwin');
    expect(win.show).toHaveBeenCalledTimes(1);
    expect(win.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      visibleOnFullScreen: true,
    });
    expect(win.flashFrame).not.toHaveBeenCalled();
    expect(win.moveTop).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
    expect(win._shown).toBe(true);
  });

  test('Windows: shows, flashFrame(true) + moveTop to defeat foreground-lock, no workspace re-assert', () => {
    const win = makeWin();
    revealIdleAlertWindow(win, 'win32');
    expect(win.show).toHaveBeenCalledTimes(1);
    expect(win.flashFrame).toHaveBeenCalledWith(true);
    expect(win.moveTop).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
    expect(win.setVisibleOnAllWorkspaces).not.toHaveBeenCalled();
  });

  test('Linux: shows + moveTop + focus, no darwin/win32-only calls (placement advisory)', () => {
    const win = makeWin();
    revealIdleAlertWindow(win, 'linux');
    expect(win.show).toHaveBeenCalledTimes(1);
    expect(win.flashFrame).not.toHaveBeenCalled();
    expect(win.setVisibleOnAllWorkspaces).not.toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
  });

  test('no-op (no throw, no calls) on a destroyed window', () => {
    const win = makeWin();
    win._destroy();
    expect(() => revealIdleAlertWindow(win, 'win32')).not.toThrow();
    expect(win.show).not.toHaveBeenCalled();
  });
});

describe('Bug A2 — _createIdleWindowOnDisplay opts set fullScreenable:false only on darwin', () => {
  // Replica of the platform guard added to _createIdleWindowOnDisplay() opts.
  function buildIdleOpts(platform) {
    const opts = {
      width: 380,
      height: 520,
      frame: false,
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    };
    if (platform === 'darwin') {
      opts.fullScreenable = false;
    }
    return opts;
  }

  test('darwin: fullScreenable:false (lets the alert float over a fullscreen Space)', () => {
    expect(buildIdleOpts('darwin').fullScreenable).toBe(false);
  });

  test('win32: fullScreenable option not set (macOS-only fix)', () => {
    expect(buildIdleOpts('win32')).not.toHaveProperty('fullScreenable');
  });

  test('linux: fullScreenable option not set', () => {
    expect(buildIdleOpts('linux')).not.toHaveProperty('fullScreenable');
  });

  test('security hardening preserved on every platform', () => {
    for (const p of ['darwin', 'win32', 'linux']) {
      const wp = buildIdleOpts(p).webPreferences;
      expect(wp.contextIsolation).toBe(true);
      expect(wp.nodeIntegration).toBe(false);
      expect(wp.sandbox).toBe(true);
    }
  });
});

describe('Bug A4 — show-race guard force-reveals an existing-but-never-shown window', () => {
  // Replica of the early-return branch of showIdleAlert(): if a prior idle window
  // exists but never actually became visible (_shown false or !isVisible()), it is
  // force-revealed instead of only focused (which would leave it invisible).
  function makeWin({ shown, visible }) {
    return {
      _shown: shown,
      show: jest.fn(function () { this._shown = true; }),
      focus: jest.fn(),
      moveTop: jest.fn(),
      flashFrame: jest.fn(),
      setVisibleOnAllWorkspaces: jest.fn(),
      isDestroyed: () => false,
      isVisible: () => visible,
    };
  }

  function earlyReturnReveal(win, platform) {
    const notVisible = !win._shown || (typeof win.isVisible === 'function' && !win.isVisible());
    if (notVisible) {
      // _revealIdleAlertWindow
      win.show();
      win._shown = true;
      if (platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      if (platform === 'win32') win.flashFrame(true);
      win.moveTop();
      win.focus();
    } else {
      win.focus();
      win.moveTop();
    }
  }

  test('window that never became visible (shown=false) is force-shown', () => {
    const win = makeWin({ shown: false, visible: false });
    earlyReturnReveal(win, 'darwin');
    expect(win.show).toHaveBeenCalledTimes(1);
    expect(win._shown).toBe(true);
  });

  test('window flagged shown but reporting not-visible is force-shown', () => {
    const win = makeWin({ shown: true, visible: false });
    earlyReturnReveal(win, 'win32');
    expect(win.show).toHaveBeenCalledTimes(1);
    expect(win.flashFrame).toHaveBeenCalledWith(true);
  });

  test('already-visible window is only re-focused, not re-shown', () => {
    const win = makeWin({ shown: true, visible: true });
    earlyReturnReveal(win, 'darwin');
    expect(win.show).not.toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
  });
});
