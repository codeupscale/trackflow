const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const ApiClient = require('./api-client');
const ActivityMonitor = require('./activity-monitor');
const ScreenshotService = require('./screenshot-service');
const OfflineQueue = require('./offline-queue');
const { getToken, setToken, getRefreshToken, setRefreshToken, deleteToken } = require('./keychain');

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
let cachedProjects = [];

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
  // Load saved tokens
  const token = await getToken();
  if (!token) {
    createLoginWindow();
    return;
  }

  const refreshToken = await getRefreshToken();
  apiClient = new ApiClient(token, refreshToken);

  // Auto-persist refreshed tokens to keychain
  apiClient.onTokenRefreshed(async (newAccessToken, newRefreshToken) => {
    await setToken(newAccessToken);
    await setRefreshToken(newRefreshToken);
  });

  // Test token validity (auto-refresh will kick in on 401 if refresh token is available)
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

  // Load projects for tray menu
  loadProjects();

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
      updateTrayIcon(true);
    }
  } catch {}

  // Start periodic sync between desktop and server
  startTimerSync();
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

async function loadProjects() {
  if (!apiClient) return;
  try {
    const projects = await apiClient.getProjects();
    cachedProjects = Array.isArray(projects) ? projects : [];
    updateTrayMenu();
  } catch {
    cachedProjects = [];
  }
}

async function openDashboardInBrowser() {
  // Open web dashboard with auto-login — pass token so user doesn't have to log in again
  const token = await getToken();
  const refresh = await getRefreshToken();
  if (token) {
    const params = new URLSearchParams({ token });
    if (refresh) params.append('refresh', refresh);
    shell.openExternal(`${WEB_DASHBOARD_URL}/auth/auto-login?${params.toString()}`);
  } else {
    shell.openExternal(WEB_DASHBOARD_URL);
  }
}

function updateTrayMenu() {
  if (!tray) return;

  // Build project submenu items
  const projectItems = cachedProjects.map((p) => ({
    label: p.name,
    enabled: !isTimerRunning,
    click: () => startTimer(p.id),
  }));

  const template = [
    { label: 'Open Dashboard', click: () => openDashboardInBrowser() },
    { type: 'separator' },
  ];

  // Add projects submenu if there are projects
  if (projectItems.length > 0) {
    template.push({
      label: 'Start Timer',
      enabled: !isTimerRunning,
      submenu: [
        { label: 'No Project', click: () => startTimer() },
        { type: 'separator' },
        ...projectItems,
      ],
    });
  } else {
    template.push({
      label: 'Start Timer',
      enabled: !isTimerRunning,
      click: () => startTimer(),
    });
  }

  template.push(
    {
      label: 'Stop Timer',
      enabled: isTimerRunning,
      click: () => stopTimer(),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit(),
    }
  );

  const contextMenu = Menu.buildFromTemplate(template);
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

  ipcMain.handle('get-timer-state', async () => {
    // Sync with server to get latest state (handles start/stop from web dashboard)
    if (apiClient) {
      try {
        const status = await apiClient.getTimerStatus();
        if (status.running && !isTimerRunning) {
          isTimerRunning = true;
          currentEntry = status.entry;
          activityMonitor?.start();
          screenshotService?.start(currentEntry.id);
          updateTrayIcon(true);
          updateTrayMenu();
        } else if (!status.running && isTimerRunning) {
          isTimerRunning = false;
          currentEntry = null;
          activityMonitor?.stop();
          screenshotService?.stop();
          updateTrayIcon(false);
          updateTrayMenu();
        }
      } catch {}
    }
    return {
      isRunning: isTimerRunning,
      entry: currentEntry,
      elapsed: currentEntry
        ? Math.floor((Date.now() - new Date(currentEntry.started_at).getTime()) / 1000)
        : 0,
    };
  });

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

  ipcMain.handle('open-dashboard', async () => {
    await openDashboardInBrowser();
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
    const status = e.response?.status;

    // 409 = timer already running on server — sync local state with server
    if (status === 409) {
      try {
        // First stop the stale timer on server, then start fresh
        await apiClient.stopTimer();
      } catch {}

      // Now try starting again
      try {
        const retryResult = await apiClient.startTimer(projectId);
        currentEntry = retryResult.entry;
        isTimerRunning = true;
        activityMonitor.start();
        screenshotService.start(currentEntry.id);
        updateTrayIcon(true);
        updateTrayMenu();
        notifyPopup('timer-started', currentEntry);
        return { success: true, entry: currentEntry };
      } catch (retryErr) {
        return { error: retryErr.response?.data?.message || retryErr.message };
      }
    }

    return { error: e.response?.data?.message || e.message };
  }
}

async function stopTimer() {
  // Always attempt to stop, even if local state says not running
  // This handles cases where server has a running timer but local state is out of sync
  const wasRunning = isTimerRunning;

  try {
    const result = await apiClient.stopTimer();
    isTimerRunning = false;
    currentEntry = null;

    activityMonitor?.stop();
    screenshotService?.stop();

    updateTrayIcon(false);
    updateTrayMenu();
    notifyPopup('timer-stopped', result.entry);
    return { success: true, entry: result.entry };
  } catch (e) {
    const status = e.response?.status;

    // 404 = timer already stopped on server — just reset local state
    if (status === 404) {
      isTimerRunning = false;
      currentEntry = null;
      activityMonitor?.stop();
      screenshotService?.stop();
      updateTrayIcon(false);
      updateTrayMenu();
      notifyPopup('timer-stopped', null);
      return { success: true, entry: null };
    }

    // For other errors, still stop local services
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

// Periodically sync timer state with server to stay in sync with web dashboard
function startTimerSync() {
  // Sync every 30 seconds
  setInterval(async () => {
    if (!apiClient) return;
    try {
      const status = await apiClient.getTimerStatus();
      if (status.running && !isTimerRunning) {
        // Server has running timer but we don't — sync up
        isTimerRunning = true;
        currentEntry = status.entry;
        activityMonitor?.start();
        screenshotService?.start(currentEntry.id);
        updateTrayIcon(true);
        updateTrayMenu();
        notifyPopup('timer-started', currentEntry);
      } else if (!status.running && isTimerRunning) {
        // Server has no running timer but we think one is running — sync down
        isTimerRunning = false;
        currentEntry = null;
        activityMonitor?.stop();
        screenshotService?.stop();
        updateTrayIcon(false);
        updateTrayMenu();
        notifyPopup('timer-stopped', null);
      }
    } catch {}
  }, 30000);
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
        await setRefreshToken(result.refresh_token);

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
