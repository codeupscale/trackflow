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
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');
const ApiClient = require('./api-client');
const ActivityMonitor = require('./activity-monitor');
const ScreenshotService = require('./screenshot-service');
const IdleDetector = require('./idle-detector');
const { IDLE_STATE } = require('./idle-detector');
const OfflineQueue = require('./offline-queue');
const NetworkMonitor = require('./network-monitor');
const { getToken, setToken, getRefreshToken, setRefreshToken, deleteToken } = require('./keychain');
const posthog = require('./posthog');
const { getTrayIcon, warmIconCache } = require('./tray-icons');

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

// ── Always-on-Top (Pin) Persistence ──────────────────────────────────────────
// Persists the "always on top" / "pin" state so it survives app restarts.
// Uses the same user-prefs.json file as lastSelectedProjectId.
function loadAlwaysOnTop() {
  try {
    const p = getPrefsPath();
    if (!p || !fs.existsSync(p)) return true; // default: pinned
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return data.alwaysOnTop !== undefined ? !!data.alwaysOnTop : true;
  } catch {
    return true;
  }
}

function saveAlwaysOnTop(pinned) {
  try {
    const p = getPrefsPath();
    if (!p) return;
    let data = {};
    if (fs.existsSync(p)) {
      try { data = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { data = {}; }
    }
    data.alwaysOnTop = !!pinned;
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save always-on-top state:', e);
  }
}

let isAlwaysOnTop = true; // will be loaded from prefs in app.whenReady

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

// Get the modification time of the app's main executable / directory.
// On macOS, rebuilding the app changes __dirname's mtime even when the
// version string stays the same. Comparing this value detects ad-hoc
// rebuilds that invalidate Screen Recording permission.
function getAppBinaryMtime() {
  try {
    // In packaged builds, use the app's executable path
    // In dev, use __dirname (src/main/) which changes on rebuild
    const targetPath = app.isPackaged ? app.getPath('exe') : __dirname;
    const stat = fs.statSync(targetPath);
    return stat.mtimeMs;
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
    // Invalidate if the app binary has been rebuilt since permission was confirmed.
    // On macOS, ad-hoc signed rebuilds change the code signature and macOS
    // silently revokes Screen Recording permission.
    if (process.platform === 'darwin' && data.appBinaryMtime != null) {
      const currentMtime = getAppBinaryMtime();
      if (currentMtime != null && currentMtime !== data.appBinaryMtime) {
        console.log(`[Permission] App binary changed since permission was confirmed (stored=${data.appBinaryMtime}, current=${currentMtime}) — re-probing`);
        return null;
      }
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
      appBinaryMtime: getAppBinaryMtime(),
    };
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
    console.log(`[Permission] Saved screen permission state: granted=${granted}, mtime=${data.appBinaryMtime}`);
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
let networkMonitor = null;
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
// Idle action mutex — prevents double-action from auto-stop + user click race
let _idleActionInProgress = false;
// Cache parsed started_at timestamp to avoid re-parsing every second
let _cachedStartedAtMs = null;
// M8 FIX: Clock skew compensation — server time minus local time
let _clockOffsetMs = 0;
// Local-first timer: suspend timestamp for sleep/wake gap calculation
let _suspendedAt = null;

// ── Local Timer State (SQLite) ──────────────────────────────────────────────
// Persists timer state locally so no time is lost during network outages.
// Uses the same offline-queue.db via a lazy-initialized reference.
let _localTimerDb = null;

function _getLocalTimerDb() {
  if (_localTimerDb) return _localTimerDb;
  try {
    const Database = require('better-sqlite3');
    const dbPath = path.join(app.getPath('userData'), 'offline-queue.db');
    _localTimerDb = new Database(dbPath);
    _localTimerDb.pragma('journal_mode = WAL');
    _localTimerDb.pragma('busy_timeout = 5000');

    // Create timer_sessions table for local-first timer state
    _localTimerDb.exec(`
      CREATE TABLE IF NOT EXISTS timer_sessions (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        project_id TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        duration_seconds INTEGER,
        synced_start INTEGER NOT NULL DEFAULT 0,
        synced_stop INTEGER NOT NULL DEFAULT 0,
        server_entry_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    return _localTimerDb;
  } catch (e) {
    console.error('[LocalTimerDb] Init failed:', e.message);
    return null;
  }
}

function generateIdempotencyKey() {
  return crypto.randomUUID();
}

function saveLocalTimerStart(id, idempotencyKey, projectId, startedAt) {
  const db = _getLocalTimerDb();
  if (!db) return;
  try {
    db.prepare(
      'INSERT OR REPLACE INTO timer_sessions (id, idempotency_key, project_id, started_at) VALUES (?, ?, ?, ?)'
    ).run(id, idempotencyKey, projectId, startedAt);
  } catch (e) {
    console.error('[LocalTimerDb] saveStart failed:', e.message);
  }
}

function markLocalTimerStartSynced(localId, serverEntryId) {
  const db = _getLocalTimerDb();
  if (!db) return;
  try {
    db.prepare(
      'UPDATE timer_sessions SET synced_start = 1, server_entry_id = ? WHERE id = ?'
    ).run(serverEntryId, localId);
  } catch (e) {
    console.error('[LocalTimerDb] markStartSynced failed:', e.message);
  }
}

function saveLocalTimerStop(localId, endedAt, durationSeconds) {
  const db = _getLocalTimerDb();
  if (!db) return;
  try {
    db.prepare(
      'UPDATE timer_sessions SET ended_at = ?, duration_seconds = ? WHERE id = ?'
    ).run(endedAt, durationSeconds, localId);
  } catch (e) {
    console.error('[LocalTimerDb] saveStop failed:', e.message);
  }
}

function markLocalTimerStopSynced(localId) {
  const db = _getLocalTimerDb();
  if (!db) return;
  try {
    db.prepare('UPDATE timer_sessions SET synced_stop = 1 WHERE id = ?').run(localId);
  } catch (e) {
    console.error('[LocalTimerDb] markStopSynced failed:', e.message);
  }
}

function getUnsyncedTimerSessions() {
  const db = _getLocalTimerDb();
  if (!db) return [];
  try {
    return db.prepare(
      'SELECT * FROM timer_sessions WHERE synced_start = 0 OR (ended_at IS NOT NULL AND synced_stop = 0) ORDER BY created_at ASC'
    ).all();
  } catch (e) {
    console.error('[LocalTimerDb] getUnsynced failed:', e.message);
    return [];
  }
}

function getActiveLocalTimer() {
  const db = _getLocalTimerDb();
  if (!db) return null;
  try {
    return db.prepare(
      'SELECT * FROM timer_sessions WHERE ended_at IS NULL ORDER BY created_at DESC LIMIT 1'
    ).get() || null;
  } catch (e) {
    console.error('[LocalTimerDb] getActive failed:', e.message);
    return null;
  }
}

function cleanOldLocalTimerSessions() {
  const db = _getLocalTimerDb();
  if (!db) return;
  try {
    // Remove fully synced sessions older than 7 days
    db.prepare(
      "DELETE FROM timer_sessions WHERE synced_start = 1 AND synced_stop = 1 AND created_at < datetime('now', '-7 days')"
    ).run();
  } catch (e) {
    console.error('[LocalTimerDb] cleanup failed:', e.message);
  }
}

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
  // In dev mode, auto-show the popup so CDP remote debugging can connect to it
  if (process.env.NODE_ENV === 'development') {
    setTimeout(() => showPopup(), 500);
  }
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
    // LOCAL-FIRST: Record stop locally before attempting server stop
    const localId = currentEntry?._localId;
    if (localId) {
      saveLocalTimerStop(localId, new Date().toISOString(), 0);
    }
    try {
      const stopPayload = currentEntry?._localId
        ? { started_at: currentEntry?.started_at, ended_at: new Date().toISOString() }
        : {};
      await Promise.race([
        apiClient.stopTimer(stopPayload),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
      if (localId) markLocalTimerStopSynced(localId);
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

// CLEANUP-FIX: Remove powerMonitor and app listeners that reference stale apiClient/services.
// Called from both forceLogout and performLogout to prevent stale callback crashes.
function removeSessionListeners() {
  powerMonitor.removeAllListeners('suspend');
  powerMonitor.removeAllListeners('resume');
  powerMonitor.removeAllListeners('lock-screen');
  powerMonitor.removeAllListeners('unlock-screen');
  app.removeAllListeners('browser-window-focus');
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
  networkMonitor?.stop();
  removeSessionListeners();
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
  networkMonitor = null;
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

  // Load persisted always-on-top preference
  isAlwaysOnTop = loadAlwaysOnTop();

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
  screenshotService.setWallpaperDetectedCallback(() => {
    console.log('[Permission] Wallpaper-only capture detected — notifying renderer');
    notifyPopup('screenshot-permission-issue', {
      type: 'wallpaper-detected',
      message: 'Screenshots may only show your wallpaper. Screen Recording permission needs to be refreshed.',
    });
  });
  idleDetector = new IdleDetector(config);

  // Initialize network monitor for online/offline detection
  networkMonitor = new NetworkMonitor();
  networkMonitor.on('online', async () => {
    console.log('[Network] Back online — reconciling and flushing');
    // Reconcile local timer state with server before flushing queue
    await reconcileTimerState();
    offlineQueue?.flush(apiClient);
    // Notify renderer of status change
    notifyPopup('network-status', { online: true });
  });
  networkMonitor.on('offline', () => {
    console.log('[Network] Gone offline');
    notifyPopup('network-status', { online: false });
  });
  networkMonitor.start();

  // Wire idle detection events
  idleDetector.onIdleDetected((idleSeconds, idleStartedAt, actionId) => {
    // Pause both screenshot and activity capture during idle.
    // This prevents zero-event heartbeats from dragging down the activity score.
    screenshotService?.stop();
    activityMonitor?.stop();
    stopTrayTimer();
    const policy = config.keep_idle_time || 'prompt';
    if (policy === 'always') {
      idleDetector.resolveIdle(actionId);
      idleDetector.start();
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
      handleIdleAction('discard', actionId, idleSeconds, null);
      dismissIdleAlert();
      return;
    }
    // Update tray to reflect idle state
    setTrayText(`Idle (${Math.floor(idleSeconds / 60)}m)`);
    showIdleAlert(idleSeconds, idleStartedAt, actionId);
  });

  idleDetector.onAutoStop((totalIdleSeconds, actionId) => {
    handleIdleAction('stop', actionId, totalIdleSeconds);
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

  // Load projects for tray menu, then notify the popup renderer
  loadProjects().then(() => {
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.webContents.send('projects-ready');
    }
  });

  // L7: Clean up orphaned screenshot files on startup
  offlineQueue.cleanupOrphanedFiles();

  // Flush offline queue (L7: orphan cleanup also runs after each successful flush)
  offlineQueue.flush(apiClient);

  // ── Early Screen Recording Permission Check (macOS) ──────────────────────
  // Check if permission is granted using systemPreferences API first.
  // Only probe desktopCapturer when permission is NOT granted (to register
  // the app in the macOS Screen Recording list). Probing when permission IS
  // granted triggers an unnecessary native macOS popup dialog.
  if (process.platform === 'darwin') {
    const apiStatus = checkScreenRecordingPermission();
    if (apiStatus) {
      // systemPreferences says granted — trust it, no probe needed.
      // This avoids the native macOS "TrackFlow would like to record" popup.
      console.log('[Permission] Screen recording granted (API) — skipping probe');
      _screenPermissionGranted = true;
    } else {
      // Not granted — probe to register app in System Settings list,
      // then show onboarding dialog.
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
        _screenPermissionGranted = false;
        showScreenPermissionOnboarding({ isPreStart: false, wasTracking: false }).catch(() => {});
      });
    }
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
      // BUG-1 FIX: Use project_today_total from the same atomic response to avoid race conditions
      const projectTotal = status.project_today_total ?? globalTotal;
      todayTotalCurrentProject = Math.max(0, projectTotal - elapsed);
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
  // Snapshot returned by idleDetector.suspend() — tells handleResume whether
  // the user was already idle when the lid closed.
  let _idleStateAtSuspend = null;

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
    // Suspend idle detector — clears intervals but preserves state snapshot.
    // This prevents _check() from firing on resume before handleResume runs.
    _idleStateAtSuspend = idleDetector?.suspend() || null;
  };

  const handleResume = () => {
    if (!isTimerRunning || !_suspendedAt) {
      _suspendedAt = null;
      _idleStateAtSuspend = null;
      return;
    }
    const sleepDurationSec = Math.floor((Date.now() - _suspendedAt) / 1000);
    const sleepStartedAt = _suspendedAt;
    _suspendedAt = null;
    const idleSnap = _idleStateAtSuspend;
    _idleStateAtSuspend = null;
    console.log(`[power] Resumed/unlocked after ${sleepDurationSec}s`);

    // Tell the detector we are resuming (transitions from SUSPENDED to STOPPED)
    idleDetector?.resume();

    // Issue 6: If idleDetector was already showing an alert when suspend fired,
    // preserve the original idleStartedAt and extend the popup display.
    if (idleSnap?.isIdle && idleSnap.idleStartedAt) {
      const originalIdleStart = idleSnap.idleStartedAt;
      const totalIdleSec = Math.floor((Date.now() - originalIdleStart) / 1000);
      console.log(`[power] Already idle since ${new Date(originalIdleStart).toISOString()} — preserving original idle start, total idle: ${totalIdleSec}s`);
      // Use setAlertState to properly transition to ALERTING with auto-stop checking
      const actionId = idleDetector?.setAlertState(originalIdleStart) || 0;
      showIdleAlert(totalIdleSec, originalIdleStart, actionId);
      return;
    }

    const idleThresholdSec = idleDetector?.idleTimeoutSec || (config.idle_timeout || 5) * 60;

    if (sleepDurationSec >= idleThresholdSec) {
      // Long sleep — treat as idle.
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
        // Use setAlertState so handleIdleAction can read idleStartedAt properly
        const actionId = idleDetector?.setAlertState(sleepStartedAt) || 0;
        // Auto-discard sleep time. handleIdleAction restarts activityMonitor
        // and screenshotService internally.
        handleIdleAction('discard', actionId, sleepDurationSec, null).catch((e) => {
          console.error('[power] Failed to discard sleep idle time:', e.message);
        });
        return;
      }
      // Prompt user — show idle alert with sleep duration
      const actionId = idleDetector?.setAlertState(sleepStartedAt) || 0;
      showIdleAlert(sleepDurationSec, sleepStartedAt, actionId);
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

    // After any resume: flush offline queue if online (sync any pending data)
    if (networkMonitor?.isOnline && offlineQueue && apiClient) {
      setImmediate(() => {
        reconcileTimerState().then(() => offlineQueue.flush(apiClient)).catch(() => {});
      });
    }
  };

  // M4 FIX: Remove existing listeners defensively before adding to prevent stacking on re-login
  powerMonitor.removeAllListeners('suspend');
  powerMonitor.removeAllListeners('resume');
  powerMonitor.removeAllListeners('lock-screen');
  powerMonitor.removeAllListeners('unlock-screen');
  powerMonitor.on('suspend', handleSuspend);
  powerMonitor.on('resume', handleResume);
  powerMonitor.on('lock-screen', handleSuspend);
  powerMonitor.on('unlock-screen', handleResume);

  // ── Instant sync on focus / unlock ──────────────────────────────────────
  // When the user returns to the app (unlock, focus), trigger an immediate
  // sync so the UI updates within ~1s instead of waiting up to 10s for the
  // next polling cycle.
  const triggerImmediateSync = () => {
    if (!apiClient) return;
    // Re-use the same sync logic as startTimerSync but fire once immediately
    (async () => {
      try {
        const status = await apiClient.getTimerStatus();
        const globalTotal = status.today_total ?? 0;
        const elapsed = status.elapsed_seconds ?? 0;
        if (status.running) {
          todayTotalGlobal = Math.max(0, globalTotal - elapsed);
          // BUG-1 FIX: Use project_today_total from the same atomic response
          const projectTotal = status.project_today_total ?? globalTotal;
          todayTotalCurrentProject = Math.max(0, projectTotal - elapsed);
        } else {
          todayTotalGlobal = globalTotal;
          todayTotalCurrentProject = 0;
        }

        if (status.running && !isTimerRunning) {
          isTimerRunning = true;
          currentEntry = status.entry;
          _cachedStartedAtMs = currentEntry?.started_at ? new Date(currentEntry.started_at).getTime() : null;
          activityMonitor?.start();
          screenshotService?.start(currentEntry.id);
          idleDetector?.start();
          startTrayTimer();
          updateTrayIcon(true);
          notifyPopup('timer-started', { ...currentEntry, todayTotal: todayTotalCurrentProject });
        } else if (!status.running && isTimerRunning) {
          // BUG-2 FIX: Don't override local state while idle alert is showing
          if (idleDetector?.isIdleActive()) {
            console.log('[ImmediateSync] Server says stopped but idle alert is active — keeping local state');
            return;
          }
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
    })();
  };

  app.on('browser-window-focus', triggerImmediateSync);

  // Start periodic sync between desktop and server
  startTimerSync();
}

function createTray() {
  if (tray) {
    return;
  }

  // L5: Pre-generate both tracking/idle icons into the cache
  warmIconCache();
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
    { label: 'Open Dashboard', click: () => openDashboardInBrowser() },
    {
      label: 'Always on Top',
      type: 'checkbox',
      checked: isAlwaysOnTop,
      click: (menuItem) => {
        isAlwaysOnTop = menuItem.checked;
        if (popupWindow && !popupWindow.isDestroyed()) {
          _applyAlwaysOnTop(popupWindow, isAlwaysOnTop);
          popupWindow.webContents.send('pin-state-changed', { pinned: isAlwaysOnTop });
        }
        saveAlwaysOnTop(isAlwaysOnTop);
        console.log(`[Pin] Always on top (tray): ${isAlwaysOnTop}`);
      },
    }
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

/**
 * Apply always-on-top state to a BrowserWindow.
 * On macOS, uses 'floating' level (NSFloatingWindowLevel) so the window
 * stays above normal app windows. moveTop() is called every 300ms to keep
 * the window at the front of its level — this is needed because Electron 28
 * on macOS Sequoia loses z-order after another app gains focus even when
 * isAlwaysOnTop() still returns true.
 */
// Interval reference for the pin keepalive (macOS workaround)
let _pinKeepalive = null;

function _applyAlwaysOnTop(win, pinned) {
  if (!win || win.isDestroyed()) return;

  // Clear any existing keepalive
  if (_pinKeepalive) {
    clearInterval(_pinKeepalive);
    _pinKeepalive = null;
  }

  if (pinned) {
    // 'floating' = NSFloatingWindowLevel — sits above all normal app windows.
    // relativeLevel 1 puts it one layer above other floating windows.
    win.setAlwaysOnTop(true, 'floating', 1);
    win.moveTop();
    console.log(`[Pin] setAlwaysOnTop(true,'floating',1) + moveTop(). isAlwaysOnTop()=${win.isAlwaysOnTop()}`);

    // macOS Sequoia + Electron 28 regression: the window visually slips
    // behind other apps after focus changes even though isAlwaysOnTop()
    // returns true. Re-assert the level and call moveTop() every 300ms.
    // NOTE: we do NOT toggle off→on here — that creates a gap where another
    // window can jump in. We only re-assert the true state.
    _pinKeepalive = setInterval(() => {
      if (!win || win.isDestroyed() || !isAlwaysOnTop) {
        clearInterval(_pinKeepalive);
        _pinKeepalive = null;
        return;
      }
      win.setAlwaysOnTop(true, 'floating', 1);
      win.moveTop();
    }, 300);
  } else {
    win.setAlwaysOnTop(false);
    console.log(`[Pin] setAlwaysOnTop(false) called. isAlwaysOnTop()=${win.isAlwaysOnTop()}`);
  }
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
        // Also signal the renderer to reload projects in case they were
        // empty from a previous failed load (e.g. token refresh race on startup)
        popupWindow.webContents.send('projects-ready');
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
    show: false,
    backgroundColor: '#0a0a0a',   // Prevent white flash on all platforms
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: true,
    },
  });

  // Apply always-on-top AFTER window creation (not in constructor options).
  // On macOS, use 'floating' level + relativeLevel 1 for reliable z-order.
  _applyAlwaysOnTop(popupWindow, isAlwaysOnTop);

  popupWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  popupWindow.once('ready-to-show', () => {
    popupWindow.show();
    if (process.env.NODE_ENV === 'development') {
      popupWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  // After the renderer finishes loading, ensure projects are loaded and
  // send projects-ready + sync-timer signals. This fixes the race where
  // the renderer's own loadProjects() fires before the API client has a
  // valid token (e.g. after logout/re-login or password reset).
  popupWindow.webContents.once('did-finish-load', () => {
    loadProjects().then(() => {
      if (popupWindow && !popupWindow.isDestroyed()) {
        popupWindow.webContents.send('projects-ready');
        popupWindow.webContents.send('sync-timer');
      }
    });
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
  networkMonitor?.stop();
  removeSessionListeners();
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
  networkMonitor = null;
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
  ipcMain.removeHandler('open-screen-recording-settings');
  ipcMain.removeHandler('hide-window');
  ipcMain.removeHandler('toggle-pin');
  ipcMain.removeHandler('get-pin-state');
  ipcMain.removeHandler('install-update');

  ipcMain.handle('hide-window', () => {
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.hide();
    }
  });

  ipcMain.handle('toggle-pin', (_, forceState) => {
    // If forceState is provided (boolean), use it; otherwise toggle
    isAlwaysOnTop = typeof forceState === 'boolean' ? forceState : !isAlwaysOnTop;
    if (popupWindow && !popupWindow.isDestroyed()) {
      _applyAlwaysOnTop(popupWindow, isAlwaysOnTop);
      popupWindow.webContents.send('pin-state-changed', { pinned: isAlwaysOnTop });
    }
    saveAlwaysOnTop(isAlwaysOnTop);
    console.log(`[Pin] Always on top: ${isAlwaysOnTop}`);
    return { pinned: isAlwaysOnTop };
  });

  ipcMain.handle('get-pin-state', () => {
    return { pinned: isAlwaysOnTop };
  });

  ipcMain.handle('check-screen-permission', async () => {
    if (process.platform !== 'darwin') return { granted: true, platform: process.platform };
    const granted = checkScreenRecordingPermission();
    if (!granted) {
      // Only probe when NOT granted — to register app in the list.
      // Probing when granted triggers the native macOS popup unnecessarily.
      const probeGranted = await probeScreenRecordingPermission();
      return { granted: probeGranted, platform: 'darwin' };
    }
    return { granted: true, platform: 'darwin' };
  });

  ipcMain.handle('request-screen-permission', async () => {
    if (process.platform !== 'darwin') return { granted: true };
    // Only probe if not already granted — avoids native popup
    if (_screenPermissionGranted !== true) {
      await probeScreenRecordingPermission();
    }
    const result = await showScreenPermissionOnboarding({ isPreStart: true, wasTracking: isTimerRunning });
    return { result, granted: _screenPermissionGranted === true };
  });

  // Opens Screen Recording settings directly — used by the wallpaper warning banner
  ipcMain.handle('open-screen-recording-settings', async () => {
    if (process.platform !== 'darwin') return { opened: false };
    console.log('[Permission] User clicked Fix — opening Screen Recording settings');
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    return { opened: true };
  });

  ipcMain.handle('get-theme', () => {
    return getOSTheme();
  });

  // CONNECTIVITY FIX: Network status IPC handler
  ipcMain.removeHandler('get-network-status');
  ipcMain.handle('get-network-status', () => ({
    online: networkMonitor?.isOnline ?? true,
  }));

  ipcMain.handle('install-update', () => {
    console.log('[updater] User clicked Restart Now — installing update');
    const { autoUpdater } = require('electron-updater');
    autoUpdater.quitAndInstall(false, true);
  });

  ipcMain.handle('get-timer-state', async (_, projectId) => {
    const validProjectId = validateProjectId(projectId);
    let todayTotalForDisplay = 0;
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
          // BUG-1 FIX: Use project_today_total from the same atomic response
          const projectTotal = status.project_today_total ?? globalTotal;
          todayTotalCurrentProject = Math.max(0, projectTotal - elapsed);
        } else {
          todayTotalGlobal = globalTotal;
          todayTotalCurrentProject = 0;
          isTimerRunning = false;
          currentEntry = null;
          _cachedStartedAtMs = null;
        }
        // BUG-1 FIX: Use the project_today_total already in the response instead of a separate call
        if (isTimerRunning && currentEntry?.project_id) {
          todayTotalForDisplay = status.project_today_total ?? globalTotal;
        } else {
          todayTotalForDisplay = globalTotal;
        }
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
    if (!apiClient) return [];
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
  ipcMain.handle('resolve-idle', async (_, action, projectId = null, actionId = null) => {
    const validAction = validateIdleAction(action);
    if (!validAction) return { error: 'Invalid action' };
    const validProjectId = validateProjectId(projectId);
    await handleIdleAction(validAction, actionId, null, validProjectId);
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
    // BUG-1 FIX: Use todayTotalForPopup already passed in instead of a separate API call
    // that could race with the elapsed timer and produce inconsistent totals
    todayTotalGlobal = todayTotalForPopup;
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

/**
 * Atomically switch the running timer to a different project via a single
 * server-side transaction (zero gap between projects).
 */
async function switchProject(projectId) {
  if (!isTimerRunning || !apiClient) return { error: 'No timer running' };

  try {
    // Send final heartbeat for the old entry before switching
    if (activityMonitor) {
      await activityMonitor.sendFinalHeartbeat().catch(() => {});
    }

    const result = await apiClient.switchProject(projectId);
    const newEntry = result.entry;

    // Update local state to the new entry
    currentEntry = newEntry;
    _cachedStartedAtMs = newEntry?.started_at ? new Date(newEntry.started_at).getTime() : null;
    todayTotalCurrentProject = result.today_total ?? 0;

    posthog.capture(newEntry?.user_id || 'unknown', 'timer_switched', {
      project_id: projectId,
      stopped_entry_id: result.stopped_entry?.id,
    });

    // Restart screenshot service with new entry ID
    screenshotService?.stop();
    screenshotService?.start(newEntry.id);

    // Restart activity monitor for the new entry
    activityMonitor?.stop();
    activityMonitor?.start();

    // Restart idle detector for the new entry (reset idle tracking state)
    idleDetector?.stop();
    idleDetector?.start();

    notifyPopup('timer-started', { ...newEntry, todayTotal: todayTotalCurrentProject });
    updateTrayTitle();

    return { success: true, entry: newEntry, todayTotal: todayTotalCurrentProject };
  } catch (e) {
    console.error('[switchProject] Failed:', e.message);
    return { error: e.response?.data?.message || e.message };
  }
}

let _startTimerInProgress = false; // Mutex to prevent concurrent startTimer calls
async function startTimer(projectId = null) {
  // If timer is already running on a different project, use atomic switch
  if (isTimerRunning && projectId && currentEntry?.project_id !== projectId) {
    return await switchProject(projectId);
  }
  if (isTimerRunning) return { error: 'Timer already running' };

  // RACE-FIX: Prevent concurrent start calls from creating duplicate entries
  if (_startTimerInProgress) return { error: 'Timer start already in progress' };
  _startTimerInProgress = true;

  try {
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

    // LOCAL-FIRST: Record timer start in SQLite immediately.
    // The local timestamp is the source of truth — never overwritten.
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const idempotencyKey = generateIdempotencyKey();
    const localStartedAt = new Date().toISOString();
    _cachedStartedAtMs = Date.now();

    saveLocalTimerStart(localId, idempotencyKey, projectId, localStartedAt);
    console.log(`[Timer] Local start recorded: ${localId}, key=${idempotencyKey}`);

    // Set local state immediately — timer is running regardless of network
    const localEntry = {
      id: localId,
      started_at: localStartedAt,
      project_id: projectId,
      idempotency_key: idempotencyKey,
      _offline: true,
      _localId: localId,
    };
    currentEntry = localEntry;
    isTimerRunning = true;
    todayTotalCurrentProject = 0;

    // Try to sync with server (non-blocking for the user)
    try {
      const result = await apiClient.startTimer(projectId, idempotencyKey);
      // Server confirmed — update local state with server entry
      currentEntry = { ...result.entry, _localId: localId, idempotency_key: idempotencyKey };
      _cachedStartedAtMs = currentEntry?.started_at ? new Date(currentEntry.started_at).getTime() : null;
      todayTotalCurrentProject = result.today_total ?? 0;
      markLocalTimerStartSynced(localId, result.entry.id);
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
          const retryResult = await apiClient.startTimer(projectId, idempotencyKey);
          currentEntry = { ...retryResult.entry, _localId: localId, idempotency_key: idempotencyKey };
          _cachedStartedAtMs = currentEntry?.started_at ? new Date(currentEntry.started_at).getTime() : null;
          isTimerRunning = true;
          todayTotalCurrentProject = retryResult.today_total ?? 0;
          markLocalTimerStartSynced(localId, retryResult.entry.id);
          notifyPopup('timer-started', { ...currentEntry, todayTotal: todayTotalCurrentProject });
          setImmediate(() => afterStartTimer(projectId, todayTotalCurrentProject));
          return { success: true, entry: currentEntry, todayTotal: todayTotalCurrentProject };
        } catch (retryErr) {
          // Still offline or server error — timer is running locally
          console.warn('[Timer] 409 retry failed, continuing locally:', retryErr.message);
        }
      }

      // Network failure or any other error — timer is already running locally
      console.log('[Timer] API start failed, continuing in local-first mode:', e.message);
      // Queue the start for later sync
      offlineQueue?.add('timer_start', {
        project_id: projectId,
        idempotency_key: idempotencyKey,
        started_at: localStartedAt,
      });
      notifyPopup('timer-started', { ...localEntry, todayTotal: 0, offline: true });
      setImmediate(() => afterStartTimer(projectId, 0));
      return { success: true, entry: localEntry, todayTotal: 0, offline: true };
    }
  } finally {
    _startTimerInProgress = false;
  }
}

async function stopTimer() {
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
    await activityMonitor.sendFinalHeartbeat().catch(() => {});
  }

  // LOCAL-FIRST: Record stop in SQLite immediately with precise timestamps.
  const localEndedAt = new Date().toISOString();
  const localDuration = sessionElapsed;
  const localStartedAtIso = currentEntry?.started_at || localEndedAt;
  const localId = currentEntry?._localId || null;

  if (localId) {
    saveLocalTimerStop(localId, localEndedAt, localDuration);
    console.log(`[Timer] Local stop recorded: ${localId}, duration=${localDuration}s`);
  }

  // Try to sync stop with server (non-blocking for local state)
  let serverResult = null;
  let serverStopFailed = false;
  try {
    const stopPayload = {};
    // Send local timestamps for offline sync accuracy
    if (currentEntry?._offline || currentEntry?._localId) {
      stopPayload.started_at = localStartedAtIso;
      stopPayload.ended_at = localEndedAt;
    }
    serverResult = await apiClient.stopTimer(stopPayload);
    // Mark synced in local DB
    if (localId) markLocalTimerStopSynced(localId);
  } catch (e) {
    serverStopFailed = true;
    if (!e.response || e.code === 'ECONNABORTED') {
      // Network error or timeout — stop locally, queue for sync
      console.warn('[Timer] Server stop failed (offline/timeout) — queueing');
      offlineQueue?.add('timer_stop', {
        entry_id: currentEntry?.id,
        started_at: localStartedAtIso,
        ended_at: localEndedAt,
        idempotency_key: currentEntry?.idempotency_key || null,
        project_id: currentEntry?.project_id,
      });
    } else {
      // Server returned an error but we already stopped locally
      console.error('[Timer] Server stop returned error:', e.message);
      // Queue it anyway — time must not be lost
      offlineQueue?.add('timer_stop', {
        entry_id: currentEntry?.id,
        started_at: localStartedAtIso,
        ended_at: localEndedAt,
        idempotency_key: currentEntry?.idempotency_key || null,
        project_id: currentEntry?.project_id,
      });
    }
  }

  // Now update local state (server confirmed stop, or we timed out)
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

  // Post-stop async work (non-blocking)
  (async () => {
    const result = serverStopFailed ? null : serverResult;
    // BUG-001: If the entry had near-zero duration (artifact from idle split),
    // delete it from the server to keep the timesheet clean.
    if (isZeroDurationEntry && stoppedEntryId && !serverStopFailed) {
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
  })().catch(() => {});

  return { success: true, entry: null, todayTotal: localStoppedProjectTotal };
}

// ── Reconciliation on Reconnect ─────────────────────────────────────────────
// When network comes back, compare local SQLite timer state vs server state.
// Preference: never lose time.
async function reconcileTimerState() {
  if (!apiClient) return;
  try {
    const serverStatus = await apiClient.getTimerStatus();
    const localActive = getActiveLocalTimer();

    if (localActive && !localActive.synced_start) {
      // Local has an unsynced start — push it to server
      console.log('[Reconcile] Pushing unsynced local start to server');
      try {
        const result = await apiClient.startTimer(
          localActive.project_id || null,
          localActive.idempotency_key
        );
        markLocalTimerStartSynced(localActive.id, result.entry.id);

        // If local also has an unsynced stop, push that too
        if (localActive.ended_at && !localActive.synced_stop) {
          try {
            await apiClient.stopTimer({
              started_at: localActive.started_at,
              ended_at: localActive.ended_at,
            });
            markLocalTimerStopSynced(localActive.id);
          } catch (stopErr) {
            console.warn('[Reconcile] Stop sync failed, will retry:', stopErr.message);
          }
        }
      } catch (startErr) {
        if (startErr.response?.status === 409) {
          // Server already has a running timer — check if it's ours (idempotency)
          console.log('[Reconcile] Server has running timer (409)');
        } else {
          console.warn('[Reconcile] Start sync failed, will retry:', startErr.message);
        }
      }
    } else if (!serverStatus.running && isTimerRunning && currentEntry?._localId) {
      // Server has no open entry but local does — push start with original timestamp
      console.log('[Reconcile] Server has no timer but local is running — pushing start');
      const key = currentEntry?.idempotency_key || generateIdempotencyKey();
      try {
        const result = await apiClient.startTimer(currentEntry?.project_id || null, key);
        if (currentEntry?._localId) {
          markLocalTimerStartSynced(currentEntry._localId, result.entry.id);
        }
        // Update local entry with server data
        currentEntry = { ...result.entry, _localId: currentEntry?._localId, idempotency_key: key };
      } catch (e) {
        console.warn('[Reconcile] Push start failed:', e.message);
      }
    } else if (serverStatus.running && isTimerRunning) {
      // Both have open entries — use the one with earlier started_at (never lose time)
      const serverStartMs = new Date(serverStatus.entry.started_at).getTime();
      const localStartMs = _cachedStartedAtMs || Date.now();
      if (serverStartMs <= localStartMs) {
        // Server entry is older or same — adopt server state
        currentEntry = { ...serverStatus.entry, _localId: currentEntry?._localId };
        _cachedStartedAtMs = serverStartMs;
        console.log('[Reconcile] Adopted server entry (earlier started_at)');
      } else {
        console.log('[Reconcile] Kept local entry (earlier started_at)');
      }
    }

    // Also sync any fully unsynced sessions from the DB
    const unsynced = getUnsyncedTimerSessions();
    for (const session of unsynced) {
      if (session.id === currentEntry?._localId) continue; // Skip active session
      if (!session.synced_start) {
        try {
          const result = await apiClient.startTimer(session.project_id || null, session.idempotency_key);
          markLocalTimerStartSynced(session.id, result.entry.id);
          if (session.ended_at) {
            await apiClient.stopTimer({
              started_at: session.started_at,
              ended_at: session.ended_at,
            });
            markLocalTimerStopSynced(session.id);
          }
        } catch (e) {
          console.warn(`[Reconcile] Session ${session.id} sync failed:`, e.message);
        }
      } else if (session.ended_at && !session.synced_stop) {
        try {
          await apiClient.stopTimer({
            started_at: session.started_at,
            ended_at: session.ended_at,
          });
          markLocalTimerStopSynced(session.id);
        } catch (e) {
          console.warn(`[Reconcile] Session ${session.id} stop sync failed:`, e.message);
        }
      }
    }

    cleanOldLocalTimerSessions();
  } catch (e) {
    console.error('[Reconcile] Failed:', e.message);
  }
}

// Periodically sync timer state with server to stay in sync with web dashboard
let _configRefetchCycle = 0;
let _isSyncing = false; // M6 FIX: guard against concurrent sync cycles
function startTimerSync() {
  if (timerSyncInterval) clearInterval(timerSyncInterval);
  _configRefetchCycle = 0;
  _isSyncing = false;
  timerSyncInterval = setInterval(async () => {
    if (!apiClient) return;
    // M6 FIX: Skip if a sync is already in progress
    if (_isSyncing) return;
    _isSyncing = true;

    // Re-fetch org config every 30th cycle (~5 minutes at 10s interval)
    _configRefetchCycle++;
    if (_configRefetchCycle >= 30) {
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

    // CONNECTIVITY FIX: Skip sync when offline to avoid unnecessary errors
    if (networkMonitor && !networkMonitor.isOnline) {
      _isSyncing = false;
      return;
    }

    try {
      const status = await apiClient.getTimerStatus();
      const globalTotal = status.today_total ?? 0;
      const elapsed = status.elapsed_seconds ?? 0;
      if (status.running) {
        todayTotalGlobal = Math.max(0, globalTotal - elapsed);
        // BUG-1 FIX: Use project_today_total from the same atomic response to avoid race conditions
        const projectTotal = status.project_today_total ?? globalTotal;
        todayTotalCurrentProject = Math.max(0, projectTotal - elapsed);
      } else {
        todayTotalGlobal = globalTotal;
        todayTotalCurrentProject = 0;
      }

      if (status.running && !isTimerRunning) {
        isTimerRunning = true;
        currentEntry = status.entry;
        _cachedStartedAtMs = currentEntry?.started_at ? new Date(currentEntry.started_at).getTime() : null;
        // BUG-1 FIX: project_today_total already set above from atomic response
        activityMonitor?.start();
        screenshotService?.start(currentEntry.id);
        idleDetector?.start();
        startTrayTimer();
        updateTrayIcon(true);
        notifyPopup('timer-started', { ...currentEntry, todayTotal: todayTotalCurrentProject });
      } else if (!status.running && isTimerRunning) {
        // BUG-2 FIX: Don't override local state while idle alert is showing — the server may show
        // timer as stopped because idle-discard split the entry, but locally we're still
        // in the idle flow and the user hasn't responded yet.
        if (idleDetector?.isIdleActive()) {
          console.log('[TimerSync] Server says stopped but idle alert is active — keeping local state');
          _isSyncing = false;
          return;
        }
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
    } catch (err) {
      // H4 FIX: Log sync errors instead of swallowing them
      console.error('[TimerSync] sync failed:', err.message);
      // Do not re-throw — keep interval alive
    } finally {
      _isSyncing = false; // M6 FIX: Always release sync guard
    }
  }, 10000);
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
//   macOS: tray.setTitle() shows text next to icon in menu bar.
//            Text color is system-controlled (white in dark mode, black in light mode).
//            The green/gray dot in the template icon indicates tracking state.
//   Windows/Linux: tray.setTitle() is not visible — tooltip used instead.
function setTrayText(text) {
  if (!tray) return;
  if (process.platform === 'darwin') {
    // Use plain system color — macOS auto-adapts to menu bar (white/dark, black/light).
    // State is indicated by the colored dot in the tray icon, not text color.
    tray.setTitle(text || '', { fontType: 'monospacedDigit' });
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
    // M8 FIX: Use clock offset for accurate elapsed time display
    const clientNowMs = Date.now() + _clockOffsetMs;
    const currentElapsed = Math.floor((clientNowMs - _cachedStartedAtMs) / 1000);
    const totalSeconds = todayTotalCurrentProject + currentElapsed;
    const formatted = formatTimeShort(totalSeconds);
    setTrayText(formatted);
    // L12: Only send IPC to renderer when window is visible — avoids wasted work
    if (popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible()) {
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

async function showIdleAlert(idleSeconds, idleStartedAt, actionId = null) {
  // Capture the actionId at call time; if not provided, read from detector
  const alertActionId = actionId ?? idleDetector?.getActionId() ?? 0;

  if (idleAlertWindow && !idleAlertWindow.isDestroyed()) {
    // Alert already showing — bring it to front and update idle data
    idleAlertWindow.focus();
    if (typeof idleAlertWindow.moveTop === 'function') {
      idleAlertWindow.moveTop();
    }
    // Update the action ID on the window so the close handler uses the latest
    idleAlertWindow._actionId = alertActionId;
    idleAlertWindow.webContents.send('idle-data', {
      idleStartedAt,
      idleSeconds,
      actionId: alertActionId,
      autoStopTotalSec: idleDetector ? (idleDetector.idleTimeoutSec + idleDetector.alertAutoStopSec) : 0,
      projects: cachedProjects || [],
    });
    return;
  }
  // BUG-2 FIX: Check idle detector state instead of isTimerRunning to avoid race condition
  // where a concurrent sync cycle temporarily sets isTimerRunning=false, preventing the
  // modal from appearing. The idle detector is the authoritative source of idle state.
  if (!idleDetector?.isIdleActive()) return;

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
    // Ensure the idle alert appears on whichever macOS Space / Linux workspace the
    // user is currently viewing. Without this the window can open on a different
    // desktop and appear invisible.
    visibleOnAllWorkspaces: true,
    backgroundColor: '#0a0a0a',   // Prevent white flash on all platforms
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: true,
    },
  });

  // Keep a local reference so the ready-to-show / did-finish-load callbacks
  // always operate on the window they were registered on, even if the outer
  // idleAlertWindow variable is reassigned or nulled by dismissIdleAlert().
  const win = idleAlertWindow;
  // Store the action ID on the window for the close handler
  win._actionId = alertActionId;
  let shown = false;

  function showAndSendData() {
    if (shown) return;
    if (win.isDestroyed()) return;
    shown = true;
    win.show();
    win.focus();
    win.webContents.send('idle-data', {
      idleStartedAt,
      idleSeconds,
      actionId: alertActionId,
      autoStopTotalSec: idleDetector ? (idleDetector.idleTimeoutSec + idleDetector.alertAutoStopSec) : 0,
      projects: cachedProjects || [],
    });
  }

  // Primary: show as soon as first paint completes
  win.once('ready-to-show', showAndSendData);

  // Fallback: on some macOS configurations (e.g., app backgrounded, Spaces,
  // or sandbox + alwaysOnTop combos), ready-to-show may not fire reliably.
  // Use did-finish-load as a safety net.
  win.webContents.once('did-finish-load', showAndSendData);

  // If the idle alert window is closed without the user clicking an action
  // button (e.g., Cmd+W, dock close, OS memory pressure), treat as "keep"
  // (safest default — does not discard tracked time) and re-arm the detector.
  win._dismissedProgrammatically = false;

  win.on('closed', () => {
    idleAlertWindow = null;
    if (!win._dismissedProgrammatically) {
      console.log('[IdleAlert] Window closed without user action — treating as "keep" and re-arming idle detector');
      // Use the action ID stored on the window to resolve the correct idle cycle
      const windowActionId = win._actionId;
      const resolved = idleDetector?.resolveIdle(windowActionId);
      if (resolved) {
        // Only restart services if resolve succeeded (not stale)
        activityMonitor?.start();
        if (isTimerRunning && currentEntry) {
          screenshotService?.start(currentEntry.id, {
            immediateCapture: config.screenshot_capture_immediate_after_idle === true,
          });
        }
        idleDetector?.start();
      }
      // Restore tray regardless
      updateTrayIcon(isTimerRunning);
      if (isTimerRunning) {
        updateTrayTitle();
        startTrayTimer();
      }
    }
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'idle-alert.html')).catch((err) => {
    console.error('[IdleAlert] Failed to load idle-alert.html:', err.message);
  });

}

function dismissIdleAlert() {
  if (idleAlertWindow && !idleAlertWindow.isDestroyed()) {
    // Mark as programmatic dismissal so the 'closed' handler doesn't
    // re-arm the idle detector (handleIdleAction already did that).
    idleAlertWindow._dismissedProgrammatically = true;
    idleAlertWindow.destroy();
  }
  idleAlertWindow = null;
}

/**
 * Handle the user's idle action choice. Uses a mutex (_idleActionInProgress)
 * to prevent double-action from auto-stop + user click racing.
 *
 * @param {string} action — 'keep', 'discard', 'reassign', or 'stop'
 * @param {number|null} actionId — the idle detector action ID for this cycle
 * @param {number|null} idleDurationOverride — override idle duration (seconds)
 * @param {string|null} reassignProjectId — project ID for reassign action
 */
async function handleIdleAction(action, actionId = null, idleDurationOverride = null, reassignProjectId = null) {
  // Mutex: prevent double-action (auto-stop + user click, or double-click)
  if (_idleActionInProgress) {
    console.warn(`[handleIdleAction] Action "${action}" blocked — another action is in progress`);
    return;
  }
  _idleActionInProgress = true;

  try {
    // Read idle info BEFORE resolving (resolveIdle clears it)
    const idleDuration = idleDurationOverride || idleDetector?.getIdleDuration() || 0;
    const idleStartedAt = idleDetector?.idleStartedAt || null;

    posthog.capture(currentEntry?.user_id || 'unknown', 'idle_action', { action, idle_seconds: idleDuration });

    // Resolve the idle state — returns null if already resolved (stale action)
    const resolved = idleDetector?.resolveIdle(actionId);
    if (!resolved && idleDetector?.state !== IDLE_STATE.STOPPED) {
      // Already resolved by a competing action — abort
      console.warn(`[handleIdleAction] Action "${action}" aborted — idle already resolved`);
      return;
    }

    // Use idleStartedAt from the resolve result if available (more reliable
    // than reading it before resolve, since resolve is atomic)
    const effectiveIdleStartedAt = resolved?.idleStartedAt || idleStartedAt;

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
        if (apiClient && currentEntry && effectiveIdleStartedAt) {
          try {
            const payload = {
              time_entry_id: currentEntry.id,
              idle_started_at: new Date(effectiveIdleStartedAt).toISOString(),
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
              idle_started_at: new Date(effectiveIdleStartedAt).toISOString(),
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
        if (apiClient && currentEntry && effectiveIdleStartedAt) {
          try {
            const idleResult = await apiClient.reportIdleTime({
              time_entry_id: currentEntry.id,
              idle_started_at: new Date(effectiveIdleStartedAt).toISOString(),
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
              idle_started_at: new Date(effectiveIdleStartedAt).toISOString(),
              idle_ended_at: new Date().toISOString(),
              idle_seconds: idleDuration,
              action: 'discard',
            });
          }
        }
        // B1 FIX: await stopTimer() — it's async and must complete before returning
        await stopTimer();
        break;
    }
  } finally {
    _idleActionInProgress = false;
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
      devTools: true,
    },
  });

  loginWindow.loadFile(path.join(__dirname, '..', 'renderer', 'login.html'));

  loginWindow.on('closed', () => {
    loginWindow = null;
  });

  // Only register the login handlers once
  if (!loginHandlerRegistered) {
    loginHandlerRegistered = true;

    // ── Email/Password Login (multi-org aware) ──
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

        // Multi-org: server says user must pick an organization
        if (result.requires_org_selection) {
          return {
            requires_org_selection: true,
            organizations: result.organizations,
            credentials: { email, password },
          };
        }

        await setToken(result.access_token);
        await setRefreshToken(result.refresh_token);

        // B3 FIX: Clear sync interval before re-initializing to prevent overlap
        if (timerSyncInterval) { clearInterval(timerSyncInterval); timerSyncInterval = null; }
        stopTrayTimer();

        BrowserWindow.getAllWindows().forEach((w) => w.close());
        await initializeApp();
        // Show the popup immediately after login so the user sees the timer
        showPopup();
        return { success: true };
      } catch (e) {
        return { error: _friendlyLoginError(e) };
      }
    });

    // ── Google OAuth Login ──
    // Opens system browser for Google consent, receives auth code via local HTTP server
    ipcMain.handle('google-login', async () => {
      const googleClientId = process.env.TRACKFLOW_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
      const googleClientSecret = process.env.TRACKFLOW_GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '';

      if (!googleClientId) {
        return { error: 'Google login is not configured for the desktop app.' };
      }

      try {
        const http = require('http');
        const crypto = require('crypto');
        const url = require('url');

        // Start a temporary local HTTP server to receive the OAuth callback
        const state = crypto.randomBytes(16).toString('hex');
        let callbackServer = null;

        // B2 FIX: Use a settled guard so late-arriving callbacks after timeout are ignored,
        // and ensure the server is always closed on both success and timeout.
        const result = await new Promise((resolve) => {
          let settled = false;
          const done = (value) => {
            if (settled) return;
            settled = true;
            if (callbackServer) {
              try { callbackServer.close(); } catch {}
            }
            resolve(value);
          };

          callbackServer = http.createServer(async (req, res) => {
            if (settled) { res.writeHead(200); res.end(); return; }
            try {
              const parsed = url.parse(req.url, true);
              if (parsed.pathname !== '/callback') {
                res.writeHead(404);
                res.end('Not found');
                return;
              }

              // Verify state to prevent CSRF
              if (parsed.query.state !== state) {
                res.writeHead(400);
                res.end('Invalid state parameter.');
                done({ error: 'OAuth state mismatch. Please try again.' });
                return;
              }

              if (parsed.query.error) {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<html><body><h2>Sign-in cancelled.</h2><p>You can close this tab.</p></body></html>');
                done({ error: parsed.query.error_description || 'Google sign-in was cancelled.' });
                return;
              }

              const code = parsed.query.code;
              if (!code) {
                res.writeHead(400);
                res.end('Missing authorization code.');
                done({ error: 'No authorization code received from Google.' });
                return;
              }

              // Exchange auth code for ID token
              const tokenRes = await require('axios').post('https://oauth2.googleapis.com/token', {
                code,
                client_id: googleClientId,
                client_secret: googleClientSecret,
                redirect_uri: `http://127.0.0.1:${callbackServer.address().port}/callback`,
                grant_type: 'authorization_code',
              });

              const idToken = tokenRes.data.id_token;
              if (!idToken) {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<html><body><h2>Error</h2><p>Could not get ID token from Google.</p></body></html>');
                done({ error: 'Failed to obtain ID token from Google.' });
                return;
              }

              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end('<html><body style="font-family:system-ui;text-align:center;padding:40px"><h2>Sign-in successful!</h2><p>You can close this tab and return to TrackFlow.</p></body></html>');

              done({ id_token: idToken });
            } catch (err) {
              console.error('[GoogleAuth] Callback error:', err.message);
              try { res.writeHead(500); res.end('Internal error'); } catch {}
              done({ error: err.message || 'Google authentication failed.' });
            }
          });

          // Listen on a random available port on localhost
          callbackServer.listen(0, '127.0.0.1', () => {
            const port = callbackServer.address().port;
            const redirectUri = `http://127.0.0.1:${port}/callback`;
            const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?`
              + `client_id=${encodeURIComponent(googleClientId)}`
              + `&redirect_uri=${encodeURIComponent(redirectUri)}`
              + `&response_type=code`
              + `&scope=${encodeURIComponent('openid email profile')}`
              + `&state=${state}`
              + `&access_type=offline`
              + `&prompt=select_account`;

            console.log('[GoogleAuth] Opening system browser for OAuth...');
            shell.openExternal(authUrl);
          });

          // Timeout after 5 minutes — B2 FIX: server is closed via done()
          setTimeout(() => {
            done({ error: 'Google sign-in timed out. Please try again.' });
          }, 5 * 60 * 1000);
        });

        if (result.error) {
          return { error: result.error };
        }

        // Send ID token to our backend
        const tempClient = new ApiClient(null);
        const authResult = await tempClient.googleAuth(result.id_token);

        // Multi-org: server says user must pick an organization
        if (authResult.requires_org_selection) {
          return {
            requires_org_selection: true,
            organizations: authResult.organizations,
            credentials: { id_token: result.id_token },
          };
        }

        await setToken(authResult.access_token);
        await setRefreshToken(authResult.refresh_token);

        // B3 FIX: Clear sync interval before re-initializing to prevent overlap
        if (timerSyncInterval) { clearInterval(timerSyncInterval); timerSyncInterval = null; }
        stopTrayTimer();

        BrowserWindow.getAllWindows().forEach((w) => w.close());
        await initializeApp();
        // Show the popup immediately after login so the user sees the timer
        showPopup();
        return { success: true };
      } catch (e) {
        return { error: _friendlyLoginError(e) };
      }
    });

    // ── Select Organization (after multi-org detection) ──
    ipcMain.handle('select-organization', async (_, orgId, credentials) => {
      if (!orgId || typeof orgId !== 'string') {
        return { error: 'Invalid organization selection.' };
      }

      try {
        const tempClient = new ApiClient(null);
        const payload = { organization_id: orgId, ...credentials };
        const result = await tempClient.selectOrganization(payload);

        await setToken(result.access_token);
        await setRefreshToken(result.refresh_token);

        // B3 FIX: Clear sync interval before re-initializing to prevent overlap
        if (timerSyncInterval) { clearInterval(timerSyncInterval); timerSyncInterval = null; }
        stopTrayTimer();

        BrowserWindow.getAllWindows().forEach((w) => w.close());
        await initializeApp();
        // Show the popup immediately after login so the user sees the timer
        showPopup();
        return { success: true };
      } catch (e) {
        return { error: _friendlyLoginError(e) };
      }
    });
  }
}

/** Extract a user-friendly error message from a login/auth error. */
function _friendlyLoginError(e) {
  const serverMsg = e.response?.data?.message;
  if (serverMsg) return serverMsg;
  if (e.code === 'ENOTFOUND' || e.code === 'ERR_NETWORK') return 'Cannot reach the server. Please check your internet connection.';
  if (e.code === 'ECONNREFUSED') return 'Server is not responding. Please try again later.';
  if (e.code === 'ETIMEDOUT' || e.code === 'ECONNABORTED') return 'Connection timed out. Please try again.';
  if (e.response?.status === 404) return 'Server endpoint not found. Please update the app.';
  return e.message || 'Login failed. Please try again.';
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
      posthog.capture(currentEntry?.user_id || 'unknown', 'auto_update_available', { new_version: info.version });
    });
    autoUpdater.on('update-downloaded', (info) => {
      console.log(`[updater] Update downloaded: v${info.version} — will install on quit`);
      _pendingUpdate = true;
      posthog.capture(currentEntry?.user_id || 'unknown', 'auto_update_downloaded', { new_version: info.version });

      // Send in-app update dialog to the renderer (prominent, can't be missed)
      try {
        if (popupWindow && !popupWindow.isDestroyed()) {
          popupWindow.webContents.send('update-ready', { version: info.version });
        }
      } catch {}

      // Also show a system notification as a fallback
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
    // L11: Retry with exponential backoff on update check failure
    let _updateRetryCount = 0;
    const _updateMaxRetries = 3;
    const _updateRetryDelays = [2 * 60 * 1000, 4 * 60 * 1000, 8 * 60 * 1000]; // 2m, 4m, 8m

    autoUpdater.on('error', (err) => {
      console.warn(`[updater] Error: ${err?.message || err}`);
      posthog.captureError(null, err || new Error('auto_update_error'), { type: 'auto_update' });

      // L11: Retry with backoff
      if (_updateRetryCount < _updateMaxRetries) {
        const delay = _updateRetryDelays[_updateRetryCount];
        _updateRetryCount++;
        console.log(`[updater] Retrying in ${delay / 1000}s (attempt ${_updateRetryCount}/${_updateMaxRetries})`);
        setTimeout(() => {
          autoUpdater.checkForUpdatesAndNotify().catch(() => {});
        }, delay);
      }
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

// M5 FIX: Gate auto-start behind user preference stored in config
// Only set login item if packaged AND user hasn't explicitly disabled it
if (app.isPackaged) {
  try {
    const prefsPath = path.join(app.getPath('userData'), 'user-prefs.json');
    let launchAtLogin = true; // default: enabled
    if (fs.existsSync(prefsPath)) {
      try {
        const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
        if (prefs.launchAtLogin === false) launchAtLogin = false;
      } catch {}
    }
    app.setLoginItemSettings({ openAtLogin: launchAtLogin });
  } catch {}
}
