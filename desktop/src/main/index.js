const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, Notification } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const ApiClient = require('./api-client');
const ActivityMonitor = require('./activity-monitor');
const ScreenshotService = require('./screenshot-service');
const IdleDetector = require('./idle-detector');
const OfflineQueue = require('./offline-queue');
const { getToken, setToken, getRefreshToken, setRefreshToken, deleteToken } = require('./keychain');

const WEB_DASHBOARD_URL = process.env.TRACKFLOW_WEB_URL || 'https://trackflow.codeupscale.com';

let tray = null;
let popupWindow = null;
let idleAlertWindow = null;
let apiClient = null;
let activityMonitor = null;
let screenshotService = null;
let idleDetector = null;
let offlineQueue = null;
let isTimerRunning = false;
let currentEntry = null;
let config = {};
let loginHandlerRegistered = false;
let cachedProjects = [];
let isAuthenticated = false;
let timerSyncInterval = null;

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
    isAuthenticated = false;
    createTray();
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
    isAuthenticated = false;
    createTray();
    createLoginWindow();
    return;
  }

  isAuthenticated = true;

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
  idleDetector = new IdleDetector(config);

  // Wire idle detection events
  idleDetector.onIdleDetected((idleSeconds, idleStartedAt) => {
    showIdleAlert(idleSeconds, idleStartedAt);
  });

  idleDetector.onAutoStop((totalIdleSeconds) => {
    // Auto-stop after extended idle (user never responded to alert)
    handleIdleAction('stop', totalIdleSeconds);
    dismissIdleAlert();

    // Show notification so user knows timer was auto-stopped
    try {
      if (Notification.isSupported()) {
        const n = new Notification({
          title: 'TrackFlow — Timer Stopped',
          body: `Timer was automatically stopped after ${Math.floor(totalIdleSeconds / 60)} minutes of inactivity.`,
          silent: false,
        });
        n.show();
      }
    } catch {}
  });

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
      idleDetector.start();
      updateTrayIcon(true);
    }
  } catch {}

  // Start periodic sync between desktop and server
  startTimerSync();
}

