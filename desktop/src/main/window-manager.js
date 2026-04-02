// Window Manager — all BrowserWindow creation + show/hide logic (H2 refactor)
// Operates on AppState singleton for shared state.

const { BrowserWindow, screen } = require('electron');
const path = require('path');
const AppState = require('./app-state');

/**
 * Apply always-on-top state to a BrowserWindow.
 * On macOS, uses 'floating' level (NSFloatingWindowLevel).
 * L4 FIX: uses event-driven re-assertion instead of 300ms polling.
 */
function applyAlwaysOnTop(win, pinned) {
  if (!win || win.isDestroyed()) return;

  // Clear any existing keepalive
  if (AppState._pinKeepalive) {
    clearInterval(AppState._pinKeepalive);
    AppState._pinKeepalive = null;
  }

  if (pinned) {
    win.setAlwaysOnTop(true, 'floating', 1);
    win.moveTop();
    console.log(`[Pin] setAlwaysOnTop(true,'floating',1) + moveTop(). isAlwaysOnTop()=${win.isAlwaysOnTop()}`);
  } else {
    win.setAlwaysOnTop(false);
    console.log(`[Pin] setAlwaysOnTop(false) called. isAlwaysOnTop()=${win.isAlwaysOnTop()}`);
  }
}

/**
 * Create the main popup (timer) window.
 */
function createPopupWindow(tray) {
  const trayBounds = tray.getBounds();
  const windowWidth = 320;
  const windowHeight = 400;

  let x = Math.round(trayBounds.x - windowWidth / 2 + trayBounds.width / 2);
  let y;

  try {
    const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
    const workArea = display.workArea;
    const trayCenter = trayBounds.y + trayBounds.height / 2;
    const screenCenter = workArea.y + workArea.height / 2;
    const trayIsAtTop = trayCenter < screenCenter;

    if (trayIsAtTop) {
      y = trayBounds.y + trayBounds.height + 4;
    } else {
      y = trayBounds.y - windowHeight - 4;
    }

    x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - windowWidth));
    y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - windowHeight));
  } catch {
    y = trayBounds.y + trayBounds.height + 4;
  }

  const win = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x,
    y,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: true,
    },
  });

  return win;
}

/**
 * Create the login window.
 */
function createLoginWindow() {
  const win = new BrowserWindow({
    width: 400,
    height: 500,
    frame: false,
    resizable: false,
    center: true,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: true,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'login.html'));
  return win;
}

/**
 * Create the idle alert window.
 */
function createIdleAlertWindow() {
  const win = new BrowserWindow({
    width: 380,
    height: 520,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    center: true,
    show: false,
    visibleOnAllWorkspaces: true,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: true,
    },
  });

  return win;
}

module.exports = {
  applyAlwaysOnTop,
  createPopupWindow,
  createLoginWindow,
  createIdleAlertWindow,
};
