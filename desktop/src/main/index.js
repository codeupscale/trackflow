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
// Two totals for multi-project clarity (see desktop/docs/TIMER-TOTALS-DESIGN.md)
let todayTotalGlobal = 0;       // All projects today (tray when stopped)
let todayTotalCurrentProject = 0; // Current entry's project today, completed only (tray when running)
let config = {};
let loginHandlerRegistered = false;
let cachedProjects = [];
let isAuthenticated = false;
let timerSyncInterval = null;
let trayTimerInterval = null;

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

// Stop timer gracefully before quitting (with timeout to avoid hanging)
app.on('before-quit', async (e) => {
  if (isTimerRunning && apiClient) {
    e.preventDefault();
    try {
      await Promise.race([
        apiClient.stopTimer(),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
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
    config = { screenshot_interval: 5, idle_timeout: 5, idle_detection: true, keep_idle_time: 'prompt', blur_screenshots: false };
  }
  if (config.idle_timeout === undefined) config.idle_timeout = 5;
  if (config.keep_idle_time === undefined) config.keep_idle_time = 'prompt';

  // Initialize services
  offlineQueue = new OfflineQueue();
  activityMonitor = new ActivityMonitor(apiClient, offlineQueue);
  screenshotService = new ScreenshotService(apiClient, config, offlineQueue);
  idleDetector = new IdleDetector(config);

  // Wire idle detection events
  idleDetector.onIdleDetected((idleSeconds, idleStartedAt) => {
    const policy = config.keep_idle_time || 'prompt';
    if (policy === 'always') {
      idleDetector.resolveIdle();
      if (isTimerRunning && currentEntry) screenshotService?.start(currentEntry.id);
      return;
    }
    if (policy === 'never') {
      handleIdleAction('discard', idleSeconds, null);
      dismissIdleAlert();
      if (isTimerRunning && currentEntry) screenshotService?.start(currentEntry.id);
      return;
    }
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

  // Check timer status on server (sync state): global total + per-project when running
  try {
    const status = await apiClient.getTimerStatus();
    const globalTotal = status.today_total ?? 0;
    const elapsed = status.elapsed_seconds ?? 0;
    if (status.running) {
      todayTotalGlobal = Math.max(0, globalTotal - elapsed);
      isTimerRunning = true;
      currentEntry = status.entry;
      try {
        todayTotalCurrentProject = await apiClient.getTodayTotal(currentEntry?.project_id ?? null);
        if (currentEntry?.project_id) {
          todayTotalCurrentProject = Math.max(0, todayTotalCurrentProject - elapsed);
        }
      } catch {
        todayTotalCurrentProject = Math.max(0, globalTotal - elapsed);
      }
      activityMonitor.start();
      screenshotService.start(currentEntry.id);
      idleDetector.start();
      updateTrayIcon(true);
      startTrayTimer();
    } else {
      todayTotalGlobal = globalTotal;
      todayTotalCurrentProject = 0;
      updateTrayTitle();
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

  ipcMain.handle('get-timer-state', async (_, projectId) => {
    // Fetch fresh status (global) so running state and tray totals stay correct
    if (apiClient) {
      try {
        const status = await apiClient.getTimerStatus();
        const globalTotal = status.today_total ?? 0;
        const elapsed = status.elapsed_seconds ?? 0;
        if (status.running) {
          todayTotalGlobal = Math.max(0, globalTotal - elapsed);
          isTimerRunning = true;
          currentEntry = status.entry;
          try {
            const withElapsed = await apiClient.getTodayTotal(currentEntry?.project_id ?? null);
            todayTotalCurrentProject = Math.max(0, withElapsed - elapsed);
          } catch {
            todayTotalCurrentProject = todayTotalGlobal;
          }
        } else {
          todayTotalGlobal = globalTotal;
          todayTotalCurrentProject = 0;
          isTimerRunning = false;
          currentEntry = null;
        }
      } catch {}
    }
    // Popup display: per-project total (selected when stopped, current when running)
    const projectIdForTotal = isTimerRunning && currentEntry?.project_id
      ? currentEntry.project_id
      : projectId || null;
    let todayTotalForDisplay = 0;
    if (apiClient) {
      try {
        todayTotalForDisplay = await apiClient.getTodayTotal(projectIdForTotal);
      } catch {}
    }
    return {
      isRunning: isTimerRunning,
      entry: currentEntry,
      elapsed: currentEntry
        ? Math.floor((Date.now() - new Date(currentEntry.started_at).getTime()) / 1000)
        : 0,
      todayTotal: todayTotalForDisplay,
    };
  });

  ipcMain.handle('start-timer', async (_, projectId) => {
    return await startTimer(projectId);
  });

  ipcMain.handle('stop-timer', () => {
    return stopTimer();
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
  ipcMain.handle('resolve-idle', async (_, action, projectId = null) => {
    await handleIdleAction(action, null, projectId);
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
    todayTotalCurrentProject = result.today_total ?? 0;
    try {
      todayTotalGlobal = await apiClient.getTodayTotal(null);
    } catch {
      todayTotalGlobal = todayTotalCurrentProject;
    }

    activityMonitor.start();
    screenshotService.start(currentEntry.id);
    idleDetector?.start();
    startTrayTimer();

    updateTrayIcon(true);
    updateTrayMenu();
    const todayTotalForPopup = todayTotalCurrentProject;
    notifyPopup('timer-started', { ...currentEntry, todayTotal: todayTotalForPopup });
    return { success: true, entry: currentEntry, todayTotal: todayTotalForPopup };
  } catch (e) {
    const status = e.response?.status;

    // 409 = timer already running on server — sync local state with server
    if (status === 409) {
      try {
        await apiClient.stopTimer();
      } catch {}

      try {
        const retryResult = await apiClient.startTimer(projectId);
        currentEntry = retryResult.entry;
        isTimerRunning = true;
        todayTotalCurrentProject = retryResult.today_total ?? 0;
        try {
          todayTotalGlobal = await apiClient.getTodayTotal(null);
        } catch {}
        activityMonitor.start();
        screenshotService.start(currentEntry.id);
        idleDetector?.start();
        startTrayTimer();
        updateTrayIcon(true);
        updateTrayMenu();
        notifyPopup('timer-started', { ...currentEntry, todayTotal: todayTotalCurrentProject });
        return { success: true, entry: currentEntry, todayTotal: todayTotalCurrentProject };
      } catch (retryErr) {
        return { error: retryErr.response?.data?.message || retryErr.message };
      }
    }

    return { error: e.response?.data?.message || e.message };
  }
}

function stopTimer() {
  const sessionElapsed = currentEntry
    ? Math.max(0, Math.floor((Date.now() - new Date(currentEntry.started_at).getTime()) / 1000))
    : 0;
  const stoppedProjectId = currentEntry?.project_id || null;
  const localStoppedProjectTotal = todayTotalCurrentProject + sessionElapsed;

  dismissIdleAlert();

  isTimerRunning = false;
  currentEntry = null;
  todayTotalCurrentProject = 0;

  activityMonitor?.stop();
  screenshotService?.stop();
  idleDetector?.stop();
  stopTrayTimer();
  updateTrayIcon(false);

  notifyPopup('timer-stopped', { entry: null, todayTotal: localStoppedProjectTotal });

  apiClient.stopTimer().then(async (result) => {
    try {
      todayTotalGlobal = await apiClient.getTodayTotal(null);
    } catch {
      if (result?.today_total != null) todayTotalGlobal = result.today_total;
    }
    updateTrayTitle();
    let todayTotalForPopup = result?.today_total ?? 0;
    try {
      todayTotalForPopup = await apiClient.getTodayTotal(stoppedProjectId);
    } catch {}
    notifyPopup('timer-stopped', { entry: result?.entry ?? null, todayTotal: todayTotalForPopup });
  }).catch(() => {});

  return { success: true, entry: null, todayTotal: localStoppedProjectTotal };
}

// Periodically sync timer state with server to stay in sync with web dashboard
function startTimerSync() {
  if (timerSyncInterval) clearInterval(timerSyncInterval);
  timerSyncInterval = setInterval(async () => {
    if (!apiClient) return;
    try {
      const status = await apiClient.getTimerStatus();
      const globalTotal = status.today_total ?? 0;
      const elapsed = status.elapsed_seconds ?? 0;
      if (status.running) {
        todayTotalGlobal = Math.max(0, globalTotal - elapsed);
        try {
          const withElapsed = await apiClient.getTodayTotal(status.entry?.project_id ?? null);
          todayTotalCurrentProject = Math.max(0, withElapsed - elapsed);
        } catch {
          todayTotalCurrentProject = todayTotalGlobal;
        }
      } else {
        todayTotalGlobal = globalTotal;
        todayTotalCurrentProject = 0;
      }

      if (status.running && !isTimerRunning) {
        isTimerRunning = true;
        currentEntry = status.entry;
        todayTotalCurrentProject = Math.max(0, (await apiClient.getTodayTotal(status.entry?.project_id ?? null).catch(() => 0)) - (status.elapsed_seconds ?? 0));
        activityMonitor?.start();
        screenshotService?.start(currentEntry.id);
        idleDetector?.start();
        startTrayTimer();
        updateTrayIcon(true);
        updateTrayMenu();
        notifyPopup('timer-started', { ...currentEntry, todayTotal: todayTotalCurrentProject });
      } else if (!status.running && isTimerRunning) {
        isTimerRunning = false;
        currentEntry = null;
        todayTotalCurrentProject = 0;
        activityMonitor?.stop();
        screenshotService?.stop();
        idleDetector?.stop();
        dismissIdleAlert();
        stopTrayTimer();
        updateTrayTitle();
        updateTrayIcon(false);
        updateTrayMenu();
        notifyPopup('timer-stopped', { entry: null });
      }
    } catch {}
  }, 30000);
}

function formatTimeShort(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function updateTrayIcon(running) {
  if (!tray) return;
  tray.setToolTip(running ? 'TrackFlow - Timer Running' : 'TrackFlow');
}

// Tray: when stopped = all projects today; when running = current project today + elapsed
function updateTrayTitle() {
  if (!tray) return;
  const total = isTimerRunning ? todayTotalCurrentProject : todayTotalGlobal;
  if (total > 0) {
    tray.setTitle(formatTimeShort(total));
  } else {
    tray.setTitle('');
  }
}

function startTrayTimer() {
  stopTrayTimer();
  updateTrayTitle();
  trayTimerInterval = setInterval(() => {
    if (!isTimerRunning || !currentEntry) return;
    const currentElapsed = Math.floor((Date.now() - new Date(currentEntry.started_at).getTime()) / 1000);
    if (tray) {
      tray.setTitle(formatTimeShort(todayTotalCurrentProject + currentElapsed));
    }
  }, 1000);
}

function stopTrayTimer() {
  if (trayTimerInterval) {
    clearInterval(trayTimerInterval);
    trayTimerInterval = null;
  }
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
    height: 480,
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
    idleAlertWindow.webContents.send('idle-data', {
      idleStartedAt,
      idleSeconds,
      projects: cachedProjects || [],
    });
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

async function handleIdleAction(action, idleDurationOverride = null, reassignProjectId = null) {
  const idleDuration = idleDurationOverride || idleDetector?.getIdleDuration() || 0;
  const idleStartedAt = idleDetector?.idleStartedAt || null;

  idleDetector?.resolveIdle();

  switch (action) {
    case 'keep':
      if (isTimerRunning && currentEntry) {
        screenshotService?.start(currentEntry.id);
      }
      break;

    case 'discard':
    case 'reassign':
      if (apiClient && currentEntry && idleStartedAt) {
        try {
          const payload = {
            time_entry_id: currentEntry.id,
            idle_started_at: new Date(idleStartedAt).toISOString(),
            idle_ended_at: new Date().toISOString(),
            idle_seconds: idleDuration,
            action: action === 'reassign' && reassignProjectId ? 'reassign' : 'discard',
          };
          if (payload.action === 'reassign') payload.project_id = reassignProjectId;

          const result = await apiClient.reportIdleTime(payload);
          if (result?.new_entry) {
            currentEntry = result.new_entry;
          }
        } catch (e) {
          console.error('Failed to report idle time:', e.message);
        }
      }
      if (isTimerRunning && currentEntry) {
        screenshotService?.start(currentEntry.id);
      }
      break;

    case 'stop':
      stopTimer();
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