function createTray() {
  if (tray) {
    // Tray already exists — just update the menu
    updateTrayMenu();
    return;
  }

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

  // macOS: left-click opens popup window, right-click opens context menu (like Hubstaff)
  // Windows/Linux: click opens popup, right-click opens context menu
  tray.on('click', () => {
    if (isAuthenticated) {
      showPopup();
    } else {
      createLoginWindow();
    }
  });

  tray.on('right-click', () => {
    const contextMenu = buildTrayContextMenu();
    tray.popUpContextMenu(contextMenu);
  });

  // Don't set context menu directly — this prevents it from auto-opening on left-click on macOS
  // tray.setContextMenu() is intentionally NOT called
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

function buildTrayContextMenu() {
  if (!isAuthenticated) {
    return Menu.buildFromTemplate([
      { label: 'Open TrackFlow', click: () => createLoginWindow() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]);
  }

  // Build project submenu items
  const projectItems = cachedProjects.map((p) => ({
    label: p.name,
    enabled: !isTimerRunning,
    click: () => startTimer(p.id),
  }));

  const template = [
    { label: 'Open Dashboard', click: () => openDashboardInBrowser() },
    { label: 'Open TrackFlow', click: () => showPopup() },
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

  return Menu.buildFromTemplate(template);
}

function updateTrayMenu() {
  // No-op — context menu is built on-demand via right-click
  // This function exists so callers don't need to change
  // Tooltip is updated via updateTrayIcon()
}

function showPopup() {
  if (!isAuthenticated) {
    createLoginWindow();
    return;
  }

  if (popupWindow && !popupWindow.isDestroyed()) {
    // Re-sync timer state when popup becomes visible again
    popupWindow.webContents.send('sync-timer');
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

  popupWindow.on('closed', () => {
    popupWindow = null;
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
    isAuthenticated = false;
    activityMonitor?.stop();
    screenshotService?.stop();
    idleDetector?.stop();
    dismissIdleAlert();

    // Clear timer sync interval
    if (timerSyncInterval) {
      clearInterval(timerSyncInterval);
      timerSyncInterval = null;
    }

    await deleteToken();
    apiClient = null;

    // Destroy popup window completely so it doesn't show stale logged-in UI
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.destroy();
    }
    popupWindow = null;

    // Show dock on macOS so login window appears properly
    if (process.platform === 'darwin') {
      app.dock.show();
    }

    createLoginWindow();
  });

  ipcMain.handle('open-dashboard', async () => {
    await openDashboardInBrowser();
  });

  // Idle alert actions
  ipcMain.removeHandler('resolve-idle');
  ipcMain.handle('resolve-idle', async (_, action) => {
    await handleIdleAction(action);
    dismissIdleAlert();
    return { success: true };
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
    idleDetector?.start();

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
        idleDetector?.start();
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
  const wasRunning = isTimerRunning;

  // Dismiss idle alert if open
  dismissIdleAlert();

  try {
    const result = await apiClient.stopTimer();
    isTimerRunning = false;
    currentEntry = null;

    activityMonitor?.stop();
    screenshotService?.stop();
    idleDetector?.stop();

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
      idleDetector?.stop();
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
    idleDetector?.stop();
    updateTrayIcon(false);
    updateTrayMenu();
    notifyPopup('timer-stopped', null);
    return { error: e.response?.data?.message || e.message };
  }
}

// Periodically sync timer state with server to stay in sync with web dashboard
function startTimerSync() {
  // Clear any existing sync interval
  if (timerSyncInterval) {
    clearInterval(timerSyncInterval);
  }
  // Sync every 30 seconds
  timerSyncInterval = setInterval(async () => {
    if (!apiClient) return;
    try {
      const status = await apiClient.getTimerStatus();
      if (status.running && !isTimerRunning) {
        // Server has running timer but we don't — sync up
        isTimerRunning = true;
        currentEntry = status.entry;
        activityMonitor?.start();
        screenshotService?.start(currentEntry.id);
        idleDetector?.start();
        updateTrayIcon(true);
        updateTrayMenu();
        notifyPopup('timer-started', currentEntry);
      } else if (!status.running && isTimerRunning) {
        // Server has no running timer but we think one is running — sync down
        isTimerRunning = false;
        currentEntry = null;
        activityMonitor?.stop();
        screenshotService?.stop();
        idleDetector?.stop();
        dismissIdleAlert();
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

// ── Idle Alert System (Hubstaff-style) ───────────────────────────────────────

function showIdleAlert(idleSeconds, idleStartedAt) {
  // Don't show if alert is already visible or timer isn't running
  if (idleAlertWindow && !idleAlertWindow.isDestroyed()) return;
  if (!isTimerRunning) return;

  // Pause screenshot service while idle (no point capturing idle screen)
  screenshotService?.stop();

  idleAlertWindow = new BrowserWindow({
    width: 380,
    height: 420,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    center: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  idleAlertWindow.loadFile(path.join(__dirname, '..', 'renderer', 'idle-alert.html'));

  idleAlertWindow.once('ready-to-show', () => {
    idleAlertWindow.show();
    idleAlertWindow.focus();
    // Send idle start time to renderer so it can show accurate idle duration
    idleAlertWindow.webContents.send('idle-data', { idleStartedAt, idleSeconds });
  });

  idleAlertWindow.on('closed', () => {
    idleAlertWindow = null;
  });

  // On macOS show dock briefly so the alert window is visible
  if (process.platform === 'darwin') {
    app.dock.show();
  }
}

function dismissIdleAlert() {
  if (idleAlertWindow && !idleAlertWindow.isDestroyed()) {
    idleAlertWindow.destroy();
  }
  idleAlertWindow = null;

  // Re-hide dock on macOS
  if (process.platform === 'darwin' && isAuthenticated) {
    app.dock.hide();
  }
}

async function handleIdleAction(action, idleDurationOverride = null) {
  const idleDuration = idleDurationOverride || idleDetector?.getIdleDuration() || 0;
  const idleStartedAt = idleDetector?.idleStartedAt || null;

  // Resolve the idle state in the detector
  idleDetector?.resolveIdle();

  switch (action) {
    case 'keep':
      // Keep all time including idle — just resume tracking normally
      // Restart screenshot service
      if (isTimerRunning && currentEntry) {
        screenshotService?.start(currentEntry.id);
      }
      break;

    case 'discard':
      // Discard idle time — notify server to adjust the time entry
      // The timer continues but idle period is removed
      if (apiClient && currentEntry && idleStartedAt) {
        try {
          await apiClient.reportIdleTime({
            time_entry_id: currentEntry.id,
            idle_started_at: new Date(idleStartedAt).toISOString(),
            idle_ended_at: new Date().toISOString(),
            idle_seconds: idleDuration,
            action: 'discard',
          });
        } catch (e) {
          console.error('Failed to report idle time:', e.message);
        }
      }
      // Restart screenshot service
      if (isTimerRunning && currentEntry) {
        screenshotService?.start(currentEntry.id);
      }
      break;

    case 'stop':
      // Stop the timer entirely
      await stopTimer();
      break;
  }
}

// ── Login Window ─────────────────────────────────────────────────────────────

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
