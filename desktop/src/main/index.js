const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const ApiClient = require('./api-client');
const ActivityMonitor = require('./activity-monitor');
const ScreenshotService = require('./screenshot-service');
const OfflineQueue = require('./offline-queue');
const { getToken, setToken, deleteToken } = require('./keychain');

let tray = null;
let popupWindow = null;
let apiClient = null;
let activityMonitor = null;
let screenshotService = null;
let offlineQueue = null;
let isTimerRunning = false;
let currentEntry = null;
let config = {};

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

app.on('ready', async () => {
  // Hide dock icon on macOS
  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  await initializeApp();
});

app.on('window-all-closed', (e) => {
  e.preventDefault(); // Keep running in tray
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

  createTray();
  setupIPC();
  checkForUpdates();

  // Flush offline queue
  offlineQueue.flush(apiClient);

  // Check timer status
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
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'tray-icon.png');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon.isEmpty() ? nativeImage.createFromBuffer(Buffer.alloc(1)) : icon);
  tray.setToolTip('TrackFlow');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open TrackFlow', click: () => showPopup() },
    { type: 'separator' },
    { label: 'Start Timer', click: () => startTimer() },
    { label: 'Stop Timer', click: () => stopTimer() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.quit(); } },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => showPopup());
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
    await stopTimer();
    activityMonitor?.stop();
    screenshotService?.stop();
    await deleteToken();
    apiClient = null;
    if (popupWindow && !popupWindow.isDestroyed()) popupWindow.close();
    createLoginWindow();
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
    notifyPopup('timer-started', currentEntry);
    return { success: true, entry: currentEntry };
  } catch (e) {
    return { error: e.message };
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
    notifyPopup('timer-stopped', result.entry);
    return { success: true, entry: result.entry };
  } catch (e) {
    return { error: e.message };
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

  ipcMain.handleOnce('login', async (_, email, password) => {
    try {
      const tempClient = new ApiClient(null);
      const result = await tempClient.login(email, password);
      await setToken(result.access_token);

      loginWindow.close();
      await initializeApp();
      return { success: true };
    } catch (e) {
      return { error: e.response?.data?.message || e.message };
    }
  });
}

function checkForUpdates() {
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
}

// Auto-start on login (AGENT-07)
app.setLoginItemSettings({ openAtLogin: true });
