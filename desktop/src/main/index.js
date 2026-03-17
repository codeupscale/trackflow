const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const ApiClient = require('./api-client');
const ActivityMonitor = require('./activity-monitor');
const ScreenshotService = require('./screenshot-service');
const OfflineQueue = require('./offline-queue');
const { getToken, setToken, deleteToken } = require('./keychain');

const WEB_DASHBOARD_URL = process.env.TRACKFLOW_WEB_URL || 'https://trackflow.codeupscale.com';

let tray = null;
let popupWindow = null;
let apiClient = null;
let activityMonitor = null;
let screenshotService = null;
let offlineQueue = null;
let isTimerRunning = false;
let currentEntry = null;
let config = {};
let loginHandlerRegistered = false;

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

app.on('second-instance', () => {
  showPopup();
});

app.on('ready', async () => {
  await initializeApp();
});

app.on('window-all-closed', () => {
  // Don't quit — keep running in system tray
});

// Stop timer gracefully before quitting
app.on('before-quit', async (e) => {
  if (isTimerRunning && apiClient) {
    e.preventDefault();
    try {
      await apiClient.stopTimer();
    } catch {}
    isTimerRunning = false;
    currentEntry = null;
    activityMonitor?.stop();
    screenshotService?.stop();
    app.exit(0);
  }
});

async function initializeApp() {
  // Load saved token
  const token = await getToken();
  if (!token) {
    createLoginWindow();
    return;
  }

  apiClient = new ApiClient(token);

  // Test token validity
  try {
    await apiClient.getMe();
  } catch {
    await deleteToken();
    createLoginWindow();
    return;
  }

  // Fetch org config
  try {
    config = await apiClient.getConfig();
  } catch (e) {
    config = { screenshot_interval: 5, idle_timeout: 5, blur_screenshots: false };
  }

  // Initialize services
  offlineQueue = new OfflineQueue();
  activityMonitor = new ActivityMonitor(apiClient, offlineQueue);
  screenshotService = new ScreenshotService(apiClient, config, offlineQueue);

  // Hide dock icon on macOS once authenticated (tray-only mode)
  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  createTray();
  setupIPC();
  checkForUpdates();

  // Flush offline queue
  offlineQueue.flush(apiClient);

  // Check timer status on server (sync state)
  try {
    const status = await apiClient.getTimerStatus();
    if (status.running) {
      isTimerRunning = true;
      currentEntry = status.entry;
      activityMonitor.start();
      screenshotService.start(currentEntry.id);
    }
  } catch {}
}

function createTray() {
  if (tray) return; // Don't create multiple trays

  const iconPath = path.join(__dirname, '..', '..', 'assets', 'tray-icon.png');
  let icon = nativeImage.createFromPath(iconPath);

  // Fallback: create a tiny 16x16 blue square if tray-icon.png missing
  if (icon.isEmpty()) {
    const size = 16;
    const buf = Buffer.alloc(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      buf[i * 4] = 59;    // R (blue: #3b82f6)
      buf[i * 4 + 1] = 130; // G
      buf[i * 4 + 2] = 246; // B
      buf[i * 4 + 3] = 255; // A
    }
    icon = nativeImage.createFromBuffer(buf, { width: size, height: size });
  }

  tray = new Tray(icon);
  tray.setToolTip('TrackFlow');
  updateTrayMenu();
  tray.on('click', () => showPopup());
}

function updateTrayMenu() {
  if (!tray) return;
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open TrackFlow', click: () => shell.openExternal(WEB_DASHBOARD_URL) },
    { type: 'separator' },
    {
      label: 'Start Timer',
      enabled: !isTimerRunning,
      click: () => startTimer(),
    },
    {
      label: 'Stop Timer',
      enabled: isTimerRunning,
      click: () => stopTimer(),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(contextMenu);
}

function showPopup() {
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.show();
    popupWindow.focus();
    return;
  }

  const trayBounds = tray.getBounds();
  const windowWidth = 320;
  const windowHeight = 400;

  popupWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: Math.round(trayBounds.x - windowWidth / 2 + trayBounds.width / 2),
    y: trayBounds.y + trayBounds.height + 4,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  popupWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  popupWindow.once('ready-to-show', () => {
    popupWindow.show();
  });

  popupWindow.on('blur', () => {
    popupWindow.hide();
  });
}

