const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, Notification, screen } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const ApiClient = require('./api-client');
const ActivityMonitor = require('./activity-monitor');
const ScreenshotService = require('./screenshot-service');
const IdleDetector = require('./idle-detector');
const OfflineQueue = require('./offline-queue');
const { getToken, setToken, getRefreshToken, setRefreshToken, deleteToken } = require('./keychain');

const WEB_DASHBOARD_URL = process.env.TRACKFLOW_WEB_URL || 'https://trackflow.codeupscale.com';

// Default configuration values — single source of truth
const DEFAULT_CONFIG = {
  screenshot_interval: 5,
  idle_timeout: 5,
  idle_detection: true,
  keep_idle_time: 'never',
  blur_screenshots: false,
  idle_alert_auto_stop_min: 10,
  screenshot_capture_immediate_after_idle: true,
  screenshot_first_capture_delay_min: 1,
  idle_check_interval_sec: 10,
  capture_only_when_visible: false,
  capture_multi_monitor: false,
};

let tray = null;
let popupWindow = null;
let loginWindow = null;
let idleAlertWindow = null;
let apiClient = null;
let activityMonitor = null;
let screenshotService = null;
let idleDetector = null;
let offlineQueue = null;
let isTimerRunning = false;
let currentEntry = null;
// Two totals for multi-project clarity
let todayTotalGlobal = 0;       // All projects today (tray when stopped)
let todayTotalCurrentProject = 0; // Current entry's project today, completed only (tray when running)
let config = {};
let loginHandlerRegistered = false;
let cachedProjects = [];
let isAuthenticated = false;
let timerSyncInterval = null;
let trayTimerInterval = null;
let isQuitting = false;
// Cache parsed started_at timestamp to avoid re-parsing every second
let _cachedStartedAtMs = null;

// ── Global Error Handlers ────────────────────────────────────────────────────

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  // Don't crash — log and continue. Critical for a background agent.
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

// ── Single Instance Lock ─────────────────────────────────────────────────────

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
  if (isQuitting) return; // Prevent re-entry

  if (isTimerRunning && apiClient) {
    e.preventDefault();
    isQuitting = true;
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
    idleDetector?.stop();
    cleanupOnExit();
    app.exit(0);
  } else {
    idleDetector?.stop();
    cleanupOnExit();
  }
});

