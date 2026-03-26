const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, Notification, screen, powerMonitor, nativeTheme, systemPreferences, dialog, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');

// ── Load .env for both dev and packaged builds ──────────────────
// In dev: .env is in the project root (desktop/.env)
// In packaged: .env is bundled via extraResources into the Resources dir
(function loadEnv() {
  try {
    const envPaths = [
      path.join(process.resourcesPath, '.env'),            // packaged
      path.join(__dirname, '..', '..', '.env'),             // dev (src/main -> desktop)
    ];
    for (const p of envPaths) {
      if (fs.existsSync(p)) {
        const lines = fs.readFileSync(p, 'utf8').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx === -1) continue;
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim();
          if (!process.env[key]) process.env[key] = val;
        }
        break;
      }
    }
  } catch (_) {
    // Non-fatal — env vars may already be set by the OS or launcher
  }
})();
const { autoUpdater } = require('electron-updater');
const ApiClient = require('./api-client');
const ActivityMonitor = require('./activity-monitor');
const ScreenshotService = require('./screenshot-service');
const IdleDetector = require('./idle-detector');
const OfflineQueue = require('./offline-queue');
const { getToken, setToken, getRefreshToken, setRefreshToken, deleteToken } = require('./keychain');
const posthog = require('./posthog');
const { getTrayIcon } = require('./tray-icons');

const WEB_DASHBOARD_URL = process.env.TRACKFLOW_WEB_URL || 'https://trackflow.codeupscale.com';

// ── File-based logger for packaged macOS builds ───────────────────
// macOS .app bundles suppress stdout/stderr. This writes to a log
// file in userData so we can diagnose issues in production.
// NOTE: LOG_FILE is lazy-initialized because app.getPath('userData')
// may not be available before app.whenReady() on some platforms.
let _logFile = null;
function getLogFile() {
  if (!_logFile) {
    try {
      _logFile = path.join(app.getPath('userData'), 'trackflow.log');
    } catch {
      _logFile = '/tmp/trackflow.log'; // fallback
    }
  }
  return _logFile;
}
// Write a startup marker IMMEDIATELY to verify logging works
try { fs.appendFileSync('/tmp/trackflow-boot.log', `[${new Date().toISOString()}] TrackFlow main process starting\n`); } catch {}

function logToFile(level, ...args) {
  const ts = new Date().toISOString();
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  const line = `[${ts}] [${level}] ${msg}\n`;
  try { fs.appendFileSync(getLogFile(), line); } catch {}
  // Also write to /tmp as a guaranteed fallback
  try { fs.appendFileSync('/tmp/trackflow-boot.log', line); } catch {}
  // Also write to stdout for terminal/dev mode
  if (level === 'error') {
    try { process.stderr.write(line); } catch {}
  } else {
    try { process.stdout.write(line); } catch {}
  }
}
// Override console for main process so ALL logs go to both file and stdout
const _origLog = console.log;
const _origError = console.error;
const _origWarn = console.warn;
console.log = (...args) => { _origLog(...args); logToFile('info', ...args); };
console.error = (...args) => { _origError(...args); logToFile('error', ...args); };
console.warn = (...args) => { _origWarn(...args); logToFile('warn', ...args); };
console.log('Logger initialized — writing to', getLogFile());

// Minimum duration (seconds) for a time entry to be considered valid.
// Entries shorter than this are treated as artifacts (e.g., the zero-duration
// entries created by reportIdleTime when the user chooses "stop").
const MIN_ENTRY_DURATION_SEC = 5;

// Default configuration values — single source of truth
const DEFAULT_CONFIG = {
  screenshot_interval: 5,
  idle_timeout: 5,
  idle_detection: true,
  keep_idle_time: 'prompt',
  blur_screenshots: false,
  idle_alert_auto_stop_min: 10,
  screenshot_capture_immediate_after_idle: true,
  screenshot_first_capture_delay_min: 1,
  idle_check_interval_sec: 10,
  capture_only_when_visible: false,
  capture_multi_monitor: false,
  track_urls: true,
  can_add_manual_time: true,
};

// ── Last Selected Project Persistence ────────────────────────────────────────
// Persist the last selected project ID to a JSON file in userData so it
// survives logout/login cycles and app restarts.
function getPrefsPath() {
  try {
    return path.join(app.getPath('userData'), 'user-prefs.json');
  } catch {
    return null;
  }
}

function loadLastProjectId() {
  try {
    const p = getPrefsPath();
    if (!p || !fs.existsSync(p)) return null;
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return data.lastSelectedProjectId || null;
  } catch {
    return null;
  }
}