function setupIPC() {
  // Remove previous handlers to avoid duplicate registration
  ipcMain.removeHandler('get-timer-state');
  ipcMain.removeHandler('start-timer');
  ipcMain.removeHandler('stop-timer');
  ipcMain.removeHandler('get-projects');
  ipcMain.removeHandler('logout');
  ipcMain.removeHandler('open-dashboard');

  ipcMain.handle('get-timer-state', () => ({
    isRunning: isTimerRunning,
    entry: currentEntry,
    elapsed: currentEntry
      ? Math.floor((Date.now() - new Date(currentEntry.started_at).getTime()) / 1000)
      : 0,
  }));

  ipcMain.handle('start-timer', async (_, projectId) => {
    return await startTimer(projectId);
  });

  ipcMain.handle('stop-timer', async () => {
    return await stopTimer();
  });

  ipcMain.handle('get-projects', async () => {
    try {
      return await apiClient.getProjects();
    } catch {
      return [];
    }
  });

  ipcMain.handle('logout', async () => {
    // Force stop timer on server regardless of local state
    if (apiClient) {
      try {
        await apiClient.stopTimer();
      } catch {}
    }

    isTimerRunning = false;
    currentEntry = null;
    activityMonitor?.stop();
    screenshotService?.stop();
    await deleteToken();
    apiClient = null;
    updateTrayMenu();

    if (popupWindow && !popupWindow.isDestroyed()) popupWindow.close();
    popupWindow = null;
    createLoginWindow();
  });

  ipcMain.handle('open-dashboard', () => {
    shell.openExternal(WEB_DASHBOARD_URL);
  });
}

async function startTimer(projectId = null) {
  if (isTimerRunning) return { error: 'Timer already running' };

  try {
    const result = await apiClient.startTimer(projectId);
    currentEntry = result.entry;
    isTimerRunning = true;

    activityMonitor.start();
    screenshotService.start(currentEntry.id);

    updateTrayIcon(true);
    updateTrayMenu();
    notifyPopup('timer-started', currentEntry);
    return { success: true, entry: currentEntry };
  } catch (e) {
    return { error: e.response?.data?.message || e.message };
  }
}

async function stopTimer() {
  if (!isTimerRunning) return { error: 'Timer not running' };

  try {
    const result = await apiClient.stopTimer();
    isTimerRunning = false;
    currentEntry = null;

    activityMonitor.stop();
    screenshotService.stop();

    updateTrayIcon(false);
    updateTrayMenu();
    notifyPopup('timer-stopped', result.entry);
    return { success: true, entry: result.entry };
  } catch (e) {
    // Even if API fails, stop local services
    isTimerRunning = false;
    currentEntry = null;
    activityMonitor?.stop();
    screenshotService?.stop();
    updateTrayIcon(false);
    updateTrayMenu();
    notifyPopup('timer-stopped', null);
    return { error: e.response?.data?.message || e.message };
  }
}

function updateTrayIcon(running) {
  if (!tray) return;
  tray.setToolTip(running ? 'TrackFlow - Timer Running' : 'TrackFlow');
}

function notifyPopup(event, data) {
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.webContents.send(event, data);
  }
}

function createLoginWindow() {
  const loginWindow = new BrowserWindow({
    width: 400,
    height: 500,
    frame: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  loginWindow.loadFile(path.join(__dirname, '..', 'renderer', 'login.html'));

  // Only register the login handler once to avoid "already registered" errors
  if (!loginHandlerRegistered) {
    loginHandlerRegistered = true;
    ipcMain.handle('login', async (_, email, password) => {
      try {
        const tempClient = new ApiClient(null);
        const result = await tempClient.login(email, password);
        await setToken(result.access_token);

        // Close all existing windows
        BrowserWindow.getAllWindows().forEach((w) => w.close());
        await initializeApp();
        return { success: true };
      } catch (e) {
        return { error: e.response?.data?.message || e.message };
      }
    });
  }
}

function checkForUpdates() {
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    return; // Skip auto-updates in development
  }
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
}

// Auto-start on login (AGENT-07)
app.setLoginItemSettings({ openAtLogin: true });