function cleanupOnExit() {
  if (timerSyncInterval) {
    clearInterval(timerSyncInterval);
    timerSyncInterval = null;
  }
  stopTrayTimer();
  offlineQueue?.close();
}

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

  // Test token validity with retry for transient network errors
  let tokenValid = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await apiClient.getMe();
      tokenValid = true;
      break;
    } catch (e) {
      const status = e.response?.status;
      // If 401/403 after refresh attempt, token is truly invalid
      if (status === 401 || status === 403) break;
      // Transient error — retry after short delay
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  }

  if (!tokenValid) {
    await deleteToken();
    isAuthenticated = false;
    createTray();
    createLoginWindow();
    return;
  }

  isAuthenticated = true;

  // Fetch org config with fallback to defaults
  try {
    const serverConfig = await apiClient.getConfig();
    config = { ...DEFAULT_CONFIG, ...serverConfig };
  } catch {
    config = { ...DEFAULT_CONFIG };
  }

  // Initialize services
  offlineQueue = new OfflineQueue();
  activityMonitor = new ActivityMonitor(apiClient, offlineQueue);
  const getIsAppVisible = () => popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible();
  screenshotService = new ScreenshotService(apiClient, config, offlineQueue, getIsAppVisible);
  idleDetector = new IdleDetector(config);

  // Wire idle detection events
  idleDetector.onIdleDetected((idleSeconds, idleStartedAt) => {
    screenshotService?.stop();
    const policy = config.keep_idle_time || 'prompt';
    if (policy === 'always') {
      idleDetector.resolveIdle();
      if (isTimerRunning && currentEntry) {
        screenshotService?.start(currentEntry.id, {
          immediateCapture: config.screenshot_capture_immediate_after_idle === true,
        });
      }
      return;
    }
    if (policy === 'never') {
      handleIdleAction('discard', idleSeconds, null);
      dismissIdleAlert();
      return;
    }
    showIdleAlert(idleSeconds, idleStartedAt);
  });

  idleDetector.onAutoStop((totalIdleSeconds) => {
    handleIdleAction('stop', totalIdleSeconds);
    dismissIdleAlert();

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

  // Check timer status on server
  try {
    const status = await apiClient.getTimerStatus();
    const globalTotal = status.today_total ?? 0;
    const elapsed = status.elapsed_seconds ?? 0;
    if (status.running) {
      todayTotalGlobal = Math.max(0, globalTotal - elapsed);
      isTimerRunning = true;
      currentEntry = status.entry;
      _cachedStartedAtMs = currentEntry?.started_at ? new Date(currentEntry.started_at).getTime() : null;
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
    return;
  }

  const iconPath = path.join(__dirname, '..', '..', 'assets', 'tray-icon.png');
  let icon = nativeImage.createFromPath(iconPath);

  // Fallback: create a tiny 16x16 blue square if tray-icon.png missing
  if (icon.isEmpty()) {
    const size = 16;
    const buf = Buffer.alloc(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      buf[i * 4] = 59;      // R (#3b82f6)
      buf[i * 4 + 1] = 130; // G
      buf[i * 4 + 2] = 246; // B
      buf[i * 4 + 3] = 255; // A
    }
    icon = nativeImage.createFromBuffer(buf, { width: size, height: size });
  }

  tray = new Tray(icon);
  tray.setToolTip('TrackFlow');

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
}

async function loadProjects() {
  if (!apiClient) return;
  try {
    const projects = await apiClient.getProjects();
    cachedProjects = Array.isArray(projects) ? projects : [];
  } catch {
    cachedProjects = [];
  }
}

async function openDashboardInBrowser() {
  // Open web dashboard — do NOT pass tokens in URL (security risk: browser history, referrer headers, server logs)
  // The web app should handle its own authentication
  shell.openExternal(WEB_DASHBOARD_URL);
}

function buildTrayContextMenu() {
  if (!isAuthenticated) {
    return Menu.buildFromTemplate([
      { label: 'Open TrackFlow', click: () => createLoginWindow() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]);
  }

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

function showPopup() {
  if (!isAuthenticated) {
    createLoginWindow();
    return;
  }

  if (popupWindow && !popupWindow.isDestroyed()) {
    if (typeof popupWindow.moveTop === 'function') {
      popupWindow.moveTop();
    }
    if (process.platform === 'linux') {
      popupWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    popupWindow.show();
    popupWindow.focus();
    setImmediate(() => {
      if (popupWindow && !popupWindow.isDestroyed()) {
        popupWindow.webContents.send('sync-timer');
      }
    });
    return;
  }

  const trayBounds = tray.getBounds();
  const windowWidth = 320;
  const windowHeight = 400;

  // Calculate position — platform-aware:
  //   macOS: tray is at the top → popup below tray
  //   Windows: taskbar is at bottom → popup above tray
  //   Linux: taskbar can be anywhere → detect and adapt
  let x = Math.round(trayBounds.x - windowWidth / 2 + trayBounds.width / 2);
  let y;

  try {
    const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
    const workArea = display.workArea;

    // Determine if tray is in the top or bottom half of the screen
    const trayCenter = trayBounds.y + trayBounds.height / 2;
    const screenCenter = workArea.y + workArea.height / 2;
    const trayIsAtTop = trayCenter < screenCenter;

    if (trayIsAtTop) {
      // macOS / Linux top panel: popup below tray
      y = trayBounds.y + trayBounds.height + 4;
    } else {
      // Windows / Linux bottom panel: popup above tray
      y = trayBounds.y - windowHeight - 4;
    }

    // Clamp to work area so popup never goes off-screen
    x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - windowWidth));
    y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - windowHeight));
  } catch {
    // Fallback: below tray
    y = trayBounds.y + trayBounds.height + 4;
  }

  popupWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x,
    y,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#0f172a',   // Prevent white flash on all platforms
    ...(process.platform === 'linux' && { visibleOnAllWorkspaces: true }),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  popupWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  popupWindow.once('ready-to-show', () => {
    popupWindow.show();
  });

  // Hide on blur — with debounce for Linux DEs that fire spurious blur events
  // (e.g. KDE fires blur then immediately re-focuses when clicking tray)
  let blurTimeout = null;
  popupWindow.on('blur', () => {
    if (process.platform === 'linux') {
      blurTimeout = setTimeout(() => {
        if (popupWindow && !popupWindow.isDestroyed() && !popupWindow.isFocused()) {
          popupWindow.hide();
        }
      }, 150);
    } else {
      popupWindow.hide();
    }
  });
  popupWindow.on('focus', () => {
    if (blurTimeout) { clearTimeout(blurTimeout); blurTimeout = null; }
  });

  popupWindow.on('closed', () => {
    popupWindow = null;
  });
}

// ── IPC Input Validation Helpers ─────────────────────────────────────────────

function validateProjectId(id) {
  if (id === null || id === undefined || id === '') return null;
  // Keep as string — backend expects UUID strings, not integers.
  // Accept any non-empty string that looks like an ID (alphanumeric, hyphens, underscores).
  if (typeof id === 'string') {
    const trimmed = id.trim();
    if (trimmed && /^[a-zA-Z0-9_-]+$/.test(trimmed)) return trimmed;
    return null;
  }
  // If renderer somehow sends a number, convert to string for the API
  if (typeof id === 'number' && id > 0) return String(id);
  return null;
}

function validateIdleAction(action) {
  const valid = ['keep', 'discard', 'stop', 'reassign'];
  return valid.includes(action) ? action : null;
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
    const validProjectId = validateProjectId(projectId);
    if (apiClient) {
      try {
        const status = await apiClient.getTimerStatus();
        const globalTotal = status.today_total ?? 0;
        const elapsed = status.elapsed_seconds ?? 0;
        if (status.running) {
          todayTotalGlobal = Math.max(0, globalTotal - elapsed);
          isTimerRunning = true;
          currentEntry = status.entry;
          _cachedStartedAtMs = currentEntry?.started_at ? new Date(currentEntry.started_at).getTime() : null;
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
          _cachedStartedAtMs = null;
        }
      } catch {}
    }
    const projectIdForTotal = isTimerRunning && currentEntry?.project_id
      ? currentEntry.project_id
      : validProjectId || null;
    let todayTotalForDisplay = 0;
    if (apiClient) {
      try {
        todayTotalForDisplay = await apiClient.getTodayTotal(projectIdForTotal);
      } catch {}
    }
    return {
      isRunning: isTimerRunning,
      entry: currentEntry,
      elapsed: currentEntry && _cachedStartedAtMs
        ? Math.floor((Date.now() - _cachedStartedAtMs) / 1000)
        : 0,
      todayTotal: todayTotalForDisplay,
    };
  });

  ipcMain.handle('start-timer', async (_, projectId) => {
    const validProjectId = validateProjectId(projectId);
    return await startTimer(validProjectId);
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
    _cachedStartedAtMs = null;
    isAuthenticated = false;
    activityMonitor?.stop();
    screenshotService?.stop();
    idleDetector?.stop();
    dismissIdleAlert();

    if (timerSyncInterval) {
      clearInterval(timerSyncInterval);
      timerSyncInterval = null;
    }
    stopTrayTimer();

    // CRITICAL: Clear and close offline queue BEFORE deleting tokens.
    // Prevents queued heartbeats/screenshots from being uploaded under a different user.
    if (offlineQueue) {
      offlineQueue.close();
      offlineQueue = null;
    }

    await deleteToken();
    apiClient = null;
    activityMonitor = null;
    screenshotService = null;
    idleDetector = null;
    cachedProjects = [];
    todayTotalGlobal = 0;
    todayTotalCurrentProject = 0;
    config = {};

    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.destroy();
    }
    popupWindow = null;

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
    const validAction = validateIdleAction(action);
    if (!validAction) return { error: 'Invalid action' };
    const validProjectId = validateProjectId(projectId);
    await handleIdleAction(validAction, null, validProjectId);
    dismissIdleAlert();
    return { success: true };
  });
}