function saveLastProjectId(projectId) {
  try {
    const p = getPrefsPath();
    if (!p) return;
    let data = {};
    if (fs.existsSync(p)) {
      try { data = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { data = {}; }
    }
    data.lastSelectedProjectId = projectId || null;
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save last project ID:', e);
  }
}

// ── Restart State Persistence ────────────────────────────────────────────────
// Saves tracking state before a forced restart (e.g., after granting Screen
// Recording permission on macOS). On next launch, the app auto-resumes.
function getRestartStatePath() {
  try {
    return path.join(app.getPath('userData'), 'restart-state.json');
  } catch {
    return null;
  }
}

function saveRestartState() {
  try {
    const p = getRestartStatePath();
    if (!p) return;
    const state = {
      wasTracking: isTimerRunning,
      projectId: currentEntry?.project_id || loadLastProjectId() || null,
      entryId: currentEntry?.id || null,
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(p, JSON.stringify(state, null, 2), 'utf8');
    console.log('[RestartState] Saved:', JSON.stringify(state));
  } catch (e) {
    console.error('[RestartState] Failed to save:', e.message);
  }
}

function loadRestartState() {
  try {
    const p = getRestartStatePath();
    if (!p || !fs.existsSync(p)) return null;
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    // Only honour restart state if it was saved within the last 5 minutes
    const savedAt = new Date(data.savedAt).getTime();
    if (Date.now() - savedAt > 5 * 60 * 1000) {
      console.log('[RestartState] Expired (older than 5 minutes), ignoring');
      clearRestartState();
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function clearRestartState() {
  try {
    const p = getRestartStatePath();
    if (p && fs.existsSync(p)) {
      fs.unlinkSync(p);
      console.log('[RestartState] Cleared');
    }
  } catch {}
}

// ── Screen Recording Permission (macOS) ──────────────────────────────────────
// Tracks whether the user has declined the permission prompt this session so we
// don't nag repeatedly. Reset on app restart.
let _screenPermissionDeclinedThisSession = false;
let _screenPermissionGranted = null; // null = not checked yet, true/false after check

function checkScreenRecordingPermission() {
  if (process.platform !== 'darwin') {
    _screenPermissionGranted = true;
    return true;
  }

  // NOTE: We do NOT trust persisted state alone here, because rebuilding the app
  // with the same version number changes the code signature and macOS revokes
  // permission silently. The persisted state is only used as a hint — the real
  // check happens in probeScreenRecordingPermission() which does a live capture test.
  //
  // systemPreferences.getMediaAccessStatus('screen') is also unreliable for
  // ad-hoc signed apps — it may return 'denied' even when permission IS granted.
  // So we always return false here to force the probe to run.
  try {
    const status = systemPreferences.getMediaAccessStatus('screen');
    console.log(`[Permission] Screen recording API status: ${status}`);
    if (status === 'granted') {
      _screenPermissionGranted = true;
      return true;
    }
    // For 'denied' or 'not-determined', don't trust it — force probe
    _screenPermissionGranted = false;
    return false;
  } catch {
    _screenPermissionGranted = null;
    return false;
  }
}

// ── Persisted Screen Permission State ──────────────────────────────────────
// After confirming permission via a real desktopCapturer probe, save the
// result to disk so we don't re-prompt on every launch. The state is
// invalidated when the app version changes (a new binary may need to
// re-register in System Settings).

function getScreenPermissionStatePath() {
  try {
    return path.join(app.getPath('userData'), 'screen-permission.json');
  } catch {
    return null;
  }
}

function loadScreenPermissionState() {
  try {
    const p = getScreenPermissionStatePath();
    if (!p || !fs.existsSync(p)) return null;
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    // Invalidate if the app version changed (new binary may need re-registration)
    if (data.appVersion !== app.getVersion()) {
      console.log('[Permission] Persisted state is for a different app version — ignoring');
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function saveScreenPermissionState(granted) {
  try {
    const p = getScreenPermissionStatePath();
    if (!p) return;
    const data = {
      granted: !!granted,
      grantedAt: granted ? new Date().toISOString() : null,
      appVersion: app.getVersion(),
    };
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
    console.log(`[Permission] Saved screen permission state: granted=${granted}`);
  } catch (e) {
    console.error('[Permission] Failed to save screen permission state:', e.message);
  }
}

// ── Screen Recording Probe ─────────────────────────────────────────────────
// On macOS, an app only appears in System Settings > Privacy > Screen Recording
// AFTER it has called desktopCapturer.getSources() at least once. Without this
// probe, the user opens System Settings and cannot find TrackFlow in the list.
//
// This function triggers a lightweight probe (1x1 thumbnail) so macOS registers
// the app. If the probe returns real content, we also know permission is granted
// and persist that state.

async function probeScreenRecordingPermission() {
  if (process.platform !== 'darwin') return true;

  console.log('[Permission] Probing desktopCapturer to register in Screen Recording list...');
  try {
    const sources = await Promise.race([
      desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1, height: 1 },
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('probe timed out')), 5000)
      ),
    ]);

    console.log(`[Permission] Probe returned ${sources.length} source(s)`);

    // If we got sources with non-empty thumbnails, permission is granted
    if (sources.length > 0) {
      const hasContent = sources.some(s => s.thumbnail && !s.thumbnail.isEmpty());
      if (hasContent) {
        console.log('[Permission] Probe confirmed: screen recording permission IS granted');
        _screenPermissionGranted = true;
        saveScreenPermissionState(true);
        return true;
      }
    }

    // Sources returned but thumbnails empty — app is now registered in the list
    // but permission is not yet granted
    console.log('[Permission] Probe complete: app registered, but permission NOT yet granted');
    return false;
  } catch (e) {
    console.warn('[Permission] Probe failed:', e.message);
    return false;
  }
}

async function showScreenPermissionOnboarding(options = {}) {
  const { isPreStart = false, wasTracking = false } = options;

  if (_screenPermissionDeclinedThisSession && !isPreStart) return 'declined';

  const detail = isPreStart
    ? 'TrackFlow needs Screen Recording access to capture activity screenshots for your employer.\n\n'
      + 'Steps to enable:\n'
      + '1. Click "Open System Settings" below\n'
      + '2. Find "TrackFlow" in the list and toggle it ON\n'
      + '3. macOS will ask you to "Quit & Reopen" — click it\n'
      + (wasTracking
        ? '\nDon\'t worry — your tracking session will resume automatically after restart.'
        : '\nAfter restarting, you can start tracking right away.')
    : 'Screen Recording permission is required to capture screenshots.\n\n'
      + 'Steps to enable:\n'
      + '1. Click "Open System Settings" below\n'
      + '2. Find "TrackFlow" in the list and toggle it ON\n'
      + '3. macOS will ask you to "Quit & Reopen" — click it\n'
      + '\nYour selected project will be remembered after restart.';

  const result = await dialog.showMessageBox({
    type: 'info',
    title: 'Screen Recording Permission Required',
    message: 'TrackFlow needs screen recording access',
    detail,
    buttons: ['Open System Settings', 'Skip for Now'],
    defaultId: 0,
    cancelId: 1,
  });

  if (result.response === 0) {
    // Save state before directing user to settings (they may need to restart)
    saveRestartState();
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    return 'opened-settings';
  } else {
    _screenPermissionDeclinedThisSession = true;
    return 'declined';
  }
}

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
  posthog.captureError('unknown', error, { type: 'uncaught_exception' });
  // Don't crash — log and continue. Critical for a background agent.
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  posthog.captureError('unknown', reason instanceof Error ? reason : new Error(String(reason)), { type: 'unhandled_rejection' });
});

// ── Single Instance Lock ─────────────────────────────────────────────────────

const gotTheLock = app.requestSingleInstanceLock();
console.log(`Single instance lock: ${gotTheLock ? 'acquired' : 'FAILED (another instance running)'}`);
if (!gotTheLock) {
  console.log('Exiting — another instance holds the lock');
  app.quit();
}

app.on('second-instance', () => {
  showPopup();
});

app.on('ready', async () => {
  console.log('app.ready fired — initializing...');
  await initializeApp();
  console.log('initializeApp() complete');
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
    await posthog.shutdown();
    cleanupOnExit();
    app.exit(0);
  } else {
    idleDetector?.stop();
    await posthog.shutdown();
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

// Force logout — called when token refresh fails (password changed, tokens revoked).
// Stops timer locally (does NOT call server since token is invalid), clears state, shows login.
let _forceLogoutInProgress = false;
async function forceLogout() {
  if (_forceLogoutInProgress) return;
  _forceLogoutInProgress = true;

  console.warn('[Auth] Force logout — stopping all services');
  posthog.capture(currentEntry?.user_id || 'unknown', 'force_logged_out', { reason: 'token_refresh_failed' });

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

  // Update tray icon to idle state
  updateTrayIcon(false);
  setTrayText('');

  createLoginWindow();
  _forceLogoutInProgress = false;
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

  // Force logout when token refresh fails (e.g. password changed on web)
  apiClient.onAuthFailed(() => {
    console.warn('[Auth] Token refresh failed — forcing logout (password likely changed)');
    forceLogout();
  });

  // Initialize PostHog analytics (key loaded from .env via loadEnv() above)
  const posthogKey = process.env.POSTHOG_KEY || '';
  const posthogHost = process.env.POSTHOG_HOST || 'https://us.i.posthog.com';
  posthog.init(posthogKey, { host: posthogHost });

  // Test token validity with retry for transient network errors
  let tokenValid = false;
  let user = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      user = await apiClient.getMe();
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

  // Identify user in PostHog
  if (user) {
    posthog.identify(user.id, {
      email: user.email,
      name: user.name,
      role: user.role,
      organization_id: user.organization_id,
    });
    posthog.capture(user.id, 'app_launched', { version: app.getVersion() });
  }

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
  screenshotService = new ScreenshotService(apiClient, config, offlineQueue, getIsAppVisible, activityMonitor);
  screenshotService.setRestartStateSaver(() => saveRestartState());
  idleDetector = new IdleDetector(config);

  // Wire idle detection events
  idleDetector.onIdleDetected((idleSeconds, idleStartedAt) => {
    // Pause both screenshot and activity capture during idle.
    // This prevents zero-event heartbeats from dragging down the activity score.
    screenshotService?.stop();
    activityMonitor?.stop();
    stopTrayTimer();
    const policy = config.keep_idle_time || 'prompt';
    if (policy === 'always') {
      idleDetector.resolveIdle();
      // Restore tray from idle state
      updateTrayIcon(isTimerRunning);
      if (isTimerRunning) updateTrayTitle();
      activityMonitor?.start();
      if (isTimerRunning && currentEntry) {
        screenshotService?.start(currentEntry.id, {
          immediateCapture: config.screenshot_capture_immediate_after_idle === true,
        });
      }
      startTrayTimer();
      return;
    }
    if (policy === 'never') {
      handleIdleAction('discard', idleSeconds, null);
      dismissIdleAlert();
      return;
    }
    // Update tray to reflect idle state
    setTrayText(`Idle (${Math.floor(idleSeconds / 60)}m)`);
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

  // Keep dock icon visible on macOS — the app has both tray and dock presence

  createTray();
  setupIPC();
  checkForUpdates();

  // Load projects for tray menu
  loadProjects();

  // Flush offline queue
  offlineQueue.flush(apiClient);

  // ── Early Screen Recording Permission Check (macOS) ──────────────────────
  // ALWAYS run the probe at launch to:
  // 1. Register the app in macOS Screen Recording list (so it appears in Settings)
  // 2. Verify permission is actually granted (persisted state can be stale after rebuild)
  // 3. Show onboarding dialog if permission is not granted
  if (process.platform === 'darwin') {
    // Always probe — even if systemPreferences says 'granted' or persisted state says true,
    // because rebuilding the app with same version changes the code signature.
    probeScreenRecordingPermission().then((probeGranted) => {
      if (probeGranted) {
        console.log('[Permission] Probe confirmed permission — no onboarding needed');
        _screenPermissionGranted = true;
        return;
      }
      console.log('[Permission] Screen recording NOT granted at launch — showing onboarding');
      _screenPermissionGranted = false;
      showScreenPermissionOnboarding({ isPreStart: false, wasTracking: false }).catch(() => {});
    }).catch(() => {
      // Probe failed — still show onboarding so user knows what to do
      _screenPermissionGranted = false;
      showScreenPermissionOnboarding({ isPreStart: false, wasTracking: false }).catch(() => {});
    });
  }

  // ── Restart State Auto-Resume ────────────────────────────────────────────
  // If the app was restarted after granting Screen Recording permission,
  // restore the previous project selection and optionally auto-start tracking.
  const restartState = loadRestartState();
  if (restartState) {
    console.log('[RestartState] Found restart state:', JSON.stringify(restartState));
    clearRestartState();
    // Restore project selection
    if (restartState.projectId) {
      saveLastProjectId(restartState.projectId);
    }
    // If the user was actively tracking before the restart, auto-start
    if (restartState.wasTracking && restartState.projectId) {
      console.log('[RestartState] Auto-resuming tracking for project:', restartState.projectId);
      // Delay slightly to ensure popup window has loaded
      setTimeout(async () => {
        try {
          const result = await startTimer(restartState.projectId);
          if (result.success) {
            console.log('[RestartState] Auto-resume successful');
            showPopup();
          } else {
            console.warn('[RestartState] Auto-resume failed:', result.error);
          }
        } catch (e) {
          console.error('[RestartState] Auto-resume error:', e.message);
        }
      }, 2000);
    } else {
      // Just show the popup with the project pre-selected
      showPopup();
    }
  }

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

  // ── Sleep / Wake / Lock / Unlock handling ──────────────────────────────────
  // When the OS suspends or the screen locks, we must stop capturing screenshots
  // and send a final heartbeat. On resume/unlock, if the sleep duration exceeds
  // the idle threshold, show the idle alert so the user can decide what to do
  // with the sleep time. Short sleeps resume tracking normally.

  let _suspendedAt = null;

  const handleSuspend = () => {
    if (!isTimerRunning) return;
    _suspendedAt = Date.now();
    console.log('[power] Suspended/locked — pausing capture');
    // Send final heartbeat to capture any pending activity data
    if (activityMonitor) {
      activityMonitor.sendFinalHeartbeat().catch(() => {});
      activityMonitor.stop();
    }
    screenshotService?.stop();
  };

  const handleResume = () => {
    if (!isTimerRunning || !_suspendedAt) {
      _suspendedAt = null;
      return;
    }
    const sleepDurationSec = Math.floor((Date.now() - _suspendedAt) / 1000);
    const sleepStartedAt = _suspendedAt;
    _suspendedAt = null;
    console.log(`[power] Resumed/unlocked after ${sleepDurationSec}s`);

    // Issue 6: If idleDetector is already in idle state (e.g. idle alert was showing
    // before sleep), preserve the original idleStartedAt. Just update the idle alert
    // display with the extended duration and return early.
    if (idleDetector?.isIdle && idleDetector.idleStartedAt) {
      const originalIdleStart = idleDetector.idleStartedAt;
      const totalIdleSec = Math.floor((Date.now() - originalIdleStart) / 1000);
      console.log(`[power] Already idle since ${new Date(originalIdleStart).toISOString()} — preserving original idle start, total idle: ${totalIdleSec}s`);
      showIdleAlert(totalIdleSec, originalIdleStart);
      return;
    }

    const idleThresholdSec = idleDetector?.idleTimeoutSec || (config.idle_timeout || 5) * 60;

    if (sleepDurationSec >= idleThresholdSec) {
      // Long sleep — treat as idle. Stop activity monitor (already stopped in suspend),
      // pause idle detector polling, and show the idle alert.
      idleDetector?.stop();
      const policy = config.keep_idle_time || 'prompt';
      if (policy === 'always') {
        // Auto-keep: just resume everything
        activityMonitor?.start();
        if (currentEntry) {
          screenshotService?.start(currentEntry.id, {
            immediateCapture: config.screenshot_capture_immediate_after_idle === true,
          });
        }
        idleDetector?.start();
        return;
      }
      if (policy === 'never') {
        // Set idleDetector state so handleIdleAction can read idleStartedAt
        if (idleDetector) {
          idleDetector.isIdle = true;
          idleDetector.idleStartedAt = sleepStartedAt;
        }
        // Auto-discard sleep time. handleIdleAction restarts activityMonitor
        // and screenshotService internally (P2-2 fix).
        handleIdleAction('discard', sleepDurationSec, null).catch((e) => {
          console.error('[power] Failed to discard sleep idle time:', e.message);
        });
        idleDetector?.start();
        return;
      }
      // Prompt user — show idle alert with sleep duration
      // Temporarily set idleDetector state so handleIdleAction can read idleStartedAt
      if (idleDetector) {
        idleDetector.isIdle = true;
        idleDetector.idleStartedAt = sleepStartedAt;
        idleDetector.alertShownAt = Date.now();
      }
      showIdleAlert(sleepDurationSec, sleepStartedAt);
    } else {
      // Short sleep — resume tracking normally
      activityMonitor?.start();
      if (currentEntry) {
        screenshotService?.start(currentEntry.id, {
          immediateCapture: false,
        });
      }
      // Restart idle detector (it was running before suspend)
      idleDetector?.start();
    }
  };

  powerMonitor.on('suspend', handleSuspend);
  powerMonitor.on('resume', handleResume);
  powerMonitor.on('lock-screen', handleSuspend);
  powerMonitor.on('unlock-screen', handleResume);

  // Start periodic sync between desktop and server
  startTimerSync();
}

function createTray() {
  if (tray) {
    return;
  }

  const icon = getTrayIcon(false);

  tray = new Tray(icon);
  tray.setToolTip('TrackFlow');

  // macOS: left-click toggles popup window visibility
  // Windows/Linux: left-click also toggles popup
  tray.on('click', () => {
    if (!isAuthenticated) {
      createLoginWindow();
      return;
    }

    // Toggle popup visibility
    if (popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible()) {
      popupWindow.hide();
    } else {
      showPopup();
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
      { label: 'Sign In to TrackFlow', click: () => createLoginWindow() },
      { type: 'separator' },
      { label: 'Quit TrackFlow', click: () => app.quit() },
    ]);
  }

  const template = [];

  // ── Status header ──────────────────────────────────────────────────────
  if (isTimerRunning && currentEntry) {
    const elapsed = _cachedStartedAtMs
      ? Math.floor((Date.now() - _cachedStartedAtMs) / 1000)
      : 0;
    const projectName = currentEntry.project?.name || 'No Project';
    template.push(
      { label: `Tracking: ${formatTimeShort(todayTotalCurrentProject + elapsed)}`, enabled: false },
      { label: `Project: ${projectName}`, enabled: false },
      { type: 'separator' }
    );
  } else {
    const totalLabel = todayTotalGlobal > 0
      ? `Today: ${formatTimeShort(todayTotalGlobal)}`
      : 'Not tracking';
    template.push(
      { label: totalLabel, enabled: false },
      { type: 'separator' }
    );
  }

  // ── Timer controls ─────────────────────────────────────────────────────
  if (isTimerRunning) {
    template.push({
      label: 'Stop Timer',
      click: () => stopTimer(),
    });
  } else {
    const projectItems = cachedProjects.map((p) => ({
      label: p.name,
      click: () => startTimer(p.id),
    }));

    if (projectItems.length > 0) {
      template.push({
        label: 'Start Timer',
        submenu: [
          { label: 'No Project', click: () => startTimer() },
          { type: 'separator' },
          ...projectItems,
        ],
      });
    } else {
      template.push({
        label: 'Start Timer',
        click: () => startTimer(),
      });
    }
  }

  template.push({ type: 'separator' });

  // ── Navigation ─────────────────────────────────────────────────────────
  template.push(
    { label: 'Open App Window', click: () => showPopup() },
    { label: 'Open Dashboard', click: () => openDashboardInBrowser() }
  );

  template.push({ type: 'separator' });

  // ── Account & app ──────────────────────────────────────────────────────
  template.push(
    {
      label: 'Sign Out',
      click: () => performLogout(),
    },
    { type: 'separator' },
    {
      label: 'Quit TrackFlow',
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
    backgroundColor: '#0a0a0a',   // Prevent white flash on all platforms
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

async function performLogout() {
  posthog.capture(currentEntry?.user_id || 'unknown', 'user_logged_out', {});

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

  // Update tray icon to idle state
  updateTrayIcon(false);
  setTrayText('');

  createLoginWindow();
}

// ── OS Theme Detection ─────────────────────────────────────────────────────
// Returns 'dark' or 'light' based on the OS preference.
function getOSTheme() {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

// Broadcast theme change to all open renderer windows.
function broadcastThemeChange() {
  const theme = getOSTheme();
  const windows = [popupWindow, loginWindow, idleAlertWindow];
  for (const win of windows) {
    if (win && !win.isDestroyed()) {
      win.webContents.send('theme-changed', theme);
    }
  }
}

// Listen for OS theme changes — fires when the user toggles dark/light mode
nativeTheme.on('updated', () => {
  broadcastThemeChange();
});

function setupIPC() {
  // Remove previous handlers to avoid duplicate registration
  ipcMain.removeHandler('get-theme');
  ipcMain.removeHandler('get-timer-state');
  ipcMain.removeHandler('start-timer');
  ipcMain.removeHandler('stop-timer');
  ipcMain.removeHandler('get-projects');
  ipcMain.removeHandler('get-last-project');
  ipcMain.removeHandler('set-last-project');
  ipcMain.removeHandler('logout');
  ipcMain.removeHandler('open-dashboard');
  ipcMain.removeHandler('check-screen-permission');
  ipcMain.removeHandler('request-screen-permission');

  ipcMain.handle('check-screen-permission', async () => {
    if (process.platform !== 'darwin') return { granted: true, platform: process.platform };
    const granted = checkScreenRecordingPermission();
    if (!granted) {
      // Probe to both register the app and do a real permission check
      const probeGranted = await probeScreenRecordingPermission();
      return { granted: probeGranted, platform: 'darwin' };
    }
    return { granted, platform: 'darwin' };
  });

  ipcMain.handle('request-screen-permission', async () => {
    if (process.platform !== 'darwin') return { granted: true };
    // Probe first so TrackFlow appears in the Screen Recording list
    await probeScreenRecordingPermission();
    const result = await showScreenPermissionOnboarding({ isPreStart: true, wasTracking: isTimerRunning });
    return { result, granted: _screenPermissionGranted === true };
  });

  ipcMain.handle('get-theme', () => {
    return getOSTheme();
  });

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

  ipcMain.handle('get-last-project', () => {
    return loadLastProjectId();
  });

  ipcMain.handle('set-last-project', (_, projectId) => {
    saveLastProjectId(projectId);
  });

  ipcMain.handle('logout', async () => {
    return await performLogout();
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
  if (!apiClient || !currentEntry) {
    console.error('[afterStartTimer] ABORTED: apiClient or currentEntry is null', { apiClient: !!apiClient, currentEntry: !!currentEntry });
    return;
  }
  console.log(`[afterStartTimer] Running for entry=${currentEntry.id}, project=${projectIdForTotal}`);
  (async () => {
    try {
      todayTotalGlobal = await apiClient.getTodayTotal(null);
    } catch {
      todayTotalGlobal = todayTotalForPopup;
    }
    try {
      activityMonitor.start();
      console.log('[afterStartTimer] activityMonitor started');
    } catch (e) {
      console.error('[afterStartTimer] activityMonitor.start() CRASHED:', e.message);
    }
    try {
      console.log(`[afterStartTimer] Calling screenshotService.start(${currentEntry.id})`);
      screenshotService.start(currentEntry.id);
      console.log('[afterStartTimer] screenshotService started');
    } catch (e) {
      console.error('[afterStartTimer] screenshotService.start() CRASHED:', e.message, e.stack);
    }
    try {
      idleDetector?.start();
    } catch (e) {
      console.error('[afterStartTimer] idleDetector.start() CRASHED:', e.message);
    }
    startTrayTimer();
    updateTrayIcon(true);
  })();
}

async function startTimer(projectId = null) {
  if (isTimerRunning) return { error: 'Timer already running' };

  // ── Pre-start permission gate (macOS only) ──────────────────────────────
  // Check screen recording permission BEFORE starting the timer so the user
  // is not surprised by a permission prompt mid-tracking.
  if (process.platform === 'darwin' && _screenPermissionGranted !== true) {
    checkScreenRecordingPermission();
    if (!_screenPermissionGranted) {
      // Probe desktopCapturer so TrackFlow registers in the Screen Recording
      // list before we direct the user to System Settings.
      const probeGranted = await probeScreenRecordingPermission();
      if (probeGranted) {
        console.log('[Timer] Probe confirmed permission — proceeding with timer start');
      } else {
        console.log('[Timer] Screen recording permission not granted — showing onboarding');
        const permResult = await showScreenPermissionOnboarding({
          isPreStart: true,
          wasTracking: false,
        });
        if (permResult === 'opened-settings') {
          // User went to settings — don't start timer yet. They need to restart.
          return { error: 'Please grant Screen Recording permission and restart the app. Your project selection will be remembered.' };
        }
        // User clicked "Skip for Now" — let them track without screenshots
        console.log('[Timer] User skipped permission — starting timer without screenshot capability');
        // Notify renderer that permission is not granted so it can show a warning
        notifyPopup('permission-status', { granted: false });
      }
    }
  }

  try {
    const result = await apiClient.startTimer(projectId);
    currentEntry = result.entry;
    _cachedStartedAtMs = currentEntry?.started_at ? new Date(currentEntry.started_at).getTime() : null;
    isTimerRunning = true;
    todayTotalCurrentProject = result.today_total ?? 0;
    posthog.capture(currentEntry?.user_id || 'unknown', 'timer_started', { project_id: projectId });

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
  const stoppedEntryId = currentEntry?.id || null;
  const isZeroDurationEntry = sessionElapsed < MIN_ENTRY_DURATION_SEC;
  const localStoppedProjectTotal = todayTotalCurrentProject + sessionElapsed;
  posthog.capture(currentEntry?.user_id || 'unknown', 'timer_stopped', {});

  dismissIdleAlert();

  // Send final heartbeat BEFORE stopping — captures last 0-29s of activity data
  // This is critical: without it, 10-50% of activity in short sessions is lost
  // Skip heartbeat for zero-duration entries — there is no meaningful activity data.
  if (activityMonitor && !isZeroDurationEntry) {
    activityMonitor.sendFinalHeartbeat().catch(() => {});
  }

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
    // BUG-001: If the entry had near-zero duration (artifact from idle split),
    // delete it from the server to keep the timesheet clean.
    if (isZeroDurationEntry && stoppedEntryId) {
      try {
        await apiClient.deleteTimeEntry(stoppedEntryId);
        console.log(`[Timer] Deleted zero-duration entry ${stoppedEntryId} (${sessionElapsed}s)`);
      } catch (e) {
        console.warn('[Timer] Failed to delete zero-duration entry:', e.message);
      }
    }
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
let _configRefetchCycle = 0;
function startTimerSync() {
  if (timerSyncInterval) clearInterval(timerSyncInterval);
  _configRefetchCycle = 0;
  timerSyncInterval = setInterval(async () => {
    if (!apiClient) return;

    // Re-fetch org config every 10th cycle (~5 minutes at 30s interval)
    _configRefetchCycle++;
    if (_configRefetchCycle >= 10) {
      _configRefetchCycle = 0;
      try {
        const freshConfig = await apiClient.getConfig();
        config = { ...DEFAULT_CONFIG, ...freshConfig };
        idleDetector?.updateConfig(config);
        console.log('[Config] Re-fetched org config');
      } catch (e) {
        // Silent failure — keep using existing config
      }
    }

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
  try {
    const icon = getTrayIcon(running);
    tray.setImage(icon);
  } catch (e) {
    console.warn('[Tray] Failed to update icon:', e.message);
  }
  tray.setToolTip(running ? 'TrackFlow - Timer Running' : 'TrackFlow');
}

// Cross-platform tray text:
//   macOS: tray.setTitle() shows text next to icon in menu bar
//            Uses ANSI escape codes to color the timer green when tracking
//   Windows/Linux: tray.setTitle() is not visible — use tooltip instead
function setTrayText(text) {
  if (!tray) return;
  if (process.platform === 'darwin') {
    if (text && isTimerRunning) {
      // ANSI RGB escape: green (#22c55e = rgb(34,197,94)) when actively tracking
      tray.setTitle(`\x1b[38;2;34;197;94m${text}\x1b[0m`, { fontType: 'monospacedDigit' });
    } else {
      // Default system color when stopped / no text
      tray.setTitle(text, { fontType: 'monospacedDigit' });
    }
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
    const totalSeconds = todayTotalCurrentProject + currentElapsed;
    const formatted = formatTimeShort(totalSeconds);
    setTrayText(formatted);
    // Broadcast the same computed time to the renderer so both displays are in perfect sync
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.webContents.send('timer-tick', { totalSeconds, formatted });
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

// ── Idle Alert System ────────────────────────────────────────────────────────

async function showIdleAlert(idleSeconds, idleStartedAt) {
  if (idleAlertWindow && !idleAlertWindow.isDestroyed()) {
    // Alert already showing — bring it to front and update idle data
    idleAlertWindow.focus();
    if (typeof idleAlertWindow.moveTop === 'function') {
      idleAlertWindow.moveTop();
    }
    idleAlertWindow.webContents.send('idle-data', {
      idleStartedAt,
      idleSeconds,
      autoStopTotalSec: idleDetector ? (idleDetector.idleTimeoutSec + idleDetector.alertAutoStopSec) : 0,
      projects: cachedProjects || [],
    });
    return;
  }
  if (!isTimerRunning) return;

  screenshotService?.stop();

  // Play system notification sound to alert the user they are idle
  try {
    if (Notification.isSupported()) {
      const idleNotification = new Notification({
        title: 'TrackFlow',
        body: `You've been idle for ${Math.floor(idleSeconds / 60)} minutes`,
        silent: false, // Enables the default system notification sound
      });
      idleNotification.show();
      setTimeout(() => { try { idleNotification.close(); } catch {} }, 5000);
    }
  } catch {}

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
    backgroundColor: '#0a0a0a',   // Prevent white flash on all platforms
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
      autoStopTotalSec: idleDetector ? (idleDetector.idleTimeoutSec + idleDetector.alertAutoStopSec) : 0,
      projects: cachedProjects || [],
    });
  });

  idleAlertWindow.on('closed', () => {
    idleAlertWindow = null;
  });

}

function dismissIdleAlert() {
  if (idleAlertWindow && !idleAlertWindow.isDestroyed()) {
    idleAlertWindow.destroy();
  }
  idleAlertWindow = null;
}

async function handleIdleAction(action, idleDurationOverride = null, reassignProjectId = null) {
  const idleDuration = idleDurationOverride || idleDetector?.getIdleDuration() || 0;
  const idleStartedAt = idleDetector?.idleStartedAt || null;

  posthog.capture(null, 'idle_action', { action, idle_seconds: idleDuration });

  idleDetector?.resolveIdle();

  // Restore tray tooltip from idle state back to normal
  updateTrayIcon(isTimerRunning);
  if (isTimerRunning) updateTrayTitle();

  switch (action) {
    case 'keep':
      // Resume activity monitor and screenshots — idle is over
      activityMonitor?.start();
      if (isTimerRunning && currentEntry) {
        screenshotService?.start(currentEntry.id, {
          immediateCapture: config.screenshot_capture_immediate_after_idle === true,
        });
      }
      idleDetector?.start();
      startTrayTimer();
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
          // Queue for offline retry so idle time is eventually deducted
          offlineQueue?.add('idle_discard', {
            time_entry_id: currentEntry?.id,
            idle_started_at: new Date(idleStartedAt).toISOString(),
            idle_ended_at: new Date().toISOString(),
            idle_seconds: idleDuration,
            action: action,
            project_id: reassignProjectId || null,
          });
        }
      }
      // Resume activity monitor and screenshots — idle is over
      activityMonitor?.start();
      if (isTimerRunning && currentEntry) {
        screenshotService?.start(currentEntry.id, {
          immediateCapture: config.screenshot_capture_immediate_after_idle === true,
        });
      }
      idleDetector?.start();
      startTrayTimer();
      break;

    case 'stop':
      // P1-2: Deduct idle time BEFORE stopping the timer.
      // reportIdleTime creates a new running entry on the server (started_at = now).
      // Since we are stopping immediately, that new entry will have zero duration.
      // We must: (1) report idle to deduct the idle period from the tracked entry,
      // (2) stop the newly-created entry, (3) delete the zero-duration entry
      // to avoid polluting the time sheet.
      if (apiClient && currentEntry && idleStartedAt) {
        try {
          const idleResult = await apiClient.reportIdleTime({
            time_entry_id: currentEntry.id,
            idle_started_at: new Date(idleStartedAt).toISOString(),
            idle_ended_at: new Date().toISOString(),
            idle_seconds: idleDuration,
            action: 'discard',
          });
          // Update local state to the new entry so stopTimer() closes it
          if (idleResult?.new_entry) {
            currentEntry = idleResult.new_entry;
            _cachedStartedAtMs = currentEntry?.started_at ? new Date(currentEntry.started_at).getTime() : null;
          }
        } catch (e) {
          console.error('Failed to discard idle time before stop:', e.message);
          offlineQueue?.add('idle_discard', {
            time_entry_id: currentEntry?.id,
            idle_started_at: new Date(idleStartedAt).toISOString(),
            idle_ended_at: new Date().toISOString(),
            idle_seconds: idleDuration,
            action: 'discard',
          });
        }
      }
      // stopTimer() now detects entries shorter than MIN_ENTRY_DURATION_SEC
      // and auto-deletes them from the server (BUG-001 fix).
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
    backgroundColor: '#0a0a0a',
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
        const status = e.response?.status;
        const serverMsg = e.response?.data?.message;

        // Friendly error messages for common cases
        if (serverMsg) {
          return { error: serverMsg };
        } else if (e.code === 'ENOTFOUND' || e.code === 'ERR_NETWORK') {
          return { error: 'Cannot reach the server. Please check your internet connection.' };
        } else if (e.code === 'ECONNREFUSED') {
          return { error: 'Server is not responding. Please try again later.' };
        } else if (e.code === 'ETIMEDOUT' || e.code === 'ECONNABORTED') {
          return { error: 'Connection timed out. Please try again.' };
        } else if (status === 404) {
          return { error: 'Server endpoint not found. Please update the app.' };
        } else {
          return { error: e.message || 'Login failed. Please try again.' };
        }
      }
    });
  }
}

function checkForUpdates() {
  console.log(`[updater] Checking... (packaged=${app.isPackaged}, env=${process.env.NODE_ENV || 'production'})`);
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    console.log('[updater] Skipped — dev mode or not packaged');
    return;
  }
  try {
    // For private GitHub repos, electron-updater needs a GH_TOKEN
    if (process.env.GH_TOKEN) {
      autoUpdater.requestHeaders = { Authorization: `token ${process.env.GH_TOKEN}` };
    }

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null; // Suppress default electron-updater logging (we do our own)

    // Track whether an update is ready to install
    let _pendingUpdate = false;

    autoUpdater.on('update-available', (info) => {
      console.log(`[updater] Update available: v${info.version}`);
      posthog.capture(null, 'auto_update_available', { new_version: info.version });
    });
    autoUpdater.on('update-downloaded', (info) => {
      console.log(`[updater] Update downloaded: v${info.version} — will install on quit`);
      _pendingUpdate = true;
      posthog.capture(null, 'auto_update_downloaded', { new_version: info.version });
      try {
        const notification = new Notification({
          title: 'TrackFlow Update Ready',
          body: `Version ${info.version} downloaded. Click to restart and update.`,
          silent: false,
        });
        notification.on('click', () => {
          console.log('[updater] User clicked notification — installing update now');
          autoUpdater.quitAndInstall(false, true);
        });
        notification.show();
      } catch {}
    });
    autoUpdater.on('update-not-available', (info) => {
      console.log(`[updater] Already on latest version (v${info.version})`);
    });
    autoUpdater.on('error', (err) => {
      console.warn(`[updater] Error: ${err?.message || err}`);
      posthog.captureError(null, err || new Error('auto_update_error'), { type: 'auto_update' });
    });

    // When app is about to quit, force-install the update if one is pending
    // This is the belt-and-suspenders fix: autoInstallOnAppQuit should handle it,
    // but on ad-hoc signed macOS apps it silently fails. This explicit call ensures
    // the update is actually applied.
    app.on('before-quit', () => {
      if (_pendingUpdate) {
        console.log('[updater] App quitting — installing pending update');
        try {
          autoUpdater.quitAndInstall(false, true);
        } catch (e) {
          console.error('[updater] quitAndInstall failed:', e.message);
        }
      }
    });

    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  } catch {
    // autoUpdater not configured — skip silently
  }
}

// Auto-start on login — only set if packaged (don't interfere with dev)
if (app.isPackaged) {
  app.setLoginItemSettings({ openAtLogin: true });
}