// Run after timer has started — tray, sync, screenshot. Keeps startTimer() return fast.
function afterStartTimer(projectIdForTotal, todayTotalForPopup) {
  if (!apiClient || !currentEntry) return;
  (async () => {
    try {
      todayTotalGlobal = await apiClient.getTodayTotal(null);
    } catch {
      todayTotalGlobal = todayTotalForPopup;
    }
    activityMonitor.start();
    screenshotService.start(currentEntry.id);
    idleDetector?.start();
    startTrayTimer();
    updateTrayIcon(true);
  })();
}

async function startTimer(projectId = null) {
  if (isTimerRunning) return { error: 'Timer already running' };

  try {
    const result = await apiClient.startTimer(projectId);
    currentEntry = result.entry;
    _cachedStartedAtMs = currentEntry?.started_at ? new Date(currentEntry.started_at).getTime() : null;
    isTimerRunning = true;
    todayTotalCurrentProject = result.today_total ?? 0;

    const todayTotalForPopup = todayTotalCurrentProject;
    notifyPopup('timer-started', { ...currentEntry, todayTotal: todayTotalForPopup });
    setImmediate(() => afterStartTimer(projectId, todayTotalForPopup));
    return { success: true, entry: currentEntry, todayTotal: todayTotalForPopup };
  } catch (e) {
    const status = e.response?.status;

    // 409 = timer already running on server — sync local state
    if (status === 409) {
      try {
        await apiClient.stopTimer();
      } catch {}

      try {
        const retryResult = await apiClient.startTimer(projectId);
        currentEntry = retryResult.entry;
        _cachedStartedAtMs = currentEntry?.started_at ? new Date(currentEntry.started_at).getTime() : null;
        isTimerRunning = true;
        todayTotalCurrentProject = retryResult.today_total ?? 0;
        notifyPopup('timer-started', { ...currentEntry, todayTotal: todayTotalCurrentProject });
        setImmediate(() => afterStartTimer(projectId, todayTotalCurrentProject));
        return { success: true, entry: currentEntry, todayTotal: todayTotalCurrentProject };
      } catch (retryErr) {
        return { error: retryErr.response?.data?.message || retryErr.message };
      }
    }

    return { error: e.response?.data?.message || e.message };
  }
}

function stopTimer() {
  const sessionElapsed = currentEntry && _cachedStartedAtMs
    ? Math.max(0, Math.floor((Date.now() - _cachedStartedAtMs) / 1000))
    : 0;
  const stoppedProjectId = currentEntry?.project_id || null;
  const localStoppedProjectTotal = todayTotalCurrentProject + sessionElapsed;

  dismissIdleAlert();

  isTimerRunning = false;
  currentEntry = null;
  _cachedStartedAtMs = null;
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
        _cachedStartedAtMs = currentEntry?.started_at ? new Date(currentEntry.started_at).getTime() : null;
        try {
          todayTotalCurrentProject = Math.max(0, (await apiClient.getTodayTotal(status.entry?.project_id ?? null)) - (status.elapsed_seconds ?? 0));
        } catch {
          todayTotalCurrentProject = 0;
        }
        activityMonitor?.start();
        screenshotService?.start(currentEntry.id);
        idleDetector?.start();
        startTrayTimer();
        updateTrayIcon(true);
        notifyPopup('timer-started', { ...currentEntry, todayTotal: todayTotalCurrentProject });
      } else if (!status.running && isTimerRunning) {
        isTimerRunning = false;
        currentEntry = null;
        _cachedStartedAtMs = null;
        todayTotalCurrentProject = 0;
        activityMonitor?.stop();
        screenshotService?.stop();
        idleDetector?.stop();
        dismissIdleAlert();
        stopTrayTimer();
        updateTrayTitle();
        updateTrayIcon(false);
        notifyPopup('timer-stopped', { entry: null, todayTotal: globalTotal });
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

// Cross-platform tray text:
//   macOS: tray.setTitle() shows text next to icon in menu bar
//   Windows/Linux: tray.setTitle() is not visible — use tooltip instead
function setTrayText(text) {
  if (!tray) return;
  if (process.platform === 'darwin') {
    tray.setTitle(text);
  }
  // All platforms: update tooltip so hover shows the time
  if (text) {
    tray.setToolTip(`TrackFlow — ${text}`);
  } else {
    tray.setToolTip('TrackFlow');
  }
}

function updateTrayTitle() {
  if (!tray) return;
  const total = isTimerRunning ? todayTotalCurrentProject : todayTotalGlobal;
  if (total > 0) {
    setTrayText(formatTimeShort(total));
  } else {
    setTrayText('');
  }
}

function startTrayTimer() {
  stopTrayTimer();
  updateTrayTitle();
  trayTimerInterval = setInterval(() => {
    if (!isTimerRunning || !_cachedStartedAtMs) return;
    const currentElapsed = Math.floor((Date.now() - _cachedStartedAtMs) / 1000);
    setTrayText(formatTimeShort(todayTotalCurrentProject + currentElapsed));
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

// ── Idle Alert System ────────────────────────────────────────────────────────

async function showIdleAlert(idleSeconds, idleStartedAt) {
  if (idleAlertWindow && !idleAlertWindow.isDestroyed()) return;
  if (!isTimerRunning) return;

  screenshotService?.stop();

  // Refresh project list so idle reassign dropdown is up-to-date
  await loadProjects();

  idleAlertWindow = new BrowserWindow({
    width: 380,
    height: 520,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    center: true,
    show: false,
    backgroundColor: '#0f172a',   // Prevent white flash on all platforms
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
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

  if (process.platform === 'darwin') {
    app.dock.show();
  }
}

function dismissIdleAlert() {
  if (idleAlertWindow && !idleAlertWindow.isDestroyed()) {
    idleAlertWindow.destroy();
  }
  idleAlertWindow = null;

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
        screenshotService?.start(currentEntry.id, {
          immediateCapture: config.screenshot_capture_immediate_after_idle === true,
        });
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
            _cachedStartedAtMs = currentEntry?.started_at ? new Date(currentEntry.started_at).getTime() : null;
          }
        } catch (e) {
          console.error('Failed to report idle time:', e.message);
        }
      }
      if (isTimerRunning && currentEntry) {
        screenshotService?.start(currentEntry.id, {
          immediateCapture: config.screenshot_capture_immediate_after_idle === true,
        });
      }
      break;

    case 'stop':
      stopTimer();
      break;
  }
}

// ── Login Window ─────────────────────────────────────────────────────────────

function createLoginWindow() {
  // Prevent duplicate login windows
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.show();
    loginWindow.focus();
    return;
  }

  loginWindow = new BrowserWindow({
    width: 400,
    height: 500,
    frame: false,        // Custom titlebar for identical look on macOS/Windows/Linux
    resizable: false,
    center: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  loginWindow.loadFile(path.join(__dirname, '..', 'renderer', 'login.html'));

  loginWindow.on('closed', () => {
    loginWindow = null;
  });

  // Only register the login handler once
  if (!loginHandlerRegistered) {
    loginHandlerRegistered = true;
    ipcMain.handle('login', async (_, email, password) => {
      // Validate inputs
      if (typeof email !== 'string' || typeof password !== 'string') {
        return { error: 'Invalid credentials format' };
      }
      email = email.trim();
      if (!email || !password) {
        return { error: 'Email and password are required' };
      }

      try {
        const tempClient = new ApiClient(null);
        const result = await tempClient.login(email, password);
        await setToken(result.access_token);
        await setRefreshToken(result.refresh_token);

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
    return;
  }
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
}

// Auto-start on login — only set if packaged (don't interfere with dev)
if (app.isPackaged) {
  app.setLoginItemSettings({ openAtLogin: true });
}
