const {
    app,
    BrowserWindow,
    Tray,
    Menu,
    nativeImage,
    ipcMain,
    shell,
    Notification,
    screen,
    powerMonitor,
    nativeTheme,
    systemPreferences,
    dialog,
    desktopCapturer,
} = require("electron");
const path = require("path");
const fs = require("fs");

// ── Load .env for both dev and packaged builds ──────────────────
// In dev: .env is in the project root (desktop/.env)
// In packaged: .env is bundled via extraResources into the Resources dir
(function loadEnv() {
    try {
        const envPaths = [
            path.join(process.resourcesPath, ".env"), // packaged
            path.join(__dirname, "..", "..", ".env"), // dev (src/main -> desktop)
        ];
        for (const p of envPaths) {
            if (fs.existsSync(p)) {
                const lines = fs.readFileSync(p, "utf8").split("\n");
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith("#")) continue;
                    const eqIdx = trimmed.indexOf("=");
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
// ── Linux / Wayland: Force X11 mode to prevent per-capture screen picker ──
//
// On Ubuntu 22.04+ (GNOME Wayland), desktopCapturer.getSources() triggers the
// XDG Desktop Portal screen-picker dialog on EVERY call because Wayland requires
// explicit user consent for each capture session. This makes automated
// screenshot capture unusable.
//
// Fix: append --ozone-platform=x11 BEFORE Chromium initialises so Electron
// uses XWayland instead of the native Wayland backend. XWayland bypasses the
// portal entirely and lets desktopCapturer work the same way it does on X11.
//
// This must be called before app.requestSingleInstanceLock() / app.whenReady().
if (process.platform === "linux") {
    // Force pure X11 mode so desktopCapturer never invokes the XDG Desktop Portal
    // screen-picker dialog. Two layers of enforcement:
    //
    // 1. Unset WAYLAND_DISPLAY before Chromium initialises — prevents Electron from
    //    detecting a Wayland compositor even when running inside a GNOME/Wayland session
    //    (Ubuntu 24.04 still triggers the portal for XWayland apps if this is set).
    //
    // 2. ELECTRON_OZONE_PLATFORM_HINT=x11 — the Electron 20+ declarative way to force
    //    X11/XWayland mode (respected before Chromium args are parsed).
    //
    // 3. --ozone-platform=x11 Chromium flag — belt-and-suspenders for older Electron.
    //
    // Together these prevent the "Share Screen" portal dialog on Ubuntu 22.04–24.04.
    delete process.env.WAYLAND_DISPLAY;
    process.env.ELECTRON_OZONE_PLATFORM_HINT = "x11";
    app.commandLine.appendSwitch("ozone-platform", "x11");
    // AppImage distributes without setuid-root chrome-sandbox binary, so the
    // SUID sandbox is unavailable. Disable it to prevent the fatal abort.
    // Electron's process-level sandbox (seccomp-bpf) still applies.
    app.commandLine.appendSwitch("no-sandbox");
    console.log(
        "[linux] Forcing X11 mode (WAYLAND_DISPLAY unset, ELECTRON_OZONE_PLATFORM_HINT=x11, ozone-platform=x11)",
    );
    console.log(
        "[linux] Disabling SUID sandbox (not available in AppImage without setuid-root)",
    );
}

const crypto = require("crypto");
const { autoUpdater } = require("electron-updater");
const ApiClient = require("./api-client");
const ActivityMonitor = require("./activity-monitor");
const ScreenshotService = require("./screenshot-service");
const IdleDetector = require("./idle-detector");
const { IDLE_STATE } = require("./idle-detector");
const OfflineQueue = require("./offline-queue");
const NetworkMonitor = require("./network-monitor");
const {
    resolveWatchTarget,
    shouldStopForRemoval,
} = require("./uninstall-watcher");
const {
    getToken,
    setToken,
    getRefreshToken,
    setRefreshToken,
    deleteToken,
} = require("./keychain");
const posthog = require("./posthog");
const { getTrayIcon, warmIconCache } = require("./tray-icons");
const PowerManager = require("./power-manager");

const WEB_DASHBOARD_URL =
    process.env.TRACKFLOW_WEB_URL || "https://trackflow.codeupscale.com";

// ── File-based logger for packaged macOS builds ───────────────────
// macOS .app bundles suppress stdout/stderr. This writes to a log
// file in userData so we can diagnose issues in production.
// NOTE: LOG_FILE is lazy-initialized because app.getPath('userData')
// may not be available before app.whenReady() on some platforms.
let _logFile = null;
function getLogFile() {
    if (!_logFile) {
        try {
            _logFile = path.join(app.getPath("userData"), "trackflow.log");
        } catch {
            _logFile = "/tmp/trackflow.log"; // fallback
        }
    }
    return _logFile;
}
// Write a startup marker IMMEDIATELY to verify logging works
try {
    fs.appendFileSync(
        "/tmp/trackflow-boot.log",
        `[${new Date().toISOString()}] TrackFlow main process starting\n`,
    );
} catch {}

function logToFile(level, ...args) {
    const ts = new Date().toISOString();
    const msg = args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ");
    const line = `[${ts}] [${level}] ${msg}\n`;
    try {
        fs.appendFileSync(getLogFile(), line);
    } catch {}
    // Also write to /tmp as a guaranteed fallback
    try {
        fs.appendFileSync("/tmp/trackflow-boot.log", line);
    } catch {}
    // Also write to stdout for terminal/dev mode
    if (level === "error") {
        try {
            process.stderr.write(line);
        } catch {}
    } else {
        try {
            process.stdout.write(line);
        } catch {}
    }
}
// Override console for main process so ALL logs go to both file and stdout
const _origLog = console.log;
const _origError = console.error;
const _origWarn = console.warn;
console.log = (...args) => {
    _origLog(...args);
    logToFile("info", ...args);
};
console.error = (...args) => {
    _origError(...args);
    logToFile("error", ...args);
};
console.warn = (...args) => {
    _origWarn(...args);
    logToFile("warn", ...args);
};
console.log("Logger initialized — writing to", getLogFile());

// Minimum duration (seconds) for a time entry to be considered valid.
// Entries shorter than this are treated as artifacts (e.g., the zero-duration
// entries created by reportIdleTime when the user chooses "stop").
const MIN_ENTRY_DURATION_SEC = 5;

// Default configuration values — single source of truth
const DEFAULT_CONFIG = {
    screenshot_interval: 5,
    idle_timeout: 5,
    idle_detection: true,
    keep_idle_time: "prompt",
    blur_screenshots: false,
    idle_alert_auto_stop_min: 10,
    screenshot_capture_immediate_after_idle: true,
    screenshot_first_capture_delay_min: 1,
    idle_check_interval_sec: 2,
    capture_only_when_visible: false,
    capture_multi_monitor: false,
    track_urls: true,
    can_add_manual_time: true,
};

let currentShift = null; // Current user's assigned shift (from /agent/my-shift)

// ── Last Selected Project Persistence ────────────────────────────────────────
// Persist the last selected project ID to a JSON file in userData so it
// survives logout/login cycles and app restarts.
function getPrefsPath() {
    try {
        return path.join(app.getPath("userData"), "user-prefs.json");
    } catch {
        return null;
    }
}

function loadLastProjectId() {
    try {
        const p = getPrefsPath();
        if (!p || !fs.existsSync(p)) return null;
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        return data.lastSelectedProjectId || null;
    } catch {
        return null;
    }
}

function saveLastProjectId(projectId) {
    try {
        const p = getPrefsPath();
        if (!p) return;
        const data = loadUserPrefs();
        data.lastSelectedProjectId = projectId || null;
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
    } catch (e) {
        console.error("Failed to save last project ID:", e);
    }
}

function loadUserPrefs() {
    try {
        const p = getPrefsPath();
        if (!p || !fs.existsSync(p)) return {};
        return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
        return {};
    }
}

function saveUserPrefsPatch(patch) {
    try {
        const p = getPrefsPath();
        if (!p) return;
        const data = { ...loadUserPrefs(), ...patch };
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
    } catch (e) {
        console.error("Failed to save user prefs:", e.message);
    }
}

function touchLastActiveAt(iso = new Date().toISOString()) {
    saveUserPrefsPatch({ lastActiveAt: iso });
}

function loadLastActiveAt() {
    return loadUserPrefs().lastActiveAt || null;
}

function saveAutoStopReason(reason) {
    saveUserPrefsPatch({
        lastAutoStopReason: reason,
        lastAutoStopAt: new Date().toISOString(),
    });
}

function getStartupGapThresholdSec() {
    const v = loadUserPrefs().startupGapThresholdSec;
    return typeof v === "number" && v > 0
        ? v
        : PowerManager.DEFAULT_GAP_THRESHOLD_SEC;
}

// ── Always-on-Top (Pin) Persistence ──────────────────────────────────────────
// Persists the "always on top" / "pin" state so it survives app restarts.
// Uses the same user-prefs.json file as lastSelectedProjectId.
function loadAlwaysOnTop() {
    try {
        const p = getPrefsPath();
        if (!p || !fs.existsSync(p)) return true; // default: pinned
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
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
            try {
                data = JSON.parse(fs.readFileSync(p, "utf8"));
            } catch {
                data = {};
            }
        }
        data.alwaysOnTop = !!pinned;
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
    } catch (e) {
        console.error("Failed to save always-on-top state:", e);
    }
}

let isAlwaysOnTop = true; // will be loaded from prefs in app.whenReady

// ── Restart State Persistence ────────────────────────────────────────────────
// Saves tracking state before a forced restart (e.g., after granting Screen
// Recording permission on macOS). On next launch, the app auto-resumes.
function getRestartStatePath() {
    try {
        return path.join(app.getPath("userData"), "restart-state.json");
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
        fs.writeFileSync(p, JSON.stringify(state, null, 2), "utf8");
        console.log("[RestartState] Saved:", JSON.stringify(state));
    } catch (e) {
        console.error("[RestartState] Failed to save:", e.message);
    }
}

function loadRestartState() {
    try {
        const p = getRestartStatePath();
        if (!p || !fs.existsSync(p)) return null;
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        // Only honour restart state if it was saved within the last 5 minutes
        const savedAt = new Date(data.savedAt).getTime();
        if (Date.now() - savedAt > 5 * 60 * 1000) {
            console.log(
                "[RestartState] Expired (older than 5 minutes), ignoring",
            );
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
            console.log("[RestartState] Cleared");
        }
    } catch {}
}

// ── Screen Recording Permission (macOS) ──────────────────────────────────────
// Tracks whether the user has declined the permission prompt this session so we
// don't nag repeatedly. Reset on app restart.
let _screenPermissionDeclinedThisSession = false;
let _screenPermissionGranted = null; // null = not checked yet, true/false after check

function checkScreenRecordingPermission() {
    if (process.platform !== "darwin") {
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
        const status = systemPreferences.getMediaAccessStatus("screen");
        if (status === "granted") {
            _screenPermissionGranted = true;
            console.log("[Permission] Screen recording API status: granted");
            return true;
        }
        // For 'denied' or 'not-determined', don't trust it — force probe (API often
        // misreports for Electron dev/ad-hoc builds; desktopCapturer probe is authoritative)
        console.log(
            `[Permission] Screen recording API status: ${status} — verifying with desktopCapturer probe`,
        );
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
        return path.join(app.getPath("userData"), "screen-permission.json");
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
        const targetPath = app.isPackaged ? app.getPath("exe") : __dirname;
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
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        // Invalidate if the app version changed (new binary may need re-registration)
        if (data.appVersion !== app.getVersion()) {
            console.log(
                "[Permission] Persisted state is for a different app version — ignoring",
            );
            return null;
        }
        // Invalidate if the app binary has been rebuilt since permission was confirmed.
        // On macOS, ad-hoc signed rebuilds change the code signature and macOS
        // silently revokes Screen Recording permission.
        if (process.platform === "darwin" && data.appBinaryMtime != null) {
            const currentMtime = getAppBinaryMtime();
            if (currentMtime != null && currentMtime !== data.appBinaryMtime) {
                console.log(
                    `[Permission] App binary changed since permission was confirmed (stored=${data.appBinaryMtime}, current=${currentMtime}) — re-probing`,
                );
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
        fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
        console.log(
            `[Permission] Saved screen permission state: granted=${granted}, mtime=${data.appBinaryMtime}`,
        );
    } catch (e) {
        console.error(
            "[Permission] Failed to save screen permission state:",
            e.message,
        );
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
    if (process.platform !== "darwin") return true;

    console.log(
        "[Permission] Probing desktopCapturer to register in Screen Recording list...",
    );
    try {
        const sources = await Promise.race([
            desktopCapturer.getSources({
                types: ["screen"],
                thumbnailSize: { width: 1, height: 1 },
            }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error("probe timed out")), 5000),
            ),
        ]);

        console.log(`[Permission] Probe returned ${sources.length} source(s)`);

        // If we got sources with non-empty thumbnails, permission is granted
        if (sources.length > 0) {
            const hasContent = sources.some(
                (s) => s.thumbnail && !s.thumbnail.isEmpty(),
            );
            if (hasContent) {
                console.log(
                    "[Permission] Probe confirmed: screen recording permission IS granted",
                );
                _screenPermissionGranted = true;
                saveScreenPermissionState(true);
                return true;
            }
        }

        // Sources returned but thumbnails empty — app is now registered in the list
        // but permission is not yet granted
        console.log(
            "[Permission] Probe complete: app registered, but permission NOT yet granted",
        );
        return false;
    } catch (e) {
        console.warn("[Permission] Probe failed:", e.message);
        return false;
    }
}

async function showScreenPermissionOnboarding(options = {}) {
    const { isPreStart = false, wasTracking = false } = options;

    if (_screenPermissionDeclinedThisSession && !isPreStart) return "declined";

    const detail = isPreStart
        ? "TrackFlow needs Screen Recording access to capture activity screenshots for your employer.\n\n" +
          "Steps to enable:\n" +
          '1. Click "Open System Settings" below\n' +
          '2. Find "TrackFlow" in the list and toggle it ON\n' +
          '3. macOS will ask you to "Quit & Reopen" — click it\n' +
          (wasTracking
              ? "\nDon't worry — your tracking session will resume automatically after restart."
              : "\nAfter restarting, you can start tracking right away.")
        : "Screen Recording permission is required to capture screenshots.\n\n" +
          "Steps to enable:\n" +
          '1. Click "Open System Settings" below\n' +
          '2. Find "TrackFlow" in the list and toggle it ON\n' +
          '3. macOS will ask you to "Quit & Reopen" — click it\n' +
          "\nYour selected project will be remembered after restart.";

    const result = await dialog.showMessageBox({
        type: "info",
        title: "Screen Recording Permission Required",
        message: "TrackFlow needs screen recording access",
        detail,
        buttons: ["Open System Settings", "Skip for Now"],
        defaultId: 0,
        cancelId: 1,
    });

    if (result.response === 0) {
        // Save state before directing user to settings (they may need to restart)
        saveRestartState();
        shell.openExternal(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        );
        return "opened-settings";
    } else {
        _screenPermissionDeclinedThisSession = true;
        return "declined";
    }
}

let tray = null;
let popupWindow = null;
let loginWindow = null;

// Popup window size. Defined ONCE and shared by BOTH the initial creation and the
// re-show reposition, so the two can never drift apart (the bug where the window
// launched at one size and then resized itself on the next tray click).
const POPUP_WIDTH = 320;
const POPUP_HEIGHT = 400;
let idleAlertWindow = null;
let apiClient = null;
let activityMonitor = null;
let screenshotService = null;
let idleDetector = null;
let offlineQueue = null;
let networkMonitor = null;
let isTimerRunning = false;
let isTimerPaused = false;
let currentEntry = null;
let _lastScreenshotAt = null; // ISO timestamp of the most recent captured screenshot
// Two totals for multi-project clarity
let todayTotalGlobal = 0; // All projects today (tray when stopped)
let todayTotalCurrentProject = 0; // Current entry's project today, completed only (tray when running)
let config = {};
let loginHandlerRegistered = false;
let cachedProjects = [];
let _projectsFetchedAt = 0;
let _projectsRefreshInterval = null;
/** Refresh project list from API at most once per 30 minutes; idle popup uses cache. */
const PROJECTS_CACHE_TTL_MS = 30 * 60 * 1000;
/**
 * When a project-picking surface OPENS (popup / idle reassign dropdown), force a
 * fresh fetch if the cache is older than this so a newly assigned project appears
 * without waiting out the 30-min TTL or restarting. Short enough to feel live,
 * long enough that rapid re-opens don't hammer the API.
 */
const PROJECTS_OPEN_REFRESH_MS = 60 * 1000;

function isProjectsCacheFresh() {
    return (
        _projectsFetchedAt > 0 &&
        Date.now() - _projectsFetchedAt < PROJECTS_CACHE_TTL_MS
    );
}

/**
 * Load projects from API with TTL cache. On failure, keeps the last good list
 * so slow/offline networks do not empty the idle reassign dropdown.
 */
async function loadProjects(options = {}) {
    const { force = false } = options;
    if (!apiClient) return cachedProjects;
    if (!force && isProjectsCacheFresh()) return cachedProjects;

    try {
        const projects = await apiClient.getProjects();
        if (Array.isArray(projects)) {
            cachedProjects = projects;
            _projectsFetchedAt = Date.now();
        }
    } catch (e) {
        console.warn("[Projects] Fetch failed — using cached list:", e.message);
    }
    return cachedProjects;
}

/** Non-blocking refresh when cache is stale or empty. */
function refreshProjectsIfStale() {
    if (!apiClient) return;
    if (isProjectsCacheFresh()) return;
    loadProjects({ force: true })
        .then((projects) => pushProjectsToIdleAlert(projects))
        .catch(() => {});
}

/**
 * Force a project refresh when a project-picking surface opens, so a newly assigned
 * project shows up without waiting out the 30-min cache or restarting the app.
 * Throttled (PROJECTS_OPEN_REFRESH_MS) so rapid re-opens don't hammer the API; the
 * cached list is shown immediately so the surface is never empty while in flight.
 * The long TTL cache remains the offline/slow-network fallback.
 */
function refreshProjectsOnOpen(onUpdated) {
    if (!apiClient) return;
    const recentlyFetched =
        _projectsFetchedAt > 0 &&
        Date.now() - _projectsFetchedAt < PROJECTS_OPEN_REFRESH_MS;
    if (recentlyFetched) return;
    loadProjects({ force: true })
        .then((projects) => {
            if (typeof onUpdated === "function") onUpdated(projects);
        })
        .catch(() => {});
}

function pushProjectsToIdleAlert(projects) {
    if (!idleAlertWindow || idleAlertWindow.isDestroyed()) return;
    if (!Array.isArray(projects) || projects.length === 0) return;
    idleAlertWindow.webContents.send("idle-data", { projects });
}

function startProjectsRefreshInterval() {
    if (_projectsRefreshInterval) return;
    _projectsRefreshInterval = setInterval(() => {
        loadProjects({ force: true })
            .then((projects) => pushProjectsToIdleAlert(projects))
            .catch(() => {});
    }, PROJECTS_CACHE_TTL_MS);
}

function stopProjectsRefreshInterval() {
    if (_projectsRefreshInterval) {
        clearInterval(_projectsRefreshInterval);
        _projectsRefreshInterval = null;
    }
}

function clearProjectsCache() {
    cachedProjects = [];
    _projectsFetchedAt = 0;
    stopProjectsRefreshInterval();
}
let isAuthenticated = false;
let timerSyncInterval = null;
let trayTimerInterval = null;
let isQuitting = false;
// Idle action mutex — prevents double-action from auto-stop + user click race
let _idleActionInProgress = false;
// Mutex between reconcileTimerState and handleIdleAction (FIX D4)
let _isHandlingIdleAction = false;
// Timestamp when the idle alert window was shown (FIX D1) — used to exclude dialog wait from idle_seconds
let _idleAlertShownAt = null;
// DISPLAY-ONLY: seconds of idle that an OFFLINE reassign moved to another project but
// the server split has not yet been applied (timer is offline). The local timer is
// still anchored at the original start (we must NOT re-anchor offline — that breaks
// the reconnect split and gets reverted by reconcile), so the live elapsed wrongly
// includes the reassigned idle on the origin project. We subtract this from the
// DISPLAYED total only; it touches no entry/session/reconcile state and is cleared
// once the reassign syncs (reanchorFromOfflineIdle), or on stop/start.
let _pendingOfflineReassignIdleSec = 0;
// Tray click timestamp — used to suppress spurious blur events on macOS/Windows
let _lastTrayClickAt = 0;
// Cache parsed started_at timestamp to avoid re-parsing every second
let _cachedStartedAtMs = null;
// M8 FIX: Clock skew compensation — server time minus local time
let _clockOffsetMs = 0;
// Timer state version — incremented on key transitions to detect stale state (FIX D7)
let _timerStateVersion = 0;
// BUG 3 FIX: Mutex to prevent concurrent stopTimer calls (user / auto-stop / idle / sync).
let _stopTimerInProgress = false;
// BUG 3 FIX: Shared guard so reconcileTimerState() and the startTimerSync loop can never
// mutate timer state (currentEntry, _cachedStartedAtMs, isTimerRunning) concurrently.
let _timerStateMutationInProgress = false;

/**
 * BUG 2 FIX: Adopt a server `started_at` into the display anchor ONLY when it does
 * not move the anchor LATER than the local source of truth. The local SQLite
 * `started_at` is immutable truth; the server must never push the visible start
 * forward (which causes the timer to jump backward). We accept a server start
 * only when there is no local cached start yet, or the server start is
 * earlier-or-equal (never lose time, never jump).
 */
function adoptServerStartedAt(serverStartedAtIso) {
    const serverMs = serverStartedAtIso
        ? new Date(serverStartedAtIso).getTime()
        : null;
    if (serverMs == null || Number.isNaN(serverMs)) return;
    if (_cachedStartedAtMs == null || serverMs <= _cachedStartedAtMs) {
        _cachedStartedAtMs = serverMs;
    }
    // else: server start is LATER than local truth — keep local anchor (immutable).
}

/** Restore in-memory timer state from an open SQLite timer_sessions row (phantom-stop recovery). */
function restoreInMemoryFromLocalActive(localActive) {
    if (!localActive || localActive.ended_at) return false;
    isTimerRunning = true;
    isTimerPaused = false;
    currentEntry = {
        id: localActive.server_entry_id || localActive.id,
        started_at: localActive.started_at,
        project_id: localActive.project_id || null,
        idempotency_key: localActive.idempotency_key,
        _localId: localActive.id,
    };
    _cachedStartedAtMs = new Date(localActive.started_at).getTime();
    return true;
}

/**
 * Apply a running /timer/status payload to local state without overwriting the
 * local started_at anchor (BUG 2). Mirrors startup + startTimerSync logic.
 */
function applyRunningStatusFromServer(status) {
    const globalTotal = status.today_total ?? 0;
    const elapsed = status.elapsed_seconds ?? 0;
    todayTotalGlobal = Math.max(0, globalTotal - elapsed);
    const projectTotal = status.project_today_total ?? globalTotal;
    todayTotalCurrentProject = Math.max(0, projectTotal - elapsed);

    const serverPaused = status.state === "paused" || status.paused === true;
    if ((!status.running && !serverPaused) || !status.entry) return false;

    isTimerRunning = true;
    isTimerPaused = serverPaused;
    const localActive = getActiveLocalTimer();
    const previousLocalId = currentEntry?._localId || localActive?.id;
    currentEntry = {
        ...status.entry,
        _localId: previousLocalId,
        idempotency_key:
            currentEntry?.idempotency_key || localActive?.idempotency_key,
    };
    if (localActive && !localActive.ended_at && localActive.started_at) {
        _cachedStartedAtMs = new Date(localActive.started_at).getTime();
        adoptServerStartedAt(status.entry?.started_at);
    } else {
        adoptServerStartedAt(status.entry?.started_at);
        if (_cachedStartedAtMs == null && status.entry?.started_at) {
            _cachedStartedAtMs = new Date(status.entry.started_at).getTime();
        }
    }
    return true;
}

function isServerTimerPaused(status) {
    return status?.state === "paused" || status?.paused === true;
}

function isServerTimerOpen(status) {
    return status?.running === true || isServerTimerPaused(status);
}

/**
 * Adopt an open server timer (running or paused) and align capture services.
 */
function syncOpenTimerFromServerStatus(status, { notify = "auto" } = {}) {
    if (!isServerTimerOpen(status) || !status.entry) return false;
    const wasRunning = isTimerRunning;
    const wasPaused = isTimerPaused;
    if (!applyRunningStatusFromServer(status)) return false;

    if (isTimerPaused) {
        activityMonitor?.stop();
        screenshotService?.stop();
        if (!idleDetector?.isIdleActive()) idleDetector?.stop();
        stopTrayTimer();
        updateTrayIcon(true);
        const shouldNotify =
            notify === "pause" ||
            (notify === "auto" && (!wasRunning || !wasPaused));
        if (shouldNotify) {
            notifyPopup("timer-paused", {
                entry: currentEntry,
                elapsed: status.elapsed_seconds ?? 0,
                todayTotal: todayTotalCurrentProject,
            });
        }
    } else {
        activityMonitor?.start();
        if (currentEntry?.id) screenshotService?.start(currentEntry.id);
        idleDetector?.start();
        startTrayTimer();
        updateTrayIcon(true);
        const shouldNotify =
            notify === "start" || (notify === "auto" && !wasRunning);
        if (shouldNotify) {
            notifyPopup("timer-started", {
                ...currentEntry,
                todayTotal: todayTotalCurrentProject,
            });
        }
    }
    return true;
}

/** True when server says stopped but local SQLite / idle state says keep running. */
function shouldPreserveLocalRunningWhenServerStopped() {
    if (isTimerPaused) return true;
    if (idleDetector?.isIdleActive()) return true;
    const localActive = getActiveLocalTimer();
    if (isTimerRunning && localActive && !localActive.synced_start) return true;
    // Phantom-stop cleared in-memory state but SQLite still has an open session.
    if (!isTimerRunning && localActive && !localActive.ended_at) return true;
    return false;
}

function scheduleReconcileAndFlush() {
    if (networkMonitor?.isOnline && offlineQueue && apiClient) {
        setImmediate(() => {
            reconcileTimerState()
                .then(() => offlineQueue.flush(apiClient))
                .catch(() => {});
        });
    }
}

async function pauseTimerForIdle(idleStartedAtIso) {
    if (!isTimerRunning || isTimerPaused) return;
    isTimerPaused = true;
    logToFile(
        "info",
        `[TIMER_PAUSE] idle startedAt=${idleStartedAtIso || "now"}`,
    );
    activityMonitor?.stop();
    screenshotService?.stop();
    stopTrayTimer();
    if (
        apiClient &&
        currentEntry?.id &&
        !String(currentEntry.id).startsWith("local-")
    ) {
        try {
            await apiClient.pauseTimer({
                pausedAt: idleStartedAtIso || new Date().toISOString(),
                reason: "idle",
            });
        } catch (e) {
            console.warn(
                "[Timer] Server pause failed (will retry on reconcile):",
                e.message,
            );
        }
    }
    // Freeze the popup at the IDLE-START elapsed (active time when the user stopped
    // interacting), NOT at pause time. Pause fires ~5 min later (after the idle
    // threshold), so `now - startedAt` bakes the threshold minutes into the frozen
    // value (e.g. 10:43) and OVERWRITES the corrected idle-start tick (e.g. 05:42) the
    // idle handler just pushed — leaving the popup disagreeing with the tray. Anchor to
    // idleStartedAtIso so both show the same idle-start elapsed.
    const pauseAnchorMs = idleStartedAtIso
        ? new Date(idleStartedAtIso).getTime()
        : Date.now();
    notifyPopup("timer-paused", {
        entry: currentEntry,
        todayTotal: todayTotalCurrentProject,
        elapsed: _cachedStartedAtMs
            ? Math.max(0, Math.floor((pauseAnchorMs - _cachedStartedAtMs) / 1000))
            : 0,
    });
}

async function resumeTimerAfterIdle() {
    if (!isTimerRunning) return;
    isTimerPaused = false;
    logToFile("info", "[TIMER_RESUME] after idle action");
    if (
        apiClient &&
        currentEntry?.id &&
        !String(currentEntry.id).startsWith("local-")
    ) {
        try {
            await apiClient.resumeTimer();
        } catch (e) {
            console.warn("[Timer] Server resume failed:", e.message);
        }
    }
    notifyPopup("timer-resumed", {
        ...currentEntry,
        todayTotal: todayTotalCurrentProject,
    });
}
// NOTE: _suspendedAt is declared inside initializeApp() as a closure variable
// co-located with the powerMonitor handlers that use it. Do not re-declare here.

// ── Local Timer State (SQLite) ──────────────────────────────────────────────
// Persists timer state locally so no time is lost during network outages.
// Uses the same offline-queue.db via a lazy-initialized reference.
let _localTimerDb = null;

function _getLocalTimerDb() {
    if (_localTimerDb) return _localTimerDb;
    try {
        const Database = require("better-sqlite3");
        const dbPath = path.join(app.getPath("userData"), "offline-queue.db");
        _localTimerDb = new Database(dbPath);
        _localTimerDb.pragma("journal_mode = WAL");
        _localTimerDb.pragma("busy_timeout = 5000");

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
        console.error("[LocalTimerDb] Init failed:", e.message);
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
            "INSERT OR REPLACE INTO timer_sessions (id, idempotency_key, project_id, started_at) VALUES (?, ?, ?, ?)",
        ).run(id, idempotencyKey, projectId, startedAt);
    } catch (e) {
        console.error("[LocalTimerDb] saveStart failed:", e.message);
    }
}

function markLocalTimerStartSynced(localId, serverEntryId) {
    const db = _getLocalTimerDb();
    if (!db) return;
    try {
        db.prepare(
            "UPDATE timer_sessions SET synced_start = 1, server_entry_id = ? WHERE id = ?",
        ).run(serverEntryId, localId);
    } catch (e) {
        console.error("[LocalTimerDb] markStartSynced failed:", e.message);
    }
}

function saveLocalTimerStop(localId, endedAt, durationSeconds) {
    const db = _getLocalTimerDb();
    if (!db) return;
    try {
        db.prepare(
            "UPDATE timer_sessions SET ended_at = ?, duration_seconds = ? WHERE id = ?",
        ).run(endedAt, durationSeconds, localId);
    } catch (e) {
        console.error("[LocalTimerDb] saveStop failed:", e.message);
    }
}

function markLocalTimerStopSynced(localId) {
    const db = _getLocalTimerDb();
    if (!db) return;
    try {
        db.prepare(
            "UPDATE timer_sessions SET synced_stop = 1 WHERE id = ?",
        ).run(localId);
    } catch (e) {
        console.error("[LocalTimerDb] markStopSynced failed:", e.message);
    }
}

function getUnsyncedTimerSessions() {
    const db = _getLocalTimerDb();
    if (!db) return [];
    try {
        return db
            .prepare(
                "SELECT * FROM timer_sessions WHERE synced_start = 0 OR (ended_at IS NOT NULL AND synced_stop = 0) ORDER BY created_at ASC",
            )
            .all();
    } catch (e) {
        console.error("[LocalTimerDb] getUnsynced failed:", e.message);
        return [];
    }
}

/**
 * True when the local DB has a STOP for `serverEntryId` that hasn't synced yet
 * (ended_at set, synced_stop = 0). A server status that still reports this entry as
 * "open" is then STALE — the user stopped it locally but the stop didn't reach the
 * server (slow/failed network). The sync loop must NOT re-adopt it as running (that
 * is the self-restart-after-stop bug); reconcile pushes the pending stop instead.
 */
function hasUnsyncedLocalStopForEntry(serverEntryId) {
    if (!serverEntryId) return false;
    const db = _getLocalTimerDb();
    if (!db) return false;
    try {
        const row = db
            .prepare(
                "SELECT 1 FROM timer_sessions WHERE server_entry_id = ? AND ended_at IS NOT NULL AND synced_stop = 0 LIMIT 1",
            )
            .get(String(serverEntryId));
        return !!row;
    } catch (e) {
        console.warn(
            "[LocalTimerDb] hasUnsyncedLocalStopForEntry failed:",
            e.message,
        );
        return false;
    }
}

// An open local session older than this is implausible (sleep/lock auto-stop and
// the startup-gap close cap real sessions well under a day) — it's a stale row left
// by a killed/old session (possibly a different account, since timer_sessions has no
// user_id). Never restore it as a live timer; close it so it can't show up as a
// phantom "Tracking 149:47:48".
const MAX_PLAUSIBLE_OPEN_SESSION_MS = 24 * 60 * 60 * 1000;

function getActiveLocalTimer() {
    const db = _getLocalTimerDb();
    if (!db) return null;
    try {
        const row =
            db
                .prepare(
                    "SELECT * FROM timer_sessions WHERE ended_at IS NULL ORDER BY created_at DESC LIMIT 1",
                )
                .get() || null;
        if (row && row.started_at) {
            const ageMs = Date.now() - new Date(row.started_at).getTime();
            if (!Number.isFinite(ageMs) || ageMs > MAX_PLAUSIBLE_OPEN_SESSION_MS) {
                // Stale/garbage open session — close it instead of restoring it live.
                console.warn(
                    `[LocalTimerDb] Discarding stale open session ${row.id} (age ${Math.round(ageMs / 3600000)}h) — not restoring as a live timer`,
                );
                const endedAt = row.started_at; // zero-duration close; never counts time
                saveLocalTimerStop(row.id, endedAt, 0);
                return null;
            }
        }
        return row;
    } catch (e) {
        console.error("[LocalTimerDb] getActive failed:", e.message);
        return null;
    }
}

function cleanOldLocalTimerSessions() {
    const db = _getLocalTimerDb();
    if (!db) return;
    try {
        // Remove fully synced sessions older than 7 days
        db.prepare(
            "DELETE FROM timer_sessions WHERE synced_start = 1 AND synced_stop = 1 AND created_at < datetime('now', '-7 days')",
        ).run();
    } catch (e) {
        console.error("[LocalTimerDb] cleanup failed:", e.message);
    }
}

/**
 * Wipe ALL local timer_sessions rows. `timer_sessions` has no user_id, so a stale
 * row left by a previous account (e.g. an open session from a killed app) is
 * otherwise restored on the NEXT login as a live "Tracking HH:MM:SS" timer with a
 * started_at hours/days in the past — even on a brand-new account with zero server
 * entries. Called on logout so the next account starts with clean local timer state.
 */
function clearLocalTimerSessions() {
    const db = _getLocalTimerDb();
    if (!db) return;
    try {
        db.prepare("DELETE FROM timer_sessions").run();
    } catch (e) {
        console.error("[LocalTimerDb] clearLocalTimerSessions failed:", e.message);
    }
}

/**
 * FIX D1/D2: Resolve a queued item's time_entry_id to the REAL server entry id.
 * A heartbeat/screenshot queued during an offline start carries a `local-…` id
 * (the timer_sessions row id) until reconcile syncs the start. Look the session
 * up by its local id OR idempotency_key and return its server_entry_id once known.
 * Returns null while the start is still unsynced, so the offline queue HOLDS the
 * item instead of sending an unresolvable id (which the server 422s and drops).
 */
function resolveServerEntryIdForQueue(meta) {
    const db = _getLocalTimerDb();
    if (!db) return null;
    const localId =
        meta && meta.time_entry_id != null ? String(meta.time_entry_id) : null;
    const idemKey = meta && meta.idempotency_key ? String(meta.idempotency_key) : null;
    try {
        let row = null;
        if (localId) {
            row = db
                .prepare(
                    "SELECT server_entry_id FROM timer_sessions WHERE id = ? AND synced_start = 1 AND server_entry_id IS NOT NULL LIMIT 1",
                )
                .get(localId);
        }
        if (!row && idemKey) {
            row = db
                .prepare(
                    "SELECT server_entry_id FROM timer_sessions WHERE idempotency_key = ? AND synced_start = 1 AND server_entry_id IS NOT NULL LIMIT 1",
                )
                .get(idemKey);
        }
        if (row && row.server_entry_id && !String(row.server_entry_id).startsWith("local-")) {
            return String(row.server_entry_id);
        }
    } catch (e) {
        console.warn("[LocalTimerDb] resolveServerEntryIdForQueue failed:", e.message);
    }
    return null;
}

/**
 * FIX D3: Re-anchor local timer state to the post-split entry returned by a
 * queued idle_discard/idle_reassign that flushed after reconnect. Mirrors the
 * ONLINE re-anchor in handleIdleAction so the desktop never stays bound to the
 * now-closed entry. Guarded by the same mutexes so it can't race reconcile or a
 * live idle action.
 */
function reanchorFromOfflineIdle(payload, newEntry) {
    if (!newEntry || !newEntry.started_at) return;
    if (_timerStateMutationInProgress || _isHandlingIdleAction) {
        console.log(
            "[OfflineIdle] Skipping re-anchor — timer state mutation/idle action in progress",
        );
        return;
    }
    // Only re-anchor when we still have a running local timer to move. If the timer
    // was stopped meanwhile, the queue's isLocalTimerActive() guard already dropped
    // the item; this is a defensive second check.
    const localActive = getActiveLocalTimer();
    if (!isTimerRunning && !(localActive && !localActive.ended_at)) {
        console.log("[OfflineIdle] No active local timer — skipping re-anchor");
        return;
    }

    _timerStateMutationInProgress = true;
    try {
        const idleStartedAtMs = payload?.idle_started_at
            ? new Date(payload.idle_started_at).getTime()
            : null;
        const prevLocalId = currentEntry?._localId || localActive?.id || null;
        const prevStartIso =
            currentEntry?.started_at || localActive?.started_at || null;

        // Close the stale local session at idle-start (server already split it).
        if (prevLocalId && idleStartedAtMs && prevStartIso) {
            const preIdleDuration = Math.max(
                0,
                Math.floor(
                    (idleStartedAtMs - new Date(prevStartIso).getTime()) / 1000,
                ),
            );
            saveLocalTimerStop(
                prevLocalId,
                new Date(idleStartedAtMs).toISOString(),
                preIdleDuration,
            );
            markLocalTimerStopSynced(prevLocalId);
        }

        // Adopt the new (post-idle) server entry as the source of truth.
        currentEntry = { ...newEntry };
        _cachedStartedAtMs = new Date(newEntry.started_at).getTime();
        isTimerRunning = true;
        isTimerPaused = false;
        // The offline reassign just synced and the anchor now sits at idle-end, so the
        // display-only subtraction is no longer needed — clear it (otherwise the live
        // total would under-count by the reassigned idle from here on).
        _pendingOfflineReassignIdleSec = 0;

        // Open a fresh local session anchored at the new entry's start.
        const newLocalId = `local-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 6)}`;
        const newIdempotencyKey =
            newEntry.idempotency_key || generateIdempotencyKey();
        saveLocalTimerStart(
            newLocalId,
            newIdempotencyKey,
            newEntry.project_id || null,
            newEntry.started_at,
        );
        if (newEntry.id && !String(newEntry.id).startsWith("local-")) {
            markLocalTimerStartSynced(newLocalId, newEntry.id);
        }
        currentEntry._localId = newLocalId;
        currentEntry.idempotency_key = newIdempotencyKey;

        // FIX D2: rebind the live screenshot service to the new server entry id
        // so post-reanchor captures don't keep the stale id.
        if (newEntry.id && !String(newEntry.id).startsWith("local-")) {
            screenshotService?.rebindEntryId(newEntry.id);
        }

        _timerStateVersion++;
        console.log(
            `[OfflineIdle] Re-anchored to post-idle entry ${newEntry.id} (start=${newEntry.started_at})`,
        );
        notifyPopup("timer-started", {
            ...currentEntry,
            todayTotal: todayTotalCurrentProject,
            _splitFromIdle: true,
        });
    } catch (e) {
        console.error("[OfflineIdle] Re-anchor failed:", e.message);
    } finally {
        _timerStateMutationInProgress = false;
    }
}

// ── Global Error Handlers ────────────────────────────────────────────────────

process.on("uncaughtException", (error) => {
    console.error("Uncaught exception:", error);
    posthog.captureError("unknown", error, { type: "uncaught_exception" });
    // Don't crash — log and continue. Critical for a background agent.
});

process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
    posthog.captureError(
        "unknown",
        reason instanceof Error ? reason : new Error(String(reason)),
        { type: "unhandled_rejection" },
    );
});

// ── Single Instance Lock ─────────────────────────────────────────────────────

// Flag the Windows uninstaller passes (see build/installer.nsh) to ask a running
// instance to stop its timer gracefully before the files are removed.
const UNINSTALL_STOP_FLAG = "--uninstall-stop";

const gotTheLock = app.requestSingleInstanceLock();
console.log(
    `Single instance lock: ${gotTheLock ? "acquired" : "FAILED (another instance running)"}`,
);
if (!gotTheLock) {
    // Another instance is primary. If the uninstaller launched us with the flag,
    // our argv was forwarded to that primary via the second-instance event below;
    // either way this secondary process just exits.
    console.log("Exiting — another instance holds the lock");
    app.quit();
} else if (process.argv.includes(UNINSTALL_STOP_FLAG)) {
    // Uninstaller launched us but no app was running — there is no in-memory timer
    // to stop (the backend reclaim / scheduled cleanup closes any orphaned entry).
    // Exit immediately without initializing UI/tracking.
    console.log(
        "[Uninstall] --uninstall-stop with no running instance; exiting without init.",
    );
    app.quit();
}

app.on("second-instance", (_event, argv) => {
    // The Windows uninstaller relaunches us with --uninstall-stop; the lock forwards
    // that argv here to the running app. app.quit() runs the before-quit graceful
    // stop (local SQLite + best-effort server stop), then exits.
    if (Array.isArray(argv) && argv.includes(UNINSTALL_STOP_FLAG)) {
        console.log(
            "[Uninstall] --uninstall-stop received — stopping timer and quitting.",
        );
        app.quit();
        return;
    }
    showPopup();
});

app.on("ready", async () => {
    console.log("app.ready fired — initializing...");
    await initializeApp();
    console.log("initializeApp() complete");
    // In dev mode, auto-show the popup so CDP remote debugging can connect to it
    if (process.env.NODE_ENV === "development") {
        setTimeout(() => showPopup(), 500);
    }
});

app.on("window-all-closed", () => {
    // Don't quit — keep running in system tray
});

// Stop timer gracefully before quitting (with timeout to avoid hanging)
app.on("before-quit", async (e) => {
    if (isQuitting) return; // Prevent re-entry

    if (isTimerRunning && apiClient) {
        e.preventDefault();
        isQuitting = true;
        console.log(
            "[Quit] Timer running — recording local stop, then exiting",
        );
        // HARD GUARANTEE: always exit within 3s no matter what hangs (slow server
        // stop, or an unreachable PostHog flush). Without this the first Quit could
        // appear to do nothing and the user had to click Quit twice.
        const forceExit = setTimeout(() => {
            console.warn(
                "[Quit] Force-exit fallback fired (cleanup exceeded 3s)",
            );
            app.exit(0);
        }, 3000);
        forceExit.unref?.();
        // LOCAL-FIRST: record the stop locally (synchronous, instant). The timer is
        // stopped regardless of whether the server/posthog calls below succeed —
        // reconcileTimerState() on next launch syncs if the server stop didn't land.
        const localId = currentEntry?._localId;
        const quitEndedAt = new Date().toISOString();
        const quitDuration =
            currentEntry && _cachedStartedAtMs
                ? Math.max(
                      0,
                      Math.floor((Date.now() - _cachedStartedAtMs) / 1000),
                  )
                : 0;
        if (localId) {
            saveLocalTimerStop(localId, quitEndedAt, quitDuration);
        }
        try {
            // BUG 3 FIX: target the specific server entry so we never close a newer one.
            const stopPayload = currentEntry?._localId
                ? {
                      started_at: currentEntry?.started_at,
                      ended_at: quitEndedAt,
                  }
                : {};
            if (
                currentEntry?.id &&
                !String(currentEntry.id).startsWith("local-")
            )
                stopPayload.time_entry_id = currentEntry.id;
            if (currentEntry?.idempotency_key)
                stopPayload.idempotency_key = currentEntry.idempotency_key;
            await Promise.race([
                apiClient.stopTimer(stopPayload),
                new Promise((resolve) => setTimeout(resolve, 2000)),
            ]);
            if (localId) markLocalTimerStopSynced(localId);
        } catch {}
        isTimerRunning = false;
        isTimerPaused = false;
        currentEntry = null;
        activityMonitor?.stop();
        screenshotService?.stop();
        idleDetector?.stop();
        // Bound the PostHog flush — it was unbounded and could hang the quit forever.
        await Promise.race([
            posthog.shutdown(),
            new Promise((resolve) => setTimeout(resolve, 800)),
        ]);
        cleanupOnExit();
        clearTimeout(forceExit);
        console.log("[Quit] Clean exit");
        app.exit(0);
    } else {
        idleDetector?.stop();
        // Bound the PostHog flush so a no-timer quit can't hang either.
        await Promise.race([
            posthog.shutdown(),
            new Promise((resolve) => setTimeout(resolve, 800)),
        ]);
        cleanupOnExit();
    }
});

function cleanupOnExit() {
    if (timerSyncInterval) {
        clearInterval(timerSyncInterval);
        timerSyncInterval = null;
    }
    stopProjectsRefreshInterval();
    stopTrayTimer();
    offlineQueue?.close();
}

// CLEANUP-FIX: Remove powerMonitor and app listeners that reference stale apiClient/services.
// Called from both forceLogout and performLogout to prevent stale callback crashes.
function removeSessionListeners() {
    PowerManager.unregisterPowerHandlers();
    app.removeAllListeners("browser-window-focus");
}

// Force logout — called when token refresh fails (password changed, tokens revoked).
// Stops timer locally (does NOT call server since token is invalid), clears state, shows login.
let _forceLogoutInProgress = false;
async function forceLogout() {
    if (_forceLogoutInProgress) return;
    _forceLogoutInProgress = true;

    console.warn("[Auth] Force logout — stopping all services");
    posthog.capture(currentEntry?.user_id || "unknown", "force_logged_out", {
        reason: "token_refresh_failed",
    });

    const localActive = getActiveLocalTimer();
    if (localActive && !localActive.ended_at) {
        const endedAt = new Date().toISOString();
        const dur = localActive.started_at
            ? Math.max(
                  0,
                  Math.floor(
                      (Date.now() -
                          new Date(localActive.started_at).getTime()) /
                          1000,
                  ),
              )
            : 0;
        saveLocalTimerStop(localActive.id, endedAt, dur);
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

    // Wipe local timer_sessions on forced logout too — the next account must not
    // inherit a stale row (no user_id on the table). See clearLocalTimerSessions().
    clearLocalTimerSessions();

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
    clearProjectsCache();
    todayTotalGlobal = 0;
    todayTotalCurrentProject = 0;
    config = {};
    currentShift = null;

    if (popupWindow && !popupWindow.isDestroyed()) {
        popupWindow.destroy();
    }
    popupWindow = null;

    // Update tray icon to idle state
    updateTrayIcon(false);
    setTrayText("");

    createLoginWindow();
    _forceLogoutInProgress = false;
}

let _selfRemovalWatcher = null;

/**
 * Cross-platform uninstall safety net: while the app is running, poll its own
 * install path. If the binary/bundle disappears (uninstall in progress) we call
 * app.quit(), whose before-quit handler performs the graceful local + best-effort
 * server timer stop. Covers macOS Trash and Linux AppImage delete (no OS hook) and
 * backstops Windows. Suppressed in dev and during auto-update (isQuitting), so an
 * updater file-swap is never mistaken for an uninstall.
 */
function startSelfRemovalWatcher() {
    if (_selfRemovalWatcher) return;

    const watchTarget = resolveWatchTarget(process.env, app.getPath("exe"));
    if (!app.isPackaged || !watchTarget) {
        return; // dev tree / unknown path — nothing meaningful to watch
    }

    console.log(`[Uninstall] Watching install path for removal: ${watchTarget}`);
    _selfRemovalWatcher = setInterval(() => {
        let pathExists = true;
        try {
            pathExists = fs.existsSync(watchTarget);
        } catch {
            // Transient FS error — treat as present; don't quit on a hiccup.
            pathExists = true;
        }

        if (
            shouldStopForRemoval({
                isPackaged: app.isPackaged,
                isQuitting,
                pathExists,
            })
        ) {
            console.warn(
                "[Uninstall] Install path removed — stopping timer and quitting.",
            );
            clearInterval(_selfRemovalWatcher);
            _selfRemovalWatcher = null;
            app.quit(); // before-quit performs the graceful timer stop
        }
    }, 5000);
    _selfRemovalWatcher.unref?.();
}

async function initializeApp() {
    // Register theme handler early — needed by both login and main windows
    ipcMain.removeHandler("get-theme");
    ipcMain.handle("get-theme", () => getOSTheme());

    // Stop the timer if the app is uninstalled while running (all OSes).
    startSelfRemovalWatcher();

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
        console.warn(
            "[Auth] Token refresh failed — forcing logout (password likely changed)",
        );
        forceLogout();
    });

    // Initialize PostHog analytics (key loaded from .env via loadEnv() above)
    const posthogKey = process.env.POSTHOG_KEY || "";
    const posthogHost = process.env.POSTHOG_HOST || "https://us.i.posthog.com";
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
        posthog.capture(user.id, "app_launched", { version: app.getVersion() });
    }

    // Fetch org config with fallback to defaults
    try {
        const serverConfig = await apiClient.getConfig();
        config = { ...DEFAULT_CONFIG, ...serverConfig };
    } catch {
        config = { ...DEFAULT_CONFIG };
    }

    // Fetch initial shift data
    try {
        const shiftData = await apiClient.getMyShift();
        currentShift = shiftData?.shift || null;
    } catch {}

    // Initialize services
    offlineQueue = new OfflineQueue();
    // FIX D1/D2: Let the offline queue resolve a `local-…` time_entry_id to the
    // real server entry id via timer_sessions before sending heartbeats/screenshots.
    offlineQueue.resolveServerEntryId = resolveServerEntryIdForQueue;
    // FIX D3: When a queued idle_discard flushes and the server splits the entry,
    // re-anchor local timer state to the new (post-idle) entry — same as online.
    offlineQueue.onIdleReanchor = reanchorFromOfflineIdle;
    // FIX D3: A queued idle_discard must be dropped if the timer was stopped before
    // it flushed (no active local session) — replaying it would resurrect the timer.
    offlineQueue.isLocalTimerActive = () => {
        if (isTimerRunning) return true;
        const la = getActiveLocalTimer();
        return !!(la && !la.ended_at);
    };
    activityMonitor = new ActivityMonitor(apiClient, offlineQueue);
    activityMonitor.setOnHeartbeatSuccess(() => touchLastActiveAt());
    // Anchor offline-queued heartbeats to the live entry (local id + idempotency_key)
    // so resolveServerEntryIdForQueue() can map them to the server entry on replay
    // instead of the queue dropping them as unanchored orphans (offline activity loss).
    activityMonitor.getCurrentEntryMeta = () =>
        currentEntry
            ? {
                  time_entry_id: currentEntry._localId || currentEntry.id || null,
                  idempotency_key: currentEntry.idempotency_key || null,
              }
            : null;
    const getIsAppVisible = () =>
        popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible();
    screenshotService = new ScreenshotService(
        apiClient,
        config,
        offlineQueue,
        getIsAppVisible,
        activityMonitor,
    );
    // Register the screenshot-captured callback ONCE at service creation so that
    // _lastScreenshotAt is updated and a live `activity-update` is pushed to the
    // popup on EVERY capture — regardless of which path called screenshotService
    // .start() (normal start, app-startup resume, idle keep/discard/reassign, or
    // sleep/wake resume). Previously this was registered only inside
    // afterStartTimer(), so any timer not started via that path (e.g. a timer
    // resumed on app startup) never updated the "Last SS …" indicator, and after
    // an idle → Keep cycle the indicator stayed empty/stale.
    screenshotService.setScreenshotCapturedCallback(() => {
        _lastScreenshotAt = new Date().toISOString();
        if (popupWindow && !popupWindow.isDestroyed()) {
            popupWindow.webContents.send("activity-update", {
                activityScore: activityMonitor
                    ? activityMonitor.getCurrentScore()
                    : 0,
                lastScreenshotAt: _lastScreenshotAt,
                isOnline: networkMonitor?.isOnline ?? true,
            });
        }
    });
    screenshotService.setRestartStateSaver(() => saveRestartState());
    screenshotService.setWallpaperDetectedCallback(() => {
        console.log(
            "[Permission] Wallpaper-only capture detected — notifying renderer",
        );
        notifyPopup("screenshot-permission-issue", {
            type: "wallpaper-detected",
            message:
                "Screenshots may only show your wallpaper. Screen Recording permission needs to be refreshed.",
        });
    });
    idleDetector = new IdleDetector(config);

    // Initialize network monitor for online/offline detection
    networkMonitor = new NetworkMonitor();
    networkMonitor.on("online", async () => {
        console.log("[Network] Back online — reconciling and flushing");
        // Reconcile local timer state with server before flushing queue
        await reconcileTimerState();
        await offlineQueue?.flush(apiClient);
        // Notify renderer of status change
        notifyPopup("network-status", { online: true });
        // CONVERGENCE: after an offline stop/discard syncs, the tray title still
        // shows the offline-local total (the live whole-second counter's floored
        // value, which can sit 1s above the server's stored duration). Refresh the
        // stopped total from the server so the tray, popup, and web all agree on the
        // authoritative value instead of leaving the tray 1s ahead.
        if (!isTimerRunning && apiClient) {
            try {
                const serverTotal = await apiClient.getTodayTotal(null);
                if (serverTotal != null && serverTotal >= 0) {
                    todayTotalGlobal = serverTotal;
                    updateTrayTitle();
                    notifyPopup("timer-stopped", {
                        entry: null,
                        todayTotal: serverTotal,
                        todayTotalGlobal: serverTotal,
                    });
                }
            } catch {
                // Still offline / server unreachable — keep the local total (never 0).
            }
        }
    });
    networkMonitor.on("offline", () => {
        console.log("[Network] Gone offline");
        notifyPopup("network-status", { online: false });
    });
    networkMonitor.start();

    // Wire idle detection events
    idleDetector.onIdleDetected((idleSeconds, idleStartedAt, actionId) => {
        // Pause activity capture during idle (prevents zero-event heartbeats from
        // dragging down the activity score). Screenshots are handled per-policy below.
        const policy = config.keep_idle_time || "prompt";

        // Hubstaff behavior: NEVER capture screenshots while the user is idle.
        // Screenshots stop entirely the moment idle is detected, for every policy.
        // (If the idle period later becomes billable via Keep/Reassign, no shots are
        // backfilled — idle time shows no screenshots, exactly like Hubstaff.)
        screenshotService?.stop();

        activityMonitor?.stop();
        stopTrayTimer();
        if (policy === "always") {
            idleDetector.resolveIdle(actionId);
            idleDetector.start();
            // Restore tray from idle state
            updateTrayIcon(isTimerRunning);
            if (isTimerRunning) updateTrayTitle();
            activityMonitor?.start();
            if (isTimerRunning && currentEntry) {
                screenshotService?.start(currentEntry.id, {
                    immediateCapture:
                        config.screenshot_capture_immediate_after_idle === true,
                });
            }
            startTrayTimer();
            return;
        }
        if (policy === "never") {
            handleIdleAction("discard", actionId, idleSeconds, null);
            dismissIdleAlert();
            return;
        }
        // Tray during idle: show the TRACKED TIME frozen at the moment idle began
        // (e.g. "⏸ 02:26:40"), NOT "Idle (5m)" — the old text showed the idle
        // *threshold*, which is meaningless to the user. The idle period is not
        // counted yet (pending keep/discard), so we freeze at the idle-start elapsed:
        // current elapsed minus how long we've been idle. The ⏸ marks it as paused.
        const frozenSeconds = _cachedStartedAtMs
            ? todayTotalCurrentProject +
              Math.max(
                  0,
                  Math.floor((Date.now() - _cachedStartedAtMs) / 1000) -
                      idleSeconds,
              )
            : todayTotalCurrentProject;
        setTrayText(`⏸ ${formatTimeShort(frozenSeconds)}`);
        // Freeze the MAIN WINDOW display at the same idle-start value as the tray.
        // stopTrayTimer() above halted the per-second ticks, so without this the popup
        // stays frozen at the LAST tick — which still includes the idle-threshold period
        // (the ~5 min that triggered the prompt). Push one corrected tick so the popup
        // matches the tray: frozen at the moment idle began, threshold excluded. The idle
        // interval is not counted yet (pending keep/discard/reassign). On resolve,
        // startTrayTimer() re-arms and the next live tick overwrites this value.
        if (popupWindow && !popupWindow.isDestroyed()) {
            popupWindow.webContents.send("timer-tick", {
                totalSeconds: frozenSeconds,
                formatted: formatTimeShort(frozenSeconds),
                activityScore: 0,
                lastScreenshotAt: _lastScreenshotAt,
                isOnline: networkMonitor?.isOnline ?? true,
            });
        }
        pauseTimerForIdle(
            idleStartedAt
                ? new Date(idleStartedAt).toISOString()
                : new Date().toISOString(),
        ).catch(() => {});
        showIdleAlert(idleSeconds, idleStartedAt, actionId);
    });

    idleDetector.onAutoStop((totalIdleSeconds, actionId) => {
        handleIdleAction("stop", actionId, totalIdleSeconds);
        dismissIdleAlert();

        try {
            if (Notification.isSupported()) {
                const n = new Notification({
                    title: "TrackFlow — Timer Stopped",
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

    // Load projects for tray menu + idle reassign cache, then notify the popup renderer
    loadProjects({ force: true }).then(() => {
        if (popupWindow && !popupWindow.isDestroyed()) {
            popupWindow.webContents.send("projects-ready");
        }
    });
    startProjectsRefreshInterval();

    // L7: Clean up orphaned screenshot files on startup
    offlineQueue.cleanupOrphanedFiles();

    // Flush offline queue (L7: orphan cleanup also runs after each successful flush)
    offlineQueue.flush(apiClient);

    // ── Early Screen Recording Permission Check (macOS) ──────────────────────
    // Check if permission is granted using systemPreferences API first.
    // Only probe desktopCapturer when permission is NOT granted (to register
    // the app in the macOS Screen Recording list). Probing when permission IS
    // granted triggers an unnecessary native macOS popup dialog.
    if (process.platform === "darwin") {
        const apiStatus = checkScreenRecordingPermission();
        if (apiStatus) {
            // systemPreferences says granted — trust it, no probe needed.
            // This avoids the native macOS "TrackFlow would like to record" popup.
            console.log(
                "[Permission] Screen recording granted (API) — skipping probe",
            );
            _screenPermissionGranted = true;
        } else {
            // Not granted — probe to register app in System Settings list,
            // then show onboarding dialog.
            probeScreenRecordingPermission()
                .then((probeGranted) => {
                    if (probeGranted) {
                        console.log(
                            "[Permission] Probe confirmed permission — no onboarding needed",
                        );
                        _screenPermissionGranted = true;
                        return;
                    }
                    console.log(
                        "[Permission] Screen recording NOT granted at launch — showing onboarding",
                    );
                    _screenPermissionGranted = false;
                    showScreenPermissionOnboarding({
                        isPreStart: false,
                        wasTracking: false,
                    }).catch(() => {});
                })
                .catch(() => {
                    _screenPermissionGranted = false;
                    showScreenPermissionOnboarding({
                        isPreStart: false,
                        wasTracking: false,
                    }).catch(() => {});
                });
        }
    }

    // ── Restart State Auto-Resume ────────────────────────────────────────────
    // If the app was restarted after granting Screen Recording permission,
    // restore the previous project selection and optionally auto-start tracking.
    const restartState = loadRestartState();
    if (restartState) {
        console.log(
            "[RestartState] Found restart state:",
            JSON.stringify(restartState),
        );
        clearRestartState();
        // Restore project selection
        if (restartState.projectId) {
            saveLastProjectId(restartState.projectId);
        }
        // If the user was actively tracking before the restart, auto-start
        if (restartState.wasTracking && restartState.projectId) {
            console.log(
                "[RestartState] Auto-resuming tracking for project:",
                restartState.projectId,
            );
            // Delay slightly to ensure popup window has loaded
            setTimeout(async () => {
                try {
                    const result = await startTimer(restartState.projectId);
                    if (result.success) {
                        console.log("[RestartState] Auto-resume successful");
                        showPopup();
                    } else {
                        console.warn(
                            "[RestartState] Auto-resume failed:",
                            result.error,
                        );
                    }
                } catch (e) {
                    console.error(
                        "[RestartState] Auto-resume error:",
                        e.message,
                    );
                }
            }, 2000);
        } else {
            // Just show the popup with the project pre-selected
            showPopup();
        }
    }

    // ── Startup gap detection (crash/kill where powerMonitor never fired) ─────
    try {
        await detectAndCloseStaleSessionOnStartup();
    } catch (e) {
        console.warn(
            "[Startup] detectAndCloseStaleSessionOnStartup failed:",
            e.message,
        );
    }

    // BUG 3 FIX (#7): Reconcile local unsynced sessions BEFORE adopting server
    // status. A local offline session that never synced (start and/or stop) must
    // be flushed to the server first — otherwise it sits and collides later when
    // a new session opens. reconcileTimerState() binds stops to specific entry ids
    // and sends real local started_at, so this is safe and lossless.
    try {
        await reconcileTimerState();
    } catch (e) {
        console.warn("[Startup] reconcileTimerState failed:", e.message);
    }

    // Check timer status on server
    try {
        const status = await apiClient.getTimerStatus();
        const globalTotal = status.today_total ?? 0;
        if (isServerTimerOpen(status)) {
            syncOpenTimerFromServerStatus(status);
        } else {
            todayTotalGlobal = globalTotal;
            todayTotalCurrentProject = 0;
            updateTrayTitle();
        }
    } catch {}

    // ── Sleep / Wake / Lock — hard auto-stop (timer does not count while asleep) ─
    PowerManager.registerPowerHandlers({
        isTimerRunning: () => isTimerRunning,
        autoStopForPowerEvent: autoStopTimerForPowerEvent,
        // FIX D5: Deterministically tear down idle state on every suspend/lock so an
        // armed idle detector (DETECTED/ALERTING with its _checkAutoStop interval) can
        // never survive sleep and fire a spurious auto-stop / bogus idle_discard on wake.
        // stopTimer() also stops the detector, but this covers the timer-not-running and
        // mid-alert paths too. dismissIdleAlert() closes any visible alert window.
        onSuspendCleanup: () => {
            idleDetector?.stop();
            dismissIdleAlert();
        },
        onResumeAfterSleep: () => {
            if (networkMonitor?.isOnline && offlineQueue && apiClient) {
                setImmediate(() => {
                    reconcileTimerState()
                        .then(() => offlineQueue.flush(apiClient))
                        .catch(() => {});
                });
            }
        },
    });

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
                if (isServerTimerOpen(status)) {
                    todayTotalGlobal = Math.max(0, globalTotal - elapsed);
                    const projectTotal =
                        status.project_today_total ?? globalTotal;
                    todayTotalCurrentProject = Math.max(
                        0,
                        projectTotal - elapsed,
                    );
                } else {
                    todayTotalGlobal = globalTotal;
                    todayTotalCurrentProject = 0;
                }

                if (isServerTimerOpen(status) && !isTimerRunning) {
                    if (hasUnsyncedLocalStopForEntry(status.entry?.id)) {
                        // User stopped this entry locally but the stop hasn't reached the
                        // server (slow/failed network), so the server still reports it open.
                        // Do NOT re-adopt it as running — that is the self-restart-after-stop
                        // bug. Push the pending stop via reconcile; keep the UI stopped.
                        console.log(
                            "[ImmediateSync] Server shows entry open but a local stop is pending — pushing stop, not re-opening",
                        );
                        scheduleReconcileAndFlush();
                    } else {
                        syncOpenTimerFromServerStatus(status);
                    }
                } else if (
                    isServerTimerOpen(status) &&
                    isTimerRunning &&
                    isServerTimerPaused(status) !== isTimerPaused
                ) {
                    syncOpenTimerFromServerStatus(status, {
                        notify: isServerTimerPaused(status) ? "pause" : "start",
                    });
                } else if (
                    !isServerTimerOpen(status) &&
                    (isTimerRunning || isTimerPaused)
                ) {
                    // BUG-2 FIX: Don't override local state while idle alert is showing
                    if (idleDetector?.isIdleActive()) {
                        console.log(
                            "[ImmediateSync] Server says stopped but idle alert is active — keeping local state",
                        );
                        return;
                    }
                    isTimerRunning = false;
                    isTimerPaused = false;
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
                    notifyPopup("timer-stopped", {
                        entry: null,
                        todayTotal: globalTotal,
                        todayTotalGlobal: globalTotal,
                    });
                }
            } catch {}
        })();
    };

    app.on("browser-window-focus", triggerImmediateSync);

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
    tray.setToolTip("TrackFlow");

    // macOS: left-click toggles popup window visibility
    // Windows/Linux: left-click also toggles popup
    tray.on("click", () => {
        _lastTrayClickAt = Date.now();
        if (!isAuthenticated) {
            createLoginWindow();
            return;
        }

        // Toggle popup visibility
        if (
            popupWindow &&
            !popupWindow.isDestroyed() &&
            popupWindow.isVisible()
        ) {
            popupWindow.hide();
        } else {
            showPopup();
        }
    });

    tray.on("right-click", () => {
        const contextMenu = buildTrayContextMenu();
        tray.popUpContextMenu(contextMenu);
    });
}

async function openDashboardInBrowser() {
    // Open web dashboard — do NOT pass tokens in URL (security risk: browser history, referrer headers, server logs)
    // The web app should handle its own authentication
    shell.openExternal(WEB_DASHBOARD_URL);
}

function buildTrayContextMenu() {
    if (!isAuthenticated) {
        return Menu.buildFromTemplate([
            { label: "Sign In to TrackFlow", click: () => createLoginWindow() },
            { type: "separator" },
            { label: "Quit TrackFlow", click: () => app.quit() },
        ]);
    }

    const template = [];

    // ── Status header ──────────────────────────────────────────────────────
    if (isTimerRunning && currentEntry) {
        const elapsed = _cachedStartedAtMs
            ? Math.max(
                  0,
                  Math.floor((Date.now() - _cachedStartedAtMs) / 1000) -
                      _pendingOfflineReassignIdleSec,
              )
            : 0;
        const projectName = currentEntry.project?.name || "No Project";
        template.push(
            {
                label: `Tracking: ${formatTimeShort(todayTotalCurrentProject + elapsed)}`,
                enabled: false,
            },
            { label: `Project: ${projectName}`, enabled: false },
            { type: "separator" },
        );
    } else {
        const totalLabel =
            todayTotalGlobal > 0
                ? `Today: ${formatTimeShort(todayTotalGlobal)}`
                : "Not tracking";
        template.push(
            { label: totalLabel, enabled: false },
            { type: "separator" },
        );
    }

    // ── Timer controls ─────────────────────────────────────────────────────
    if (isTimerRunning) {
        template.push({
            label: "Stop Timer",
            click: () => stopTimer(),
        });
    } else {
        const projectItems = cachedProjects.map((p) => ({
            label: p.name,
            click: () => startTimer(p.id),
        }));

        if (projectItems.length > 0) {
            // Project is required (matches the popup) — pick one from the submenu.
            // The old "No Project" item started an unassigned tracked entry.
            template.push({
                label: "Start Timer",
                submenu: projectItems,
            });
        } else {
            // No projects cached yet (still loading, or none assigned). Don't start
            // an unassigned timer from the tray — open the app so the user can pick
            // a project (and trigger a refresh), matching the popup's requirement.
            template.push({
                label: "Start Timer…",
                click: () => {
                    refreshProjectsIfStale();
                    showPopup();
                },
            });
        }
    }

    template.push({ type: "separator" });

    // ── Navigation ─────────────────────────────────────────────────────────
    template.push(
        { label: "Open App Window", click: () => showPopup() },
        { label: "Open Dashboard", click: () => openDashboardInBrowser() },
        {
            label: "Always on Top",
            type: "checkbox",
            checked: isAlwaysOnTop,
            click: (menuItem) => {
                isAlwaysOnTop = menuItem.checked;
                if (popupWindow && !popupWindow.isDestroyed()) {
                    _applyAlwaysOnTop(popupWindow, isAlwaysOnTop);
                    popupWindow.webContents.send("pin-state-changed", {
                        pinned: isAlwaysOnTop,
                    });
                }
                saveAlwaysOnTop(isAlwaysOnTop);
                console.log(`[Pin] Always on top (tray): ${isAlwaysOnTop}`);
            },
        },
    );

    template.push({ type: "separator" });

    // ── Account & app ──────────────────────────────────────────────────────
    template.push(
        {
            label: "Sign Out",
            click: () => performLogout(),
        },
        { type: "separator" },
        {
            label: "Quit TrackFlow",
            click: () => app.quit(),
        },
    );

    return Menu.buildFromTemplate(template);
}

/**
 * Apply always-on-top state to a BrowserWindow.
 * On macOS, uses 'floating' level (NSFloatingWindowLevel) so the window
 * stays above normal app windows. A 300ms keepalive re-asserts z-order on
 * macOS Sequoia where Electron can lose floating level after focus changes.
 *
 * On Windows/Linux, set always-on-top ONCE only. The keepalive called
 * moveTop() every 300ms on all platforms and dismissed the native <select>
 * dropdown (~1s after open while pinned — default on fresh install).
 */
// Interval reference for the pin keepalive (macOS-only workaround)
let _pinKeepalive = null;

function _applyAlwaysOnTop(win, pinned) {
    if (!win || win.isDestroyed()) return;

    // Clear any existing keepalive
    if (_pinKeepalive) {
        clearInterval(_pinKeepalive);
        _pinKeepalive = null;
    }

    if (pinned) {
        if (process.platform === "darwin") {
            // 'floating' = NSFloatingWindowLevel — sits above all normal app windows.
            win.setAlwaysOnTop(true, "floating", 1);
            win.moveTop();
            console.log(
                `[Pin] setAlwaysOnTop(true,'floating',1) + moveTop(). isAlwaysOnTop()=${win.isAlwaysOnTop()}`,
            );

            // macOS Sequoia + Electron 28 regression: the window visually slips
            // behind other apps after focus changes even though isAlwaysOnTop()
            // returns true. Re-assert the level and call moveTop() every 300ms.
            // Windows: NEVER poll moveTop() — it steals z-order from the native
            // <select> listbox HWND and closes the project dropdown mid-pick.
            _pinKeepalive = setInterval(() => {
                if (!win || win.isDestroyed() || !isAlwaysOnTop) {
                    clearInterval(_pinKeepalive);
                    _pinKeepalive = null;
                    return;
                }
                // Do NOT re-assert on a hidden window — moveTop() would re-show it.
                if (!win.isVisible()) return;
                win.setAlwaysOnTop(true, "floating", 1);
                win.moveTop();
            }, 300);
        } else if (process.platform === "win32") {
            // One-shot only; no moveTop() polling (closes native dropdown popups).
            win.setAlwaysOnTop(true);
            console.log(
                `[Pin] setAlwaysOnTop(true). isAlwaysOnTop()=${win.isAlwaysOnTop()}`,
            );
        } else {
            win.setAlwaysOnTop(true);
            console.log(
                `[Pin] setAlwaysOnTop(true). isAlwaysOnTop()=${win.isAlwaysOnTop()}`,
            );
        }
    } else {
        win.setAlwaysOnTop(false);
        console.log(
            `[Pin] setAlwaysOnTop(false) called. isAlwaysOnTop()=${win.isAlwaysOnTop()}`,
        );
    }
}

/**
 * Calculate the popup window x,y position anchored to the PRIMARY display.
 * Uses tray bounds only to determine whether the taskbar is at the top or
 * bottom, so the popup opens near the correct edge of the primary display.
 */
function _calcPopupPosition(trayBounds, windowWidth, windowHeight) {
    try {
        const primary = screen.getPrimaryDisplay();
        const workArea = primary.workArea;

        // Detect top vs bottom taskbar.
        // macOS: the menu bar (and tray) is ALWAYS at the top — anchor top-right
        // unconditionally. Relying on tray.getBounds() here is fragile: on first run
        // the bounds can be {0,0,0,0} before the icon has rendered, and on multi-
        // monitor setups getDisplayNearestPoint({0,0}) can resolve the wrong display,
        // which flipped the test and opened the popup at the BOTTOM-right.
        // Windows/Linux: the taskbar can be top or bottom, so detect from tray bounds
        // when available; if bounds aren't ready, default to bottom (typical taskbar).
        let trayIsAtTop;
        if (process.platform === "darwin") {
            trayIsAtTop = true;
        } else if (trayBounds.height > 0) {
            const trayCenter = trayBounds.y + trayBounds.height / 2;
            const trayDisplay = screen.getDisplayNearestPoint({
                x: trayBounds.x,
                y: trayBounds.y,
            });
            const screenCenter =
                trayDisplay.workArea.y + trayDisplay.workArea.height / 2;
            trayIsAtTop = trayCenter < screenCenter;
        } else {
            trayIsAtTop = false;
        }

        // Right-align on primary display (mirrors macOS Menu Bar convention)
        const x = workArea.x + workArea.width - windowWidth - 8;
        let y;

        if (trayIsAtTop) {
            y = workArea.y + 4;
        } else {
            y = workArea.y + workArea.height - windowHeight - 4;
        }

        return { x, y };
    } catch {
        // Last-resort fallback: top-right corner of screen
        return { x: 8, y: 8 };
    }
}

/**
 * Move an existing popup window back onto the primary display.
 * Called when showing an already-created window that may have been
 * left on an extended display from a previous session.
 */
function _repositionToPrimaryDisplay(win, windowWidth, windowHeight) {
    try {
        if (!win || win.isDestroyed()) return;
        const trayBounds = tray
            ? tray.getBounds()
            : { x: 0, y: 0, width: 0, height: 0 };
        const { x, y } = _calcPopupPosition(
            trayBounds,
            windowWidth,
            windowHeight,
        );
        // SHRINK FIX: re-assert BOTH position AND size on every show. On Windows
        // fractional-DPI displays (125%/150%), Electron 42 rounds a frameless,
        // non-resizable window's bounds down by the scale factor each time it is
        // re-shown, so repeated taskbar/tray clicks shrank the popup a little more
        // every click. Pinning the full bounds to the intended size here resets it
        // to windowWidth x windowHeight each time instead of letting it drift.
        win.setBounds(
            { x, y, width: windowWidth, height: windowHeight },
            false,
        );
    } catch {}
}

function showPopup() {
    if (!isAuthenticated) {
        createLoginWindow();
        return;
    }

    if (popupWindow && !popupWindow.isDestroyed()) {
        // Reposition to primary display before showing (handles cases where a
        // previous show placed it on an extended monitor)
        _repositionToPrimaryDisplay(popupWindow, POPUP_WIDTH, POPUP_HEIGHT);
        if (typeof popupWindow.moveTop === "function") {
            // Windows: moveTop() while a native <select> is open dismisses the
            // dropdown; only re-assert z-order on macOS where the tray popup
            // can slip behind other windows without it.
            if (process.platform === "darwin") {
                popupWindow.moveTop();
            }
        }
        if (process.platform === "linux") {
            popupWindow.setVisibleOnAllWorkspaces(true, {
                visibleOnFullScreen: true,
            });
        }
        popupWindow.show();
        popupWindow.focus();
        setImmediate(() => {
            if (popupWindow && !popupWindow.isDestroyed()) {
                popupWindow.webContents.send("sync-timer");
                popupWindow.webContents.send("projects-ready");
                // Force a throttled refresh on open so a newly assigned project shows
                // up; re-signal projects-ready when the fresh list lands so the
                // renderer re-fetches it (cached list already rendered immediately).
                refreshProjectsOnOpen(() => {
                    if (popupWindow && !popupWindow.isDestroyed()) {
                        popupWindow.webContents.send("projects-ready");
                    }
                });
                // Push fresh activity data every time the window becomes visible
                popupWindow.webContents.send("activity-update", {
                    activityScore: activityMonitor
                        ? activityMonitor.getCurrentScore()
                        : 0,
                    lastScreenshotAt: _lastScreenshotAt,
                    isOnline: networkMonitor?.isOnline ?? true,
                });
            }
        });
        return;
    }

    const trayBounds = tray.getBounds();
    // Use the shared POPUP_WIDTH/POPUP_HEIGHT so the initial size matches the
    // re-show reposition exactly (no launch-large / reshow-small jump). The earlier
    // bump to 380x520 was a workaround for a Windows dropdown clip that has since
    // been fixed separately (dropdown rebuild + pin-keepalive fixes).
    const windowWidth = POPUP_WIDTH;
    const windowHeight = POPUP_HEIGHT;

    // MULTI-MONITOR FIX: Always position on the PRIMARY display regardless of
    // which monitor the tray icon is on. Extended/secondary displays are excluded.
    // We still use the tray position to detect top-vs-bottom taskbar placement.
    const { x, y } = _calcPopupPosition(trayBounds, windowWidth, windowHeight);

    popupWindow = new BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        x,
        y,
        frame: false,
        resizable: false,
        skipTaskbar: true,
        show: false,
        backgroundColor: "#0a0a0a", // Prevent white flash on all platforms
        webPreferences: {
            preload: path.join(__dirname, "..", "preload", "index.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            devTools: true,
        },
    });

    // Apply always-on-top AFTER window creation (not in constructor options).
    // On macOS, use 'floating' level + relativeLevel 1 for reliable z-order.
    _applyAlwaysOnTop(popupWindow, isAlwaysOnTop);

    popupWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

    popupWindow.once("ready-to-show", () => {
        popupWindow.show();
        if (process.env.NODE_ENV === "development") {
            popupWindow.webContents.openDevTools({ mode: "detach" });
        }
    });

    // After the renderer finishes loading, ensure projects are loaded and
    // send projects-ready + sync-timer signals. This fixes the race where
    // the renderer's own loadProjects() fires before the API client has a
    // valid token (e.g. after logout/re-login or password reset).
    popupWindow.webContents.once("did-finish-load", () => {
        loadProjects().then(() => {
            if (popupWindow && !popupWindow.isDestroyed()) {
                popupWindow.webContents.send("projects-ready");
                popupWindow.webContents.send("sync-timer");
            }
        });
    });

    // Hide on blur — debounced on all platforms to prevent show-then-immediately-hide
    // race when the tray icon click steals focus before the popup can render.
    let blurTimeout = null;
    popupWindow.on("blur", () => {
        if (blurTimeout) {
            clearTimeout(blurTimeout);
            blurTimeout = null;
        }
        // PIN FIX: when the window is pinned (always-on-top), the user explicitly
        // wants it to stay visible while they work in other apps. Auto-hiding on
        // blur here is what made "Pin" look broken — you'd click pin, click into
        // another window, and the popup would vanish anyway. While pinned, never
        // hide on blur; the user dismisses it via the tray click or close button.
        if (isAlwaysOnTop) return;
        if (Date.now() - _lastTrayClickAt < 300) return;
        blurTimeout = setTimeout(() => {
            if (
                popupWindow &&
                !popupWindow.isDestroyed() &&
                !popupWindow.isFocused()
            ) {
                popupWindow.hide();
            }
        }, 150);
    });
    popupWindow.on("focus", () => {
        if (blurTimeout) {
            clearTimeout(blurTimeout);
            blurTimeout = null;
        }
    });

    popupWindow.on("closed", () => {
        popupWindow = null;
    });
}

// ── IPC Input Validation Helpers ─────────────────────────────────────────────

function validateProjectId(id) {
    if (id === null || id === undefined || id === "") return null;
    // Keep as string — backend expects UUID strings, not integers.
    // Accept any non-empty string that looks like an ID (alphanumeric, hyphens, underscores).
    if (typeof id === "string") {
        const trimmed = id.trim();
        if (trimmed && /^[a-zA-Z0-9_-]+$/.test(trimmed)) return trimmed;
        return null;
    }
    // If renderer somehow sends a number, convert to string for the API
    if (typeof id === "number" && id > 0) return String(id);
    return null;
}

function validateIdleAction(action) {
    const valid = ["keep", "discard", "stop", "reassign"];
    return valid.includes(action) ? action : null;
}

async function performLogout() {
    posthog.capture(currentEntry?.user_id || "unknown", "user_logged_out", {});

    // Stop timer locally + on server; close any open SQLite session
    if (isTimerRunning) {
        try {
            await stopTimer();
        } catch {
            const localActive = getActiveLocalTimer();
            if (localActive && !localActive.ended_at) {
                const endedAt = new Date().toISOString();
                const dur = localActive.started_at
                    ? Math.max(
                          0,
                          Math.floor(
                              (Date.now() -
                                  new Date(localActive.started_at).getTime()) /
                                  1000,
                          ),
                      )
                    : 0;
                saveLocalTimerStop(localActive.id, endedAt, dur);
            }
        }
    } else if (apiClient) {
        try {
            await apiClient.stopTimer();
        } catch {}
    }
    // Wipe local timer_sessions so the NEXT account can't inherit this one's rows
    // (the table has no user_id; a stale open row would restore as a phantom
    // "Tracking HH:MM:SS" timer on the next login). The current timer was just
    // stopped above; the offline queue is closed below — both consistent with this.
    clearLocalTimerSessions();
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
    clearProjectsCache();
    todayTotalGlobal = 0;
    todayTotalCurrentProject = 0;
    config = {};
    currentShift = null;

    if (popupWindow && !popupWindow.isDestroyed()) {
        popupWindow.destroy();
    }
    popupWindow = null;

    // Update tray icon to idle state
    updateTrayIcon(false);
    setTrayText("");

    createLoginWindow();
}

// ── OS Theme Detection ─────────────────────────────────────────────────────
// Returns 'dark' or 'light' based on the OS preference.
function getOSTheme() {
    return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

// Broadcast theme change to all open renderer windows.
function broadcastThemeChange() {
    const theme = getOSTheme();
    const windows = [popupWindow, loginWindow, idleAlertWindow];
    for (const win of windows) {
        if (win && !win.isDestroyed()) {
            win.webContents.send("theme-changed", theme);
        }
    }
}

// Listen for OS theme changes — fires when the user toggles dark/light mode
nativeTheme.on("updated", () => {
    broadcastThemeChange();
});

function setupIPC() {
    // Remove previous handlers to avoid duplicate registration
    ipcMain.removeHandler("get-timer-state");
    ipcMain.removeHandler("start-timer");
    ipcMain.removeHandler("stop-timer");
    ipcMain.removeHandler("get-projects");
    ipcMain.removeHandler("get-last-project");
    ipcMain.removeHandler("set-last-project");
    ipcMain.removeHandler("logout");
    ipcMain.removeHandler("open-dashboard");
    ipcMain.removeHandler("check-screen-permission");
    ipcMain.removeHandler("request-screen-permission");
    ipcMain.removeHandler("open-screen-recording-settings");
    ipcMain.removeHandler("hide-window");
    ipcMain.removeHandler("toggle-pin");
    ipcMain.removeHandler("get-pin-state");
    ipcMain.removeHandler("install-update");

    ipcMain.handle("hide-window", () => {
        if (popupWindow && !popupWindow.isDestroyed()) {
            popupWindow.hide();
        }
    });

    ipcMain.handle("toggle-pin", (_, forceState) => {
        // If forceState is provided (boolean), use it; otherwise toggle
        isAlwaysOnTop =
            typeof forceState === "boolean" ? forceState : !isAlwaysOnTop;
        if (popupWindow && !popupWindow.isDestroyed()) {
            _applyAlwaysOnTop(popupWindow, isAlwaysOnTop);
            popupWindow.webContents.send("pin-state-changed", {
                pinned: isAlwaysOnTop,
            });
        }
        saveAlwaysOnTop(isAlwaysOnTop);
        console.log(`[Pin] Always on top: ${isAlwaysOnTop}`);
        return { pinned: isAlwaysOnTop };
    });

    ipcMain.handle("get-pin-state", () => {
        return { pinned: isAlwaysOnTop };
    });

    ipcMain.handle("check-screen-permission", async () => {
        if (process.platform !== "darwin")
            return { granted: true, platform: process.platform };
        const granted = checkScreenRecordingPermission();
        if (!granted) {
            // Only probe when NOT granted — to register app in the list.
            // Probing when granted triggers the native macOS popup unnecessarily.
            const probeGranted = await probeScreenRecordingPermission();
            return { granted: probeGranted, platform: "darwin" };
        }
        return { granted: true, platform: "darwin" };
    });

    ipcMain.handle("request-screen-permission", async () => {
        if (process.platform !== "darwin") return { granted: true };
        // Only probe if not already granted — avoids native popup
        if (_screenPermissionGranted !== true) {
            await probeScreenRecordingPermission();
        }
        const result = await showScreenPermissionOnboarding({
            isPreStart: true,
            wasTracking: isTimerRunning,
        });
        return { result, granted: _screenPermissionGranted === true };
    });

    // Opens Screen Recording settings directly — used by the wallpaper warning banner
    ipcMain.handle("open-screen-recording-settings", async () => {
        if (process.platform !== "darwin") return { opened: false };
        console.log(
            "[Permission] User clicked Fix — opening Screen Recording settings",
        );
        shell.openExternal(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        );
        return { opened: true };
    });

    // CONNECTIVITY FIX: Network status IPC handler
    ipcMain.removeHandler("get-network-status");
    ipcMain.handle("get-network-status", () => ({
        online: networkMonitor?.isOnline ?? true,
    }));

    // Activity & screenshot info — renderer fetches on mount and on window show
    ipcMain.removeHandler("get-activity-info");
    ipcMain.handle("get-activity-info", () => ({
        activityScore: activityMonitor ? activityMonitor.getCurrentScore() : 0,
        lastScreenshotAt: _lastScreenshotAt,
        isOnline: networkMonitor?.isOnline ?? true,
    }));

    ipcMain.handle("install-update", async () => {
        console.log("[updater] User clicked Restart Now — installing update");

        // FIX: Set isQuitting=true BEFORE calling quitAndInstall so the before-quit
        // handler does not call e.preventDefault() and block the update install.
        // Without this, an active timer causes before-quit to preventDefault(), then
        // app.exit(0) is called instead — bypassing Squirrel's install hook entirely.
        isQuitting = true;

        // Best-effort: stop the timer quickly before quitting (max 3s)
        if (isTimerRunning) {
            const localId = currentEntry?._localId;
            const updateEndedAt = new Date().toISOString();
            const updateDuration = _cachedStartedAtMs
                ? Math.max(
                      0,
                      Math.floor((Date.now() - _cachedStartedAtMs) / 1000),
                  )
                : 0;
            if (localId) {
                saveLocalTimerStop(localId, updateEndedAt, updateDuration);
            }
            try {
                // BUG 3 FIX: target the specific server entry so we never close a newer one.
                const stopPayload = currentEntry?._localId
                    ? {
                          started_at: currentEntry?.started_at,
                          ended_at: updateEndedAt,
                      }
                    : {};
                if (
                    currentEntry?.id &&
                    !String(currentEntry.id).startsWith("local-")
                )
                    stopPayload.time_entry_id = currentEntry.id;
                if (currentEntry?.idempotency_key)
                    stopPayload.idempotency_key = currentEntry.idempotency_key;
                await Promise.race([
                    apiClient?.stopTimer(stopPayload) ?? Promise.resolve(),
                    new Promise((resolve) => setTimeout(resolve, 3000)),
                ]);
                if (localId) markLocalTimerStopSynced(localId);
            } catch {}
        }

        try {
            const { autoUpdater } = require("electron-updater");
            autoUpdater.quitAndInstall(false, true);

            // FIX: On macOS without a code-signing cert, quitAndInstall() can fail
            // silently — the app stays open and the renderer shows "Restarting…"
            // forever. After 6 seconds, if we're still alive, open the releases page
            // so the user can download and install manually.
            setTimeout(() => {
                console.warn(
                    "[updater] quitAndInstall did not quit within 6s — opening releases page",
                );
                const { shell } = require("electron");
                shell.openExternal(
                    "https://github.com/codeupscale/trackflow/releases/latest",
                );
                // Notify the renderer so it can reset the button
                try {
                    if (popupWindow && !popupWindow.isDestroyed()) {
                        popupWindow.webContents.send("update-install-failed");
                    }
                } catch {}
            }, 6000);
        } catch (e) {
            console.error("[updater] quitAndInstall threw:", e.message);
            const { shell } = require("electron");
            shell.openExternal(
                "https://github.com/codeupscale/trackflow/releases/latest",
            );
            try {
                if (popupWindow && !popupWindow.isDestroyed()) {
                    popupWindow.webContents.send("update-install-failed");
                }
            } catch {}
        }
    });

    ipcMain.removeHandler("get-shift-info");
    ipcMain.handle("get-shift-info", async () => {
        return { shift: currentShift };
    });

    ipcMain.handle("get-timer-state", async (_, projectId) => {
        const validProjectId = validateProjectId(projectId);
        // Local fallback FIRST so an offline/failed server call never wipes the
        // displayed total to 0 (the "saved time not showing after sleep auto-stop"
        // bug). On a successful fetch below this is overwritten with server values.
        const localSessionElapsed =
            isTimerRunning && _cachedStartedAtMs
                ? Math.max(
                      0,
                      Math.floor((Date.now() - _cachedStartedAtMs) / 1000) -
                          _pendingOfflineReassignIdleSec,
                  )
                : 0;
        let todayTotalForDisplay = isTimerRunning
            ? todayTotalCurrentProject + localSessionElapsed
            : todayTotalGlobal;
        if (apiClient) {
            try {
                const status = await apiClient.getTimerStatus(validProjectId);
                const globalTotal = status.today_total ?? 0;

                if (isServerTimerOpen(status)) {
                    applyRunningStatusFromServer(status);
                } else if (shouldPreserveLocalRunningWhenServerStopped()) {
                    const localActive = getActiveLocalTimer();
                    if (
                        !isTimerRunning &&
                        localActive &&
                        !localActive.ended_at
                    ) {
                        console.log(
                            "[get-timer-state] Restoring orphaned local session after phantom stop",
                        );
                        restoreInMemoryFromLocalActive(localActive);
                        todayTotalGlobal = globalTotal;
                        const sessionElapsed = _cachedStartedAtMs
                            ? Math.floor(
                                  (Date.now() - _cachedStartedAtMs) / 1000,
                              )
                            : 0;
                        todayTotalCurrentProject = Math.max(
                            0,
                            globalTotal - sessionElapsed,
                        );
                        scheduleReconcileAndFlush();
                    } else {
                        todayTotalGlobal = globalTotal;
                    }
                } else {
                    todayTotalGlobal = globalTotal;
                    todayTotalCurrentProject = 0;
                    isTimerRunning = false;
                    isTimerPaused = false;
                    currentEntry = null;
                    _cachedStartedAtMs = null;
                }

                if (isTimerRunning && currentEntry?.project_id) {
                    if (status.running || isServerTimerPaused(status)) {
                        todayTotalForDisplay =
                            status.project_today_total ?? globalTotal;
                    } else {
                        const sessionElapsed = _cachedStartedAtMs
                            ? Math.floor(
                                  (Date.now() - _cachedStartedAtMs) / 1000,
                              )
                            : 0;
                        todayTotalForDisplay =
                            todayTotalCurrentProject + sessionElapsed;
                    }
                } else {
                    todayTotalForDisplay = globalTotal;
                }
            } catch {}
        }
        // While idle-paused, freeze elapsed at the idle-start (active time), matching
        // the tray + the timer-paused event — otherwise reopening the window mid-idle
        // shows the threshold-inclusive climbing value again.
        let elapsedForState = 0;
        if (currentEntry && _cachedStartedAtMs) {
            const idleStartIso = isTimerPaused
                ? idleDetector?.idleStartedAt
                : null;
            const anchorMs = idleStartIso
                ? new Date(idleStartIso).getTime()
                : Date.now();
            elapsedForState = Math.max(
                0,
                Math.floor((anchorMs - _cachedStartedAtMs) / 1000),
            );
        }
        return {
            isRunning: isTimerRunning,
            isPaused: isTimerPaused,
            entry: currentEntry,
            elapsed: elapsedForState,
            todayTotal: todayTotalForDisplay,
            // Non-ticking all-projects sum for the secondary field.
            todayTotalGlobal,
        };
    });

    ipcMain.handle("start-timer", async (_, projectId) => {
        const validProjectId = validateProjectId(projectId);
        return await startTimer(validProjectId);
    });

    ipcMain.handle("stop-timer", () => {
        return stopTimer();
    });

    ipcMain.handle("get-projects", async () => {
        return loadProjects();
    });

    ipcMain.handle("get-last-project", () => {
        return loadLastProjectId();
    });

    ipcMain.handle("set-last-project", (_, projectId) => {
        saveLastProjectId(projectId);
    });

    ipcMain.handle("logout", async () => {
        return await performLogout();
    });

    ipcMain.handle("open-dashboard", async () => {
        await openDashboardInBrowser();
    });

    // Idle alert actions
    ipcMain.removeHandler("resolve-idle");
    ipcMain.handle(
        "resolve-idle",
        async (_, action, projectId = null, actionId = null) => {
            const validAction = validateIdleAction(action);
            if (!validAction) return { error: "Invalid action" };
            const validProjectId = validateProjectId(projectId);
            await handleIdleAction(validAction, actionId, null, validProjectId);
            dismissIdleAlert();
            return { success: true };
        },
    );
}

// Run after timer has started — tray, sync, screenshot. Keeps startTimer() return fast.
function afterStartTimer(projectIdForTotal, todayTotalForPopup) {
    if (!apiClient || !currentEntry) {
        console.error(
            "[afterStartTimer] ABORTED: apiClient or currentEntry is null",
            { apiClient: !!apiClient, currentEntry: !!currentEntry },
        );
        return;
    }
    console.log(
        `[afterStartTimer] Running for entry=${currentEntry.id}, project=${projectIdForTotal}`,
    );
    (async () => {
        todayTotalGlobal = todayTotalForPopup;
        loadProjects().catch(() => {});
        try {
            activityMonitor.start();
            console.log("[afterStartTimer] activityMonitor started");
        } catch (e) {
            console.error(
                "[afterStartTimer] activityMonitor.start() CRASHED:",
                e.message,
            );
        }
        try {
            console.log(
                `[afterStartTimer] Calling screenshotService.start(${currentEntry.id})`,
            );
            // NOTE: the screenshot-captured callback (which updates _lastScreenshotAt
            // and pushes a live `activity-update`) is registered once at service
            // creation in initializeApp(), so it applies to every start() path —
            // not just this one. Do not re-register it here.
            screenshotService.start(currentEntry.id);
            console.log("[afterStartTimer] screenshotService started");
        } catch (e) {
            console.error(
                "[afterStartTimer] screenshotService.start() CRASHED:",
                e.message,
                e.stack,
            );
        }
        try {
            idleDetector?.start();
        } catch (e) {
            console.error(
                "[afterStartTimer] idleDetector.start() CRASHED:",
                e.message,
            );
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
    if (!isTimerRunning || !apiClient) return { error: "No timer running" };

    try {
        // Send final heartbeat for the old entry before switching
        if (activityMonitor) {
            await activityMonitor.sendFinalHeartbeat().catch(() => {});
        }

        const result = await apiClient.switchProject(projectId);
        const newEntry = result.entry;

        // Update local state to the new entry
        currentEntry = newEntry;
        _cachedStartedAtMs = newEntry?.started_at
            ? new Date(newEntry.started_at).getTime()
            : null;
        todayTotalCurrentProject = result.today_total ?? 0;

        posthog.capture(newEntry?.user_id || "unknown", "timer_switched", {
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

        notifyPopup("timer-started", {
            ...newEntry,
            todayTotal: todayTotalCurrentProject,
        });
        updateTrayTitle();

        return {
            success: true,
            entry: newEntry,
            todayTotal: todayTotalCurrentProject,
        };
    } catch (e) {
        console.error("[switchProject] Failed:", e.message);
        return { error: e.response?.data?.message || e.message };
    }
}

let _startTimerInProgress = false; // Mutex to prevent concurrent startTimer calls
async function startTimer(projectId = null) {
    // If timer is already running on a different project, use atomic switch
    if (isTimerRunning && projectId && currentEntry?.project_id !== projectId) {
        return await switchProject(projectId);
    }
    if (isTimerRunning) {
        // Self-heal (phantom-stop-local-first-desync): the renderer offered "Start" while we
        // are already running, so its UI is out of sync (e.g. a transient phantom-stop). Re-
        // broadcast the running state so the popup corrects itself instead of just erroring.
        notifyPopup("timer-started", {
            ...currentEntry,
            todayTotal: todayTotalCurrentProject,
        });
        return { error: "Timer already running" };
    }

    // RACE-FIX: Prevent concurrent start calls from creating duplicate entries
    if (_startTimerInProgress)
        return { error: "Timer start already in progress" };
    _startTimerInProgress = true;

    // FIX D7: Capture state version at start to detect concurrent state changes
    const startVersion = _timerStateVersion;

    try {
        // ── Pre-start permission gate (macOS only) ──────────────────────────────
        // Check screen recording permission BEFORE starting the timer so the user
        // is not surprised by a permission prompt mid-tracking.
        if (
            process.platform === "darwin" &&
            _screenPermissionGranted !== true
        ) {
            checkScreenRecordingPermission();
            if (!_screenPermissionGranted) {
                // Probe desktopCapturer so TrackFlow registers in the Screen Recording
                // list before we direct the user to System Settings.
                const probeGranted = await probeScreenRecordingPermission();
                if (probeGranted) {
                    console.log(
                        "[Timer] Probe confirmed permission — proceeding with timer start",
                    );
                } else {
                    console.log(
                        "[Timer] Screen recording permission not granted — showing onboarding",
                    );
                    const permResult = await showScreenPermissionOnboarding({
                        isPreStart: true,
                        wasTracking: false,
                    });
                    if (permResult === "opened-settings") {
                        // User went to settings — don't start timer yet. They need to restart.
                        return {
                            error: "Please grant Screen Recording permission and restart the app. Your project selection will be remembered.",
                        };
                    }
                    // User clicked "Skip for Now" — let them track without screenshots
                    console.log(
                        "[Timer] User skipped permission — starting timer without screenshot capability",
                    );
                    // Notify renderer that permission is not granted so it can show a warning
                    notifyPopup("permission-status", { granted: false });
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
        touchLastActiveAt(localStartedAt);
        console.log(
            `[Timer] Local start recorded: ${localId}, key=${idempotencyKey}`,
        );

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
        isTimerPaused = false;
        todayTotalCurrentProject = 0;
        _pendingOfflineReassignIdleSec = 0;

        // Try to sync with server (non-blocking for the user)
        try {
            // BUG 1 FIX: send the REAL local started_at so the server records the true
            // start (not now()). Critical for offline starts that sync minutes/hours later.
            const result = await apiClient.startTimer(
                projectId,
                idempotencyKey,
                localStartedAt,
            );
            // Server confirmed — update local state with server entry, but keep the
            // local started_at as the display anchor (BUG 2: never jump the start forward).
            currentEntry = {
                ...result.entry,
                _localId: localId,
                idempotency_key: idempotencyKey,
            };
            adoptServerStartedAt(currentEntry?.started_at);
            todayTotalCurrentProject = result.today_total ?? 0;
            markLocalTimerStartSynced(localId, result.entry.id);
            posthog.capture(
                currentEntry?.user_id || "unknown",
                "timer_started",
                { project_id: projectId },
            );
            // FIX D7: Increment state version on successful start
            _timerStateVersion++;

            const todayTotalForPopup = todayTotalCurrentProject;
            notifyPopup("timer-started", {
                ...currentEntry,
                todayTotal: todayTotalForPopup,
            });
            setImmediate(() => afterStartTimer(projectId, todayTotalForPopup));
            return {
                success: true,
                entry: currentEntry,
                todayTotal: todayTotalForPopup,
            };
        } catch (e) {
            const status = e.response?.status;

            // 409 = timer already running on server — sync local state
            if (status === 409) {
                try {
                    await apiClient.stopTimer();
                } catch {}

                try {
                    // BUG 1 FIX: preserve the real local start on the retry too
                    const retryResult = await apiClient.startTimer(
                        projectId,
                        idempotencyKey,
                        localStartedAt,
                    );
                    currentEntry = {
                        ...retryResult.entry,
                        _localId: localId,
                        idempotency_key: idempotencyKey,
                    };
                    adoptServerStartedAt(currentEntry?.started_at);
                    isTimerRunning = true;
                    isTimerPaused = false;
                    todayTotalCurrentProject = retryResult.today_total ?? 0;
                    markLocalTimerStartSynced(localId, retryResult.entry.id);
                    notifyPopup("timer-started", {
                        ...currentEntry,
                        todayTotal: todayTotalCurrentProject,
                    });
                    setImmediate(() =>
                        afterStartTimer(projectId, todayTotalCurrentProject),
                    );
                    return {
                        success: true,
                        entry: currentEntry,
                        todayTotal: todayTotalCurrentProject,
                    };
                } catch (retryErr) {
                    // Still offline or server error — timer is running locally
                    console.warn(
                        "[Timer] 409 retry failed, continuing locally:",
                        retryErr.message,
                    );
                }
            }

            // Network failure or any other error — timer is already running locally
            console.log(
                "[Timer] API start failed, continuing in local-first mode:",
                e.message,
            );
            // Timer start is already saved in timer_sessions SQLite table via saveLocalTimerStart().
            // reconcileTimerState() will sync it on reconnect. Do NOT also queue in offlineQueue
            // to avoid dual-replay causing duplicate time entries.
            if (_timerStateVersion === startVersion) {
                notifyPopup("timer-started", {
                    ...localEntry,
                    todayTotal: 0,
                    offline: true,
                    _stateVersion: startVersion,
                });
            }
            setImmediate(() => afterStartTimer(projectId, 0));
            return {
                success: true,
                entry: localEntry,
                todayTotal: 0,
                offline: true,
            };
        }
    } finally {
        _startTimerInProgress = false;
    }
}

async function autoStopTimerForPowerEvent(reason, endedAtMs) {
    if (!isTimerRunning) return;
    logToFile(
        "info",
        `[TIMER_SLEEP_STOP] reason=${reason} endedAt=${new Date(endedAtMs).toISOString()}`,
    );
    saveAutoStopReason(reason);
    const result = await stopTimer({ endedAtMs, autoStopReason: reason });
    // Only notify if THIS call actually performed the stop. A lid-close fires
    // 'lock-screen' + 'suspend' back-to-back; the stopTimer mutex blocks the second
    // one and returns { error }, so without this check the user gets two toasts for
    // a single stop. (PowerManager also coalesces the paired events; this is the
    // data-layer backstop.)
    if (result && result.error) return;
    const label = PowerManager.formatTimeShortLocal(new Date(endedAtMs));
    const reasonVerb =
        reason === "lock-screen" ? "was locked" : "went to sleep";
    PowerManager.showAutoStopNotification(
        "TrackFlow — Timer auto-stopped",
        `Timer stopped at ${label} because your computer ${reasonVerb}. All time tracked before then was saved.`,
    );
}

/**
 * Close stale open sessions when the app was offline/crashed longer than the gap threshold.
 * Runs before reconcileTimerState on startup.
 */
async function detectAndCloseStaleSessionOnStartup() {
    const lastActiveIso = loadLastActiveAt();
    const lastActiveMs = lastActiveIso
        ? new Date(lastActiveIso).getTime()
        : null;
    const localActive = getActiveLocalTimer();
    const hasOpenSession =
        !!(localActive && !localActive.ended_at) || isTimerRunning;

    const { shouldClose, stopAtMs, gapSec } = PowerManager.evaluateStartupGap({
        lastActiveAtMs: lastActiveMs,
        nowMs: Date.now(),
        gapThresholdSec: getStartupGapThresholdSec(),
        hasOpenSession,
    });

    if (!shouldClose || stopAtMs == null) return;

    console.log(
        `[Startup] Stale session detected — gap ${gapSec}s, closing at ${new Date(stopAtMs).toISOString()}`,
    );
    logToFile(
        "info",
        `[TIMER_GAP_STOP] gapSec=${gapSec} stopAt=${new Date(stopAtMs).toISOString()}`,
    );

    if (isTimerRunning || (localActive && !localActive.ended_at)) {
        if (!isTimerRunning && localActive) {
            restoreInMemoryFromLocalActive(localActive);
        }
        await stopTimer({ endedAtMs: stopAtMs, autoStopReason: "startup-gap" });
    }

    const label = PowerManager.formatTimeShortLocal(new Date(stopAtMs));
    PowerManager.showAutoStopNotification(
        "TrackFlow — Timer auto-stopped",
        `Timer was auto-stopped — the app was offline since ${label}.`,
    );
}

async function stopTimer(options = {}) {
    // BUG 3 FIX: Mutex symmetric to _startTimerInProgress. Concurrent stops
    // (user click, auto-stop, idle stop, sync-loop stop) must not interleave and
    // double-close / cross-close entries. First caller wins; the rest no-op.
    if (_stopTimerInProgress)
        return { error: "Timer stop already in progress" };
    if (!isTimerRunning && !currentEntry)
        return { success: true, entry: null, todayTotal: todayTotalGlobal };
    _stopTimerInProgress = true;
    try {
        const endedAtMs = options.endedAtMs ?? Date.now();
        const sessionElapsed =
            currentEntry && _cachedStartedAtMs
                ? Math.max(
                      0,
                      Math.floor((endedAtMs - _cachedStartedAtMs) / 1000),
                  )
                : 0;
        const stoppedProjectId = currentEntry?.project_id || null;
        const stoppedEntryId = currentEntry?.id || null;
        const isZeroDurationEntry = sessionElapsed < MIN_ENTRY_DURATION_SEC;
        // DISPLAY-ONLY: if an offline reassign is pending, the session elapsed (anchored
        // at the original start) still includes the idle being moved to another project.
        // Subtract it from the DISPLAYED stopped total so it matches what the running
        // timer showed (no jump-up on stop). The SQLite stop below keeps the FULL
        // sessionElapsed — the server split on reconnect re-attributes it, and
        // getTodayTotal() then drives the authoritative total. Captured before the
        // state-reset clears _pendingOfflineReassignIdleSec.
        const pendingIdleAtStop = _pendingOfflineReassignIdleSec;
        const localStoppedProjectTotal =
            todayTotalCurrentProject +
            Math.max(0, sessionElapsed - pendingIdleAtStop);
        posthog.capture(
            currentEntry?.user_id || "unknown",
            "timer_stopped",
            {},
        );

        dismissIdleAlert();

        // Send final heartbeat BEFORE stopping — captures last 0-29s of activity data
        // This is critical: without it, 10-50% of activity in short sessions is lost
        // Skip heartbeat for zero-duration entries — there is no meaningful activity data.
        if (activityMonitor && !isZeroDurationEntry) {
            await activityMonitor.sendFinalHeartbeat().catch(() => {});
        }

        // LOCAL-FIRST: Record stop in SQLite immediately with precise timestamps.
        const localEndedAt = new Date(endedAtMs).toISOString();
        const localDuration = sessionElapsed;
        const localStartedAtIso = currentEntry?.started_at || localEndedAt;
        const localId = currentEntry?._localId || null;

        if (localId) {
            saveLocalTimerStop(localId, localEndedAt, localDuration);
            console.log(
                `[Timer] Local stop recorded: ${localId}, duration=${localDuration}s`,
            );
        }

        // Try to sync stop with server (non-blocking for local state)
        let serverResult = null;
        let serverStopFailed = false;
        try {
            const stopPayload = {};
            // BUG 3 FIX: Target the SPECIFIC server entry id so the server closes THIS
            // session and never a newer/live one opened after it. Only send a REAL server
            // id (a `local-…` placeholder means the start never synced — in that case the
            // live stop may 404 (handled as success) and reconcileTimerState() will later
            // sync the full start+stop against the real server id).
            if (
                stoppedEntryId &&
                !String(stoppedEntryId).startsWith("local-")
            ) {
                stopPayload.time_entry_id = stoppedEntryId;
            }
            // Idempotency: makes a replayed stop (lost response on weak network) safe —
            // the server matches the key and won't re-close a different entry.
            if (currentEntry?.idempotency_key)
                stopPayload.idempotency_key = currentEntry.idempotency_key;
            // Send local timestamps for offline sync accuracy (local started_at is truth)
            if (currentEntry?._offline || currentEntry?._localId) {
                stopPayload.started_at = localStartedAtIso;
                stopPayload.ended_at = localEndedAt;
            }
            serverResult = await apiClient.stopTimer(stopPayload);
            // Mark synced in local DB
            if (localId) markLocalTimerStopSynced(localId);
        } catch (e) {
            serverStopFailed = true;
            if (e.response?.status === 404) {
                // BUG 3 FIX: 404 = entry already closed / not found on server. Treat as
                // already-synced success — do NOT retry against whatever is now latest.
                serverStopFailed = false;
                if (localId) markLocalTimerStopSynced(localId);
                console.log(
                    "[Timer] Server stop returned 404 (already synced) — treating as success",
                );
            } else if (!e.response || e.code === "ECONNABORTED") {
                // Network error or timeout — stop is already saved in timer_sessions via saveLocalTimerStop().
                // reconcileTimerState() will sync it on reconnect. Do NOT also queue in offlineQueue
                // to avoid dual-replay causing duplicate time entries.
                console.warn(
                    "[Timer] Server stop failed (offline/timeout) — saved locally, will reconcile on reconnect",
                );
            } else {
                // Server returned an error but we already stopped locally
                // timer_sessions has the stop recorded; reconcileTimerState() handles sync.
                console.error("[Timer] Server stop returned error:", e.message);
            }
        }

        // Now update local state (server confirmed stop, or we timed out)
        isTimerRunning = false;
        isTimerPaused = false;
        currentEntry = null;
        _cachedStartedAtMs = null;
        todayTotalCurrentProject = 0;
        _pendingOfflineReassignIdleSec = 0;
        _lastScreenshotAt = null;
        touchLastActiveAt(localEndedAt);
        // FIX D7: Increment state version on successful stop
        _timerStateVersion++;

        activityMonitor?.stop();
        screenshotService?.stop();
        idleDetector?.stop();
        stopTrayTimer();
        updateTrayIcon(false);

        notifyPopup("timer-stopped", {
            entry: null,
            todayTotal: localStoppedProjectTotal,
            // All-projects sum including the just-stopped session (the async block
            // below refreshes todayTotalGlobal from the server and re-emits).
            todayTotalGlobal:
                (todayTotalGlobal || 0) +
                Math.max(0, sessionElapsed - pendingIdleAtStop),
        });

        // Post-stop async work (non-blocking)
        (async () => {
            const result = serverStopFailed ? null : serverResult;
            // BUG-001: If the entry had near-zero duration (artifact from idle split),
            // delete it from the server to keep the timesheet clean.
            if (isZeroDurationEntry && stoppedEntryId && !serverStopFailed) {
                try {
                    await apiClient.deleteTimeEntry(stoppedEntryId);
                    console.log(
                        `[Timer] Deleted zero-duration entry ${stoppedEntryId} (${sessionElapsed}s)`,
                    );
                } catch (e) {
                    // Deletion is now forbidden system-wide (server policy returns 403).
                    // That's expected — don't log it as an error; just leave the tiny entry.
                    const status = e && e.response && e.response.status;
                    if (status === 403) {
                        console.log(
                            `[Timer] Zero-duration entry ${stoppedEntryId} left in place (deletion disabled by policy)`,
                        );
                    } else {
                        console.warn(
                            "[Timer] Failed to delete zero-duration entry:",
                            e.message,
                        );
                    }
                }
            }
            try {
                todayTotalGlobal = await apiClient.getTodayTotal(null);
            } catch {
                if (result?.today_total != null) {
                    todayTotalGlobal = result.today_total;
                } else {
                    // Offline: the server total is unreachable. todayTotalGlobal is the
                    // base (excludes the running session), so add the just-stopped
                    // session locally — otherwise the stopped display / get-timer-state
                    // would show 00:00:00 even though the time was saved (sleep auto-stop).
                    todayTotalGlobal =
                        (todayTotalGlobal || 0) +
                        Math.max(0, sessionElapsed - pendingIdleAtStop);
                }
            }
            updateTrayTitle();
            // Fall back to the LOCAL accumulated total, never 0. This async block
            // re-emits timer-stopped after the sync stop already showed the correct
            // local total; if the server stop returned nothing AND getTodayTotal fails
            // (flaky network), `?? 0` here would overwrite the correct stopped total
            // with 00:00:00 in the popup. Keep the local total instead.
            let todayTotalForPopup = result?.today_total ?? localStoppedProjectTotal;
            try {
                const serverTotal =
                    await apiClient.getTodayTotal(stoppedProjectId);
                if (serverTotal != null && serverTotal >= 0) {
                    todayTotalForPopup = serverTotal;
                }
            } catch {
                // Network failed — keep the local accumulated total (not 0).
                todayTotalForPopup = localStoppedProjectTotal;
            }
            notifyPopup("timer-stopped", {
                entry: result?.entry ?? null,
                todayTotal: todayTotalForPopup,
                // Refreshed all-projects sum (server-authoritative when online).
                todayTotalGlobal,
            });
        })().catch(() => {});

        return {
            success: true,
            entry: null,
            todayTotal: localStoppedProjectTotal,
        };
    } finally {
        _stopTimerInProgress = false;
    }
}

// ── Reconciliation on Reconnect ─────────────────────────────────────────────
// When network comes back, compare local SQLite timer state vs server state.
// Preference: never lose time.
/**
 * BUG 3 FIX: Sync a completed local session's stop to the server, ALWAYS binding
 * to the specific server entry id (`time_entry_id`) so the server closes THIS
 * entry and never a newer/live one. Sends local timestamps + idempotency key.
 * Returns true if synced (or already-synced via 404), false to retry later.
 */
async function syncSessionStop(session) {
    const payload = {
        started_at: session.started_at,
        ended_at: session.ended_at,
    };
    if (session.server_entry_id)
        payload.time_entry_id = session.server_entry_id;
    if (session.idempotency_key)
        payload.idempotency_key = session.idempotency_key;
    try {
        await apiClient.stopTimer(payload);
        markLocalTimerStopSynced(session.id);
        return true;
    } catch (e) {
        if (e.response?.status === 404) {
            // Entry already closed/gone on server — treat as already-synced success.
            markLocalTimerStopSynced(session.id);
            return true;
        }
        console.warn(
            `[Reconcile] Session ${session.id} stop sync failed:`,
            e.message,
        );
        return false;
    }
}

async function reconcileTimerState() {
    if (!apiClient) return;
    // FIX D4: Skip reconcile if idle action is in progress to prevent race conditions
    if (_isHandlingIdleAction) {
        console.log("[Reconcile] Skipping — idle action in progress");
        return;
    }
    if (idleDetector?.isIdleActive()) {
        console.log("[Reconcile] Skipping — idle alert active");
        return;
    }
    // START-RACE FIX: while startTimer() is mid-flight it has already written the
    // local start and is calling the API itself (and will mark it synced). If a
    // TimerSync tick drives reconcile in that ~150ms window, reconcile would ALSO
    // push the still-"unsynced" start → a second, duplicate server entry (the
    // 1-second straggler overlapping the real entry). Defer to startTimer.
    if (_startTimerInProgress) {
        console.log("[Reconcile] Skipping — startTimer in progress");
        return;
    }
    // BUG 3 FIX: Shared guard — reconcile and the startTimerSync loop must not
    // mutate timer state (currentEntry / _cachedStartedAtMs / isTimerRunning)
    // concurrently. Whichever runs first wins; the other defers to the next tick.
    if (_timerStateMutationInProgress) {
        console.log(
            "[Reconcile] Skipping — timer state mutation already in progress",
        );
        return;
    }
    _timerStateMutationInProgress = true;
    try {
        const serverStatus = await apiClient.getTimerStatus();
        // FIX D8: Update clock offset for server time sync (telemetry only — NOT
        // applied to stored or displayed timestamps; see adoptServerStartedAt / tray).
        if (serverStatus.server_time) {
            _clockOffsetMs =
                new Date(serverStatus.server_time).getTime() - Date.now();
        }
        const localActive = getActiveLocalTimer();

        // ── Phase 1: Sync completed (stopped) sessions FIRST ──────────────────
        // This ensures stopped sessions are flushed to the server BEFORE we push
        // any new starts. Prevents the Redis key mismatch bug where pushing a new
        // start auto-stops the wrong entry on the server.
        const unsynced = getUnsyncedTimerSessions();

        // Pass 1a: sync sessions that have a synced start but unsynced stop (stop-only)
        for (const session of unsynced) {
            if (session.id === currentEntry?._localId) continue; // Skip active session
            if (
                session.synced_start &&
                session.ended_at &&
                !session.synced_stop
            ) {
                // BUG 3 FIX: bind stop to the specific server entry id (inside helper).
                await syncSessionStop(session);
            }
        }

        // Pass 1b: sync sessions that need both start + stop (fully unsynced, completed)
        for (const session of unsynced) {
            if (session.id === currentEntry?._localId) continue; // Skip active session
            if (!session.synced_start) {
                try {
                    // BUG 1 FIX: send the REAL local started_at so the server records the
                    // true offline start instead of defaulting to now() at reconcile time.
                    const result = await apiClient.startTimer(
                        session.project_id || null,
                        session.idempotency_key,
                        session.started_at,
                    );
                    markLocalTimerStartSynced(session.id, result.entry.id);
                    if (session.ended_at) {
                        // BUG 3 FIX: now that server_entry_id is known, bind the stop to it.
                        await syncSessionStop({
                            ...session,
                            server_entry_id: result.entry.id,
                        });
                    }
                } catch (e) {
                    console.warn(
                        `[Reconcile] Session ${session.id} sync failed:`,
                        e.message,
                    );
                }
            }
        }

        // ── Phase 2: Handle the currently active timer ────────────────────────
        if (localActive && !localActive.synced_start) {
            // Local has an unsynced start — push it to server
            console.log("[Reconcile] Pushing unsynced local start to server");
            try {
                // BUG 1 FIX: send the REAL local started_at (offline start time).
                const result = await apiClient.startTimer(
                    localActive.project_id || null,
                    localActive.idempotency_key,
                    localActive.started_at,
                );
                markLocalTimerStartSynced(localActive.id, result.entry.id);
                // If this is the active in-memory entry, capture the resolved server id
                // so any subsequent stop binds to it (BUG 3).
                if (localActive.id === currentEntry?._localId && currentEntry) {
                    currentEntry.id = result.entry.id;
                    // FIX D2: rebind the live screenshot service off the stale `local-…`
                    // id so subsequent live captures presign against the real entry id
                    // (without restarting the capture cadence).
                    screenshotService?.rebindEntryId(result.entry.id);
                }

                // If local also has an unsynced stop, push that too — bound to server id.
                if (localActive.ended_at && !localActive.synced_stop) {
                    await syncSessionStop({
                        ...localActive,
                        server_entry_id: result.entry.id,
                    });
                }
            } catch (startErr) {
                if (startErr.response?.status === 409) {
                    // Server already has a running timer — check if it's ours (idempotency)
                    console.log("[Reconcile] Server has running timer (409)");
                } else {
                    console.warn(
                        "[Reconcile] Start sync failed, will retry:",
                        startErr.message,
                    );
                }
            }
        } else if (
            !isServerTimerOpen(serverStatus) &&
            isTimerRunning &&
            currentEntry?._localId
        ) {
            // Server has NEITHER a running NOR a paused entry, but local does — push
            // start with the original timestamp.
            //
            // MUST use isServerTimerOpen() (running OR paused), not raw
            // !serverStatus.running: an idle-PAUSED server timer is still an OPEN
            // entry. Treating "paused" as "no timer" here pushed a DUPLICATE start on
            // reconnect (a second overlapping entry) AND changed the Redis entry id —
            // which then 409'd and DROPPED a queued offline reassign that still
            // referenced the original entry. See
            // bugs/idle-reassign-offline-reconcile-duplicate.md.
            console.log(
                "[Reconcile] Server has no timer but local is running — pushing start",
            );
            const key =
                currentEntry?.idempotency_key || generateIdempotencyKey();
            // BUG 1 FIX: derive the REAL local start (from cached anchor or the entry)
            // and send it so the server records the true start, not now().
            const localStartIso =
                currentEntry?.started_at ||
                (_cachedStartedAtMs
                    ? new Date(_cachedStartedAtMs).toISOString()
                    : null);
            try {
                const result = await apiClient.startTimer(
                    currentEntry?.project_id || null,
                    key,
                    localStartIso,
                );
                if (currentEntry?._localId) {
                    markLocalTimerStartSynced(
                        currentEntry._localId,
                        result.entry.id,
                    );
                }
                // Update local entry with server data, but keep the local start anchor
                // immutable (BUG 2: never push the displayed start forward).
                currentEntry = {
                    ...result.entry,
                    _localId: currentEntry?._localId,
                    idempotency_key: key,
                };
                adoptServerStartedAt(result.entry?.started_at);
                // FIX D2: rebind live screenshot capture to the resolved server id.
                screenshotService?.rebindEntryId(result.entry?.id);
            } catch (e) {
                console.warn("[Reconcile] Push start failed:", e.message);
            }
        } else if (isServerTimerOpen(serverStatus) && isTimerRunning) {
            // Server has an OPEN entry (running OR idle-paused) and local is running.
            // Adopt the server ENTRY (id, project) so stops AND any queued offline
            // reassign target the SAME entry instead of pushing a duplicate. A paused
            // entry is resumed by the self-heal below; binding currentEntry to it here
            // is what lets the queued reassign match (no 409). BUG 2 FIX: the local
            // started_at is immutable truth — adoptServerStartedAt enforces
            // "earlier-or-equal wins", so a skewed/wrong server now()-start can never
            // make the visible timer jump backward.
            currentEntry = {
                ...serverStatus.entry,
                _localId: currentEntry?._localId,
            };
            adoptServerStartedAt(serverStatus.entry?.started_at);
        }

        // FIX D4: Self-heal a stuck server-side pause. Idle pause calls
        // apiClient.pauseTimer() server-side; on an offline 'keep' the matching
        // resumeTimer() throws and is swallowed with no durable retry, so the server
        // stays paused → the next sync re-pauses the UI (frozen timer) and totals are
        // computed off the frozen elapsed. If the server still reports paused while we
        // are locally running and NOT paused, replay the resume (idempotent). This runs
        // every reconcile (online handler + scheduleReconcileAndFlush), so it converges.
        if (
            isServerTimerPaused(serverStatus) &&
            isTimerRunning &&
            !isTimerPaused &&
            currentEntry?.id &&
            !String(currentEntry.id).startsWith("local-")
        ) {
            try {
                console.log(
                    "[Reconcile] Server paused but local is running — replaying resume (self-heal)",
                );
                await apiClient.resumeTimer();
            } catch (e) {
                console.warn(
                    "[Reconcile] Resume replay failed (will retry next reconcile):",
                    e.message,
                );
            }
        }

        cleanOldLocalTimerSessions();
    } catch (e) {
        console.error("[Reconcile] Failed:", e.message);
    } finally {
        _timerStateMutationInProgress = false;
    }
}

// Periodically sync timer state with server to stay in sync with web dashboard
let _configRefetchCycle = 0;
let _isSyncing = false; // M6 FIX: guard against concurrent sync cycles
let _timerSyncTransientLogAt = 0;
const TIMER_SYNC_TRANSIENT_LOG_MS = 60000;

/** Network/timeouts while OS still reports "online" — avoid error-spam in logs */
function isTransientTimerSyncError(err) {
    const code = err && err.code;
    const msg = (err && err.message) || "";
    if (
        code === "ECONNABORTED" ||
        code === "ETIMEDOUT" ||
        code === "ECONNREFUSED" ||
        code === "ENOTFOUND" ||
        code === "ENETUNREACH" ||
        code === "EAI_AGAIN" ||
        code === "ERR_NETWORK"
    ) {
        return true;
    }
    if (/timeout.*exceeded/i.test(msg)) return true;
    if (!err.response && err.request) return true;
    return false;
}

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
                console.log("[Config] Re-fetched org config");
            } catch (e) {
                // Silent failure — keep using existing config
            }
            try {
                const shiftData = await apiClient.getMyShift();
                currentShift = shiftData?.shift || null;
                notifyPopup("shift-update", { shift: currentShift });
                console.log("[Shift] Fetched:", currentShift?.name || "none");
            } catch (e) {
                // Silent failure — keep using existing shift data
            }
        }

        // CONNECTIVITY FIX: Skip sync when offline to avoid unnecessary errors
        if (networkMonitor && !networkMonitor.isOnline) {
            _isSyncing = false;
            return;
        }

        // BUG 3 FIX: Shared guard — don't mutate timer state while reconcile (or
        // another mutator) holds it. Defer this tick; the next 10s tick retries.
        if (_timerStateMutationInProgress) {
            _isSyncing = false;
            return;
        }
        _timerStateMutationInProgress = true;

        try {
            const status = await apiClient.getTimerStatus();
            const globalTotal = status.today_total ?? 0;
            const elapsed = status.elapsed_seconds ?? 0;
            if (isServerTimerOpen(status)) {
                todayTotalGlobal = Math.max(0, globalTotal - elapsed);
                const projectTotal = status.project_today_total ?? globalTotal;
                todayTotalCurrentProject = Math.max(0, projectTotal - elapsed);
            } else {
                todayTotalGlobal = globalTotal;
                todayTotalCurrentProject = 0;
            }

            if (isServerTimerOpen(status) && !isTimerRunning) {
                if (hasUnsyncedLocalStopForEntry(status.entry?.id)) {
                    // Local stop pending (server status is stale) — push the stop instead
                    // of re-adopting the timer as running (self-restart-after-stop bug).
                    console.log(
                        "[TimerSync] Server shows entry open but a local stop is pending — pushing stop, not re-opening",
                    );
                    scheduleReconcileAndFlush();
                } else {
                    syncOpenTimerFromServerStatus(status, { notify: "none" });
                }
            } else if (
                isServerTimerOpen(status) &&
                isTimerRunning &&
                isServerTimerPaused(status) !== isTimerPaused
            ) {
                syncOpenTimerFromServerStatus(status, {
                    notify: isServerTimerPaused(status) ? "pause" : "start",
                });
            } else if (
                !isServerTimerOpen(status) &&
                !isTimerRunning &&
                !isTimerPaused
            ) {
                // Phantom-stop recovery: in-memory state was cleared but SQLite still has an open session.
                const orphanLocal = getActiveLocalTimer();
                if (orphanLocal && !orphanLocal.ended_at) {
                    console.log(
                        "[TimerSync] Restoring orphaned local session after phantom stop",
                    );
                    restoreInMemoryFromLocalActive(orphanLocal);
                    const sessionElapsed = _cachedStartedAtMs
                        ? Math.floor((Date.now() - _cachedStartedAtMs) / 1000)
                        : 0;
                    todayTotalCurrentProject = Math.max(
                        0,
                        globalTotal - sessionElapsed,
                    );
                    activityMonitor?.start();
                    if (currentEntry?.id)
                        screenshotService?.start(currentEntry.id);
                    idleDetector?.start();
                    startTrayTimer();
                    updateTrayIcon(true);
                    notifyPopup("timer-started", {
                        ...currentEntry,
                        todayTotal: todayTotalCurrentProject,
                    });
                    _isSyncing = false;
                    _timerStateMutationInProgress = false;
                    scheduleReconcileAndFlush();
                    return;
                }
            } else if (
                !isServerTimerOpen(status) &&
                (isTimerRunning || isTimerPaused)
            ) {
                // BUG-2 FIX: Don't override local state while idle alert is showing — the server may show
                // timer as stopped because idle-discard split the entry, but locally we're still
                // in the idle flow and the user hasn't responded yet.
                if (idleDetector?.isIdleActive()) {
                    console.log(
                        "[TimerSync] Server says stopped but idle alert is active — keeping local state",
                    );
                    _isSyncing = false;
                    _timerStateMutationInProgress = false; // BUG 3 FIX: release shared guard on early return
                    return;
                }
                // BUG FIX (phantom-stop-local-first-desync): a local-first start that has not
                // synced yet means the server has never seen it — its "not running" is stale.
                // Killing the timer here is what produced the "Start shown while timer still runs"
                // desync. Keep local state, AND actively push the unsynced start so we don't wait
                // for an offline→online transition (which never fires when the original POST failed
                // transiently while net.isOnline() stayed true). reconcileTimerState() owns the
                // correct push logic (real local started_at + idempotency_key), but it early-returns
                // while _timerStateMutationInProgress is held — so we MUST release both guards first,
                // then schedule reconcile via setImmediate (mirrors the pattern at the resume/idle
                // paths). Gate on isOnline: when genuinely offline the 'online' handler will catch it.
                const _localActive = getActiveLocalTimer();
                if (_localActive && !_localActive.synced_start) {
                    console.log(
                        "[TimerSync] Server says stopped but local start is unsynced — keeping local state and driving reconcile",
                    );
                    _isSyncing = false;
                    _timerStateMutationInProgress = false;
                    if (networkMonitor?.isOnline && offlineQueue && apiClient) {
                        setImmediate(() => {
                            reconcileTimerState()
                                .then(() => offlineQueue.flush(apiClient))
                                .catch(() => {});
                        });
                    }
                    return;
                }
                isTimerRunning = false;
                isTimerPaused = false;
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
                // Carry the state version so the renderer's stale-notification guard can reject
                // this stop if a newer start has already landed.
                notifyPopup("timer-stopped", {
                    entry: null,
                    todayTotal: globalTotal,
                    _stateVersion: _timerStateVersion,
                });
            }
        } catch (err) {
            if (isTransientTimerSyncError(err)) {
                const now = Date.now();
                if (
                    now - _timerSyncTransientLogAt >=
                    TIMER_SYNC_TRANSIENT_LOG_MS
                ) {
                    _timerSyncTransientLogAt = now;
                    const hint = err.code ? err.code : err.message;
                    console.warn(
                        "[TimerSync] API unreachable (retrying while online):",
                        hint,
                        "— check TRACKFLOW_API_URL or server availability",
                    );
                }
            } else {
                console.error("[TimerSync] sync failed:", err.message);
            }
            // Do not re-throw — keep interval alive
        } finally {
            _isSyncing = false; // M6 FIX: Always release sync guard
            _timerStateMutationInProgress = false; // BUG 3 FIX: always release shared mutation guard
        }
    }, 10000);
}

function formatTimeShort(seconds) {
    const h = Math.floor(seconds / 3600)
        .toString()
        .padStart(2, "0");
    const m = Math.floor((seconds % 3600) / 60)
        .toString()
        .padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
}

function updateTrayIcon(running) {
    if (!tray) return;
    try {
        const icon = getTrayIcon(running);
        tray.setImage(icon);
    } catch (e) {
        console.warn("[Tray] Failed to update icon:", e.message);
    }
    tray.setToolTip(running ? "TrackFlow - Timer Running" : "TrackFlow");
}

// Cross-platform tray text:
//   macOS: tray.setTitle() shows text next to icon in menu bar.
//            Text color is system-controlled (white in dark mode, black in light mode).
//            The green/gray dot in the template icon indicates tracking state.
//   Windows/Linux: tray.setTitle() is not visible — tooltip used instead.
function setTrayText(text) {
    if (!tray) return;
    if (process.platform === "darwin") {
        // Use plain system color — macOS auto-adapts to menu bar (white/dark, black/light).
        // State is indicated by the colored dot in the tray icon, not text color.
        tray.setTitle(text || "", { fontType: "monospacedDigit" });
    }
    // All platforms: update tooltip so hover shows the time
    if (text) {
        tray.setToolTip(`TrackFlow — ${text}`);
    } else {
        tray.setToolTip("TrackFlow");
    }
}

function updateTrayTitle() {
    if (!tray) return;
    const total = isTimerRunning ? todayTotalCurrentProject : todayTotalGlobal;
    if (total > 0) {
        setTrayText(formatTimeShort(total));
    } else {
        setTrayText("");
    }
}

function startTrayTimer() {
    stopTrayTimer();
    updateTrayTitle();
    trayTimerInterval = setInterval(() => {
        // If the timer stopped out-of-band (stop synced from the server/web, or the
        // entry was removed) the interval used to just `return`, leaving the LAST
        // rendered "HH:MM:SS" frozen in the menu bar forever while the popup showed
        // 00:00:00. Refresh the tray to the stopped state and stop ticking instead.
        if (!isTimerRunning) {
            stopTrayTimer();
            updateTrayTitle();
            return;
        }
        if (!_cachedStartedAtMs) return;
        // BUG 2 FIX (clock-skew consistency): `_cachedStartedAtMs` is the LOCAL
        // started_at (local source of truth, stored uncorrected). Elapsed time must
        // therefore be measured against the LOCAL clock too — `Date.now()`. Adding
        // `_clockOffsetMs` here while the anchor is uncorrected double-applies skew
        // and makes the displayed time jump. We deliberately apply skew to NEITHER
        // the stored anchor NOR the display, keeping both on the same (local) clock.
        const clientNowMs = Date.now();
        const currentElapsed = Math.floor(
            (clientNowMs - _cachedStartedAtMs) / 1000,
        );
        const totalSeconds =
            todayTotalCurrentProject +
            Math.max(0, currentElapsed - _pendingOfflineReassignIdleSec);
        const formatted = formatTimeShort(totalSeconds);
        setTrayText(formatted);
        // L12: Only send IPC to renderer when window is visible — avoids wasted work
        if (
            popupWindow &&
            !popupWindow.isDestroyed() &&
            popupWindow.isVisible()
        ) {
            popupWindow.webContents.send("timer-tick", {
                totalSeconds,
                formatted,
                // Non-ticking all-projects sum for the secondary field. This is the
                // server-synced completed total (excludes the live running session),
                // so it stays stable across ticks instead of climbing every second.
                todayTotalGlobal,
                activityScore: activityMonitor
                    ? activityMonitor.getCurrentScore()
                    : 0,
                lastScreenshotAt: _lastScreenshotAt,
                isOnline: networkMonitor?.isOnline ?? true,
            });
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

    function buildIdleAlertPayload(alertShownAtMs) {
        const shownAt =
            alertShownAtMs ??
            _idleAlertShownAt ??
            idleDetector?.alertShownAt ??
            Date.now();
        return {
            idleStartedAt,
            idleSeconds,
            actionId: alertActionId,
            alertShownAt: shownAt,
            autoStopGraceSec: idleDetector?.alertAutoStopSec ?? 0,
            projects: cachedProjects || [],
        };
    }

    if (idleAlertWindow && !idleAlertWindow.isDestroyed()) {
        // Alert already showing — bring it to front and update idle data
        idleAlertWindow.focus();
        if (typeof idleAlertWindow.moveTop === "function") {
            idleAlertWindow.moveTop();
        }
        // Update the action ID on the window so the close handler uses the latest
        idleAlertWindow._actionId = alertActionId;
        idleAlertWindow.webContents.send(
            "idle-data",
            buildIdleAlertPayload(_idleAlertShownAt),
        );
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
                title: "TrackFlow",
                body: `You've been idle for ${Math.floor(idleSeconds / 60)} minutes`,
                silent: false, // Enables the default system notification sound
            });
            idleNotification.show();
            setTimeout(() => {
                try {
                    idleNotification.close();
                } catch {}
            }, 5000);
        }
    } catch {}

    // Use cached project list — do not block the idle popup on a network call.
    // Force a background refresh on open (throttled) so a newly assigned project
    // shows in the reassign dropdown; the cached list renders immediately, and the
    // fresh list is pushed via idle-data when it arrives.
    refreshProjectsOnOpen(pushProjectsToIdleAlert);

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
        backgroundColor: "#0a0a0a", // Prevent white flash on all platforms
        webPreferences: {
            preload: path.join(__dirname, "..", "preload", "index.js"),
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
        // FIX D1: Record when the alert was actually shown to exclude dialog wait time
        _idleAlertShownAt = Date.now();
        win.show();
        win.focus();
        win.webContents.send(
            "idle-data",
            buildIdleAlertPayload(_idleAlertShownAt),
        );
    }

    // Primary: show as soon as first paint completes
    win.once("ready-to-show", showAndSendData);

    // Fallback: on some macOS configurations (e.g., app backgrounded, Spaces,
    // or sandbox + alwaysOnTop combos), ready-to-show may not fire reliably.
    // Use did-finish-load as a safety net.
    win.webContents.once("did-finish-load", showAndSendData);

    // If the idle alert window is closed without the user clicking an action
    // button (e.g., Cmd+W, dock close, OS memory pressure), treat as "keep"
    // (safest default — does not discard tracked time) and re-arm the detector.
    win._dismissedProgrammatically = false;

    win.on("closed", () => {
        idleAlertWindow = null;
        if (!win._dismissedProgrammatically) {
            if (idleDetector?.isIdleActive() && isTimerRunning) {
                console.log(
                    "[IdleAlert] Window closed without user action — re-showing in 3s",
                );
                setTimeout(() => {
                    if (idleDetector?.isIdleActive() && isTimerRunning) {
                        const idleDuration = idleDetector.getIdleDuration();
                        const idleStart = idleDetector.idleStartedAt;
                        const actionId = idleDetector.getActionId();
                        showIdleAlert(idleDuration, idleStart, actionId);
                    }
                }, 3000);
            } else {
                console.log(
                    "[IdleAlert] Window closed without user action — idle already resolved, treating as keep",
                );
                const windowActionId = win._actionId;
                const resolved = idleDetector?.resolveIdle(windowActionId);
                if (resolved) {
                    activityMonitor?.start();
                    if (isTimerRunning && currentEntry) {
                        screenshotService?.start(currentEntry.id, {
                            immediateCapture:
                                config.screenshot_capture_immediate_after_idle ===
                                true,
                        });
                    }
                    idleDetector?.start();
                }
                updateTrayIcon(isTimerRunning);
                if (isTimerRunning) {
                    updateTrayTitle();
                    startTrayTimer();
                }
            }
        }
    });

    win.loadFile(
        path.join(__dirname, "..", "renderer", "idle-alert.html"),
    ).catch((err) => {
        console.error(
            "[IdleAlert] Failed to load idle-alert.html:",
            err.message,
        );
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
async function handleIdleAction(
    action,
    actionId = null,
    idleDurationOverride = null,
    reassignProjectId = null,
) {
    // Mutex: prevent double-action (auto-stop + user click, or double-click)
    if (_idleActionInProgress) {
        console.warn(
            `[handleIdleAction] Action "${action}" blocked — another action is in progress`,
        );
        return;
    }
    _idleActionInProgress = true;
    // FIX D4: Mutex to block reconcileTimerState while handling idle action
    _isHandlingIdleAction = true;

    try {
        // Read idle info BEFORE resolving (resolveIdle clears it)
        const idleDuration =
            idleDurationOverride || idleDetector?.getIdleDuration() || 0;
        const idleStartedAt = idleDetector?.idleStartedAt || null;

        posthog.capture(currentEntry?.user_id || "unknown", "idle_action", {
            action,
            idle_seconds: idleDuration,
        });

        // Resolve the idle state — returns null if already resolved (stale action)
        const resolved = idleDetector?.resolveIdle(actionId);
        if (!resolved && idleDetector?.state !== IDLE_STATE.STOPPED) {
            console.warn(
                `[handleIdleAction] Action "${action}" aborted — idle already resolved`,
            );
            if (idleAlertWindow && !idleAlertWindow.isDestroyed()) {
                idleAlertWindow.webContents.send("idle-action-error", {
                    message:
                        "This idle alert has already been handled (e.g. auto-stop). Please check your timer.",
                });
            }
            return;
        }

        // Use idleStartedAt from the resolve result if available (more reliable
        // than reading it before resolve, since resolve is atomic)
        const effectiveIdleStartedAt = resolved?.idleStartedAt || idleStartedAt;

        // Restore tray tooltip from idle state back to normal
        updateTrayIcon(isTimerRunning);
        if (isTimerRunning) updateTrayTitle();

        switch (action) {
            case "keep":
                logToFile("info", `[IDLE_ACTION] keep`);
                await resumeTimerAfterIdle();
                activityMonitor?.start();
                if (isTimerRunning && currentEntry) {
                    screenshotService?.start(currentEntry.id, {
                        immediateCapture:
                            config.screenshot_capture_immediate_after_idle ===
                            true,
                    });
                }
                idleDetector?.start();
                startTrayTimer();
                break;

            case "discard":
            case "reassign":
                if (apiClient && currentEntry && effectiveIdleStartedAt) {
                    // REASSIGN counts the FULL time the user was away — idle-start
                    // → now (the reassign click) — toward the chosen project,
                    // INCLUDING the time the idle dialog stayed open. The user was
                    // away doing that other work, so capping at the idle threshold
                    // (_idleAlertShownAt) under-counted it (e.g. showed the 5-min
                    // threshold when the user was away 9–12 min). The "never"-policy
                    // auto-discard has no dialog, so now() matches its old value.
                    const idleEndedAt = Date.now();
                    const idleSeconds = Math.floor(
                        (idleEndedAt - effectiveIdleStartedAt) / 1000,
                    );
                    const payload = {
                        time_entry_id: currentEntry.id,
                        idle_started_at: new Date(
                            effectiveIdleStartedAt,
                        ).toISOString(),
                        idle_ended_at: new Date(idleEndedAt).toISOString(),
                        idle_seconds: Math.max(1, idleSeconds),
                        action:
                            action === "reassign" && reassignProjectId
                                ? "reassign"
                                : "discard",
                    };
                    if (payload.action === "reassign")
                        payload.project_id = reassignProjectId;

                    try {
                        const result = await apiClient.reportIdleTime(payload);

                        // FIX D10: Handle null new_entry — timer was stopped remotely during idle
                        if (!result?.new_entry) {
                            console.warn(
                                "[IdleAction] Server returned no new entry — timer was already stopped remotely",
                            );
                            dismissIdleAlert();
                            _idleAlertShownAt = null;
                            _isHandlingIdleAction = false;
                            setImmediate(() => reconcileTimerState());
                            return;
                        }

                        // FIX D5: Update todayTotalCurrentProject immediately after discard.
                        // Measure pre-idle work to idle-START (not idle-end): the server
                        // closes the original tracked entry at idle_started_at and the idle
                        // gap [idle_started_at, idle_ended_at] is excluded (audit-only `idle`
                        // entry). Using idleEndedAt here double-counts the discarded idle gap
                        // — the new live entry already counts from idle_ended_at, so the
                        // display total would inflate to the full elapsed (the "desktop ~20m
                        // while portal ~16m after discard" bug).
                        const preIdleSeconds = Math.floor(
                            (effectiveIdleStartedAt -
                                new Date(currentEntry.started_at).getTime()) /
                                1000,
                        );
                        todayTotalCurrentProject =
                            (todayTotalCurrentProject || 0) +
                            Math.max(0, preIdleSeconds);

                        // Re-anchor the LOCAL source of truth to the resumed
                        // (post-idle) entry. The server split the session at the idle
                        // boundary and opened a NEW entry at idle-end; the local
                        // timer_sessions row MUST follow. Otherwise the next reconcile
                        // / phantom-stop recovery re-reads the OLD row's pre-idle
                        // started_at and — via the never-move-forward guard in
                        // adoptServerStartedAt() — re-anchors elapsed back to the
                        // original start, inflating the displayed time by the excluded
                        // idle (+ pre-idle) duration. This is the root cause of the
                        // "desktop shows ~25m while web shows ~14m" report.
                        const prevLocalId = currentEntry._localId || null;
                        const prevStartIso = currentEntry.started_at;

                        currentEntry = result.new_entry;
                        _cachedStartedAtMs = new Date(
                            currentEntry.started_at,
                        ).getTime();

                        // Close the stale local session at idle-start (already synced
                        // server-side by the split) and open a fresh local session
                        // anchored at the new entry's start, so getActiveLocalTimer()
                        // returns the post-idle start everywhere downstream.
                        const newLocalId = `local-${Date.now()}-${Math.random()
                            .toString(36)
                            .slice(2, 6)}`;
                        const newIdempotencyKey =
                            currentEntry.idempotency_key ||
                            generateIdempotencyKey();
                        if (prevLocalId) {
                            const preIdleDuration = Math.max(
                                0,
                                Math.floor(
                                    (effectiveIdleStartedAt -
                                        new Date(prevStartIso).getTime()) /
                                        1000,
                                ),
                            );
                            saveLocalTimerStop(
                                prevLocalId,
                                new Date(effectiveIdleStartedAt).toISOString(),
                                preIdleDuration,
                            );
                            markLocalTimerStopSynced(prevLocalId);
                        }
                        saveLocalTimerStart(
                            newLocalId,
                            newIdempotencyKey,
                            currentEntry.project_id || null,
                            currentEntry.started_at,
                        );
                        if (
                            currentEntry.id &&
                            !String(currentEntry.id).startsWith("local-")
                        ) {
                            markLocalTimerStartSynced(
                                newLocalId,
                                currentEntry.id,
                            );
                        }
                        currentEntry._localId = newLocalId;
                        currentEntry.idempotency_key = newIdempotencyKey;

                        // No screenshots are captured during idle (Hubstaff behavior), so
                        // there is nothing to attach to the post-split entry on reassign and
                        // nothing to drop on discard.
                    } catch (e) {
                        logToFile(
                            "warn",
                            `[IDLE_ACTION] discard API failed: ${e.message}`,
                        );
                        console.error(
                            "[IdleAction] Failed to report idle time to server:",
                            e.message,
                        );
                        offlineQueue?.add("idle_discard", payload);
                        // DISPLAY-ONLY: for an offline REASSIGN, the idle is moving to
                        // another project but the server split won't apply until
                        // reconnect. The local timer stays anchored at the original
                        // start (re-anchoring offline breaks the reconnect split), so
                        // the live total would wrongly grow on the origin project by
                        // this idle. Subtract it from the displayed total until the
                        // reassign syncs. (discard does not resume, so only reassign.)
                        if (payload.action === "reassign") {
                            _pendingOfflineReassignIdleSec = Math.max(
                                0,
                                idleSeconds,
                            );
                        }
                        if (idleAlertWindow && !idleAlertWindow.isDestroyed()) {
                            idleAlertWindow.webContents.send(
                                "idle-action-error",
                                {
                                    message:
                                        "Network error — idle discard queued. Timer will resume locally and sync when online.",
                                },
                            );
                        }
                        // Resume without server split — reconcile + offline queue flush later
                        _idleAlertShownAt = null;
                        await resumeTimerAfterIdle();
                        activityMonitor?.start();
                        if (isTimerRunning && currentEntry) {
                            screenshotService?.start(currentEntry.id, {
                                immediateCapture:
                                    config.screenshot_capture_immediate_after_idle ===
                                    true,
                            });
                        }
                        idleDetector?.start();
                        startTrayTimer();
                        notifyPopup("timer-resumed", {
                            entry: currentEntry,
                            todayTotal: todayTotalCurrentProject,
                            _offlineDiscardPending: true,
                        });
                        scheduleReconcileAndFlush();
                        break;
                    }
                }
                // FIX D1: Reset _idleAlertShownAt after action handled
                _idleAlertShownAt = null;
                await resumeTimerAfterIdle();
                activityMonitor?.start();
                if (isTimerRunning && currentEntry) {
                    screenshotService?.start(currentEntry.id, {
                        immediateCapture:
                            config.screenshot_capture_immediate_after_idle ===
                            true,
                    });
                }
                idleDetector?.start();
                startTrayTimer();
                // FIX D6: Notify popup immediately after split
                notifyPopup("timer-started", {
                    ...currentEntry,
                    todayTotal: todayTotalCurrentProject,
                    _splitFromIdle: true,
                });
                break;

            case "stop":
                // Discard idle time AND stop the timer (used by the "Discard Idle
                // Time" button and by idle auto-stop).
                //
                // Do NOT split the session server-side first (the old reportIdle +
                // stopTimer dance): reportIdle opens a NEW server entry and we set it
                // as currentEntry, but that new entry has no local `_localId`, so
                // stopTimer() skips saveLocalTimerStop() and leaves the ORIGINAL local
                // timer_sessions row OPEN. reconcileTimerState() then re-reads that
                // still-open row and re-adopts it as a phantom live timer anchored at
                // the ORIGINAL start — the "timer restarted itself and jumped to the
                // full elapsed" bug.
                //
                // Instead, simply STOP the current entry effective at idle-START. The
                // idle period (and the dialog/grace wait) is excluded because the
                // entry ends where the user was last active; pre-idle work is kept, no
                // new entry is created, no resume happens, and stopTimer() closes the
                // ORIGINAL local row via currentEntry._localId so reconcile cannot
                // re-adopt it. Offline-safe: stopTimer() records the stop locally and
                // reconciles on reconnect.
                await stopTimer({
                    endedAtMs: effectiveIdleStartedAt || Date.now(),
                });
                break;
        }
        // After idle is resolved: flush any pending offline data (heartbeats,
        // screenshots, timer events queued during sleep). This is especially
        // important after a long sleep where reconcile was deferred.
        if (networkMonitor?.isOnline && offlineQueue && apiClient) {
            setImmediate(() => {
                reconcileTimerState()
                    .then(() => offlineQueue.flush(apiClient))
                    .catch(() => {});
            });
        }
        // FIX D7: Increment state version on successful idle action
        _timerStateVersion++;
    } finally {
        _idleActionInProgress = false;
        // FIX D4: Release reconcile mutex
        _isHandlingIdleAction = false;
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
        frame: false, // Custom titlebar for identical look on macOS/Windows/Linux
        resizable: false,
        center: true,
        backgroundColor: "#0a0a0a",
        webPreferences: {
            preload: path.join(__dirname, "..", "preload", "index.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            devTools: true,
        },
    });

    loginWindow.loadFile(path.join(__dirname, "..", "renderer", "login.html"));

    loginWindow.on("closed", () => {
        loginWindow = null;
    });

    // Only register the login handlers once
    if (!loginHandlerRegistered) {
        loginHandlerRegistered = true;

        // ── Email/Password Login (multi-org aware) ──
        ipcMain.handle("login", async (_, email, password) => {
            // Validate inputs
            if (typeof email !== "string" || typeof password !== "string") {
                return { error: "Invalid credentials format" };
            }
            email = email.trim();
            if (!email || !password) {
                return { error: "Email and password are required" };
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
                if (timerSyncInterval) {
                    clearInterval(timerSyncInterval);
                    timerSyncInterval = null;
                }
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
        ipcMain.handle("google-login", async () => {
            const googleClientId =
                process.env.TRACKFLOW_GOOGLE_CLIENT_ID ||
                process.env.GOOGLE_CLIENT_ID ||
                "";
            const googleClientSecret =
                process.env.TRACKFLOW_GOOGLE_CLIENT_SECRET ||
                process.env.GOOGLE_CLIENT_SECRET ||
                "";

            if (!googleClientId) {
                return {
                    error: "Google login is not configured for the desktop app.",
                };
            }

            try {
                const http = require("http");
                const crypto = require("crypto");
                const url = require("url");

                // Start a temporary local HTTP server to receive the OAuth callback
                const state = crypto.randomBytes(16).toString("hex");
                let callbackServer = null;

                // B2 FIX: Use a settled guard so late-arriving callbacks after timeout are ignored,
                // and ensure the server is always closed on both success and timeout.
                const result = await new Promise((resolve) => {
                    let settled = false;
                    const done = (value) => {
                        if (settled) return;
                        settled = true;
                        if (callbackServer) {
                            try {
                                callbackServer.close();
                            } catch {}
                        }
                        resolve(value);
                    };

                    callbackServer = http.createServer(async (req, res) => {
                        if (settled) {
                            res.writeHead(200);
                            res.end();
                            return;
                        }
                        try {
                            const parsed = url.parse(req.url, true);
                            if (parsed.pathname !== "/callback") {
                                res.writeHead(404);
                                res.end("Not found");
                                return;
                            }

                            // Verify state to prevent CSRF
                            if (parsed.query.state !== state) {
                                res.writeHead(400);
                                res.end("Invalid state parameter.");
                                done({
                                    error: "OAuth state mismatch. Please try again.",
                                });
                                return;
                            }

                            if (parsed.query.error) {
                                res.writeHead(200, {
                                    "Content-Type": "text/html",
                                });
                                res.end(
                                    "<html><body><h2>Sign-in cancelled.</h2><p>You can close this tab.</p></body></html>",
                                );
                                done({
                                    error:
                                        parsed.query.error_description ||
                                        "Google sign-in was cancelled.",
                                });
                                return;
                            }

                            const code = parsed.query.code;
                            if (!code) {
                                res.writeHead(400);
                                res.end("Missing authorization code.");
                                done({
                                    error: "No authorization code received from Google.",
                                });
                                return;
                            }

                            // Exchange auth code for ID token
                            const tokenRes = await require("axios").post(
                                "https://oauth2.googleapis.com/token",
                                {
                                    code,
                                    client_id: googleClientId,
                                    client_secret: googleClientSecret,
                                    redirect_uri: `http://127.0.0.1:${callbackServer.address().port}/callback`,
                                    grant_type: "authorization_code",
                                },
                            );

                            const idToken = tokenRes.data.id_token;
                            if (!idToken) {
                                res.writeHead(200, {
                                    "Content-Type": "text/html",
                                });
                                res.end(
                                    "<html><body><h2>Error</h2><p>Could not get ID token from Google.</p></body></html>",
                                );
                                done({
                                    error: "Failed to obtain ID token from Google.",
                                });
                                return;
                            }

                            res.writeHead(200, { "Content-Type": "text/html" });
                            res.end(
                                '<html><body style="font-family:system-ui;text-align:center;padding:40px"><h2>Sign-in successful!</h2><p>You can close this tab and return to TrackFlow.</p></body></html>',
                            );

                            done({ id_token: idToken });
                        } catch (err) {
                            console.error(
                                "[GoogleAuth] Callback error:",
                                err.message,
                            );
                            try {
                                res.writeHead(500);
                                res.end("Internal error");
                            } catch {}
                            done({
                                error:
                                    err.message ||
                                    "Google authentication failed.",
                            });
                        }
                    });

                    // Listen on a random available port on localhost
                    callbackServer.listen(0, "127.0.0.1", () => {
                        const port = callbackServer.address().port;
                        const redirectUri = `http://127.0.0.1:${port}/callback`;
                        const authUrl =
                            `https://accounts.google.com/o/oauth2/v2/auth?` +
                            `client_id=${encodeURIComponent(googleClientId)}` +
                            `&redirect_uri=${encodeURIComponent(redirectUri)}` +
                            `&response_type=code` +
                            `&scope=${encodeURIComponent("openid email profile")}` +
                            `&state=${state}` +
                            `&access_type=offline` +
                            `&prompt=select_account`;

                        console.log(
                            "[GoogleAuth] Opening system browser for OAuth...",
                        );
                        shell.openExternal(authUrl);
                    });

                    // Timeout after 5 minutes — B2 FIX: server is closed via done()
                    setTimeout(
                        () => {
                            done({
                                error: "Google sign-in timed out. Please try again.",
                            });
                        },
                        5 * 60 * 1000,
                    );
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
                if (timerSyncInterval) {
                    clearInterval(timerSyncInterval);
                    timerSyncInterval = null;
                }
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
        ipcMain.handle("select-organization", async (_, orgId, credentials) => {
            if (!orgId || typeof orgId !== "string") {
                return { error: "Invalid organization selection." };
            }

            try {
                const tempClient = new ApiClient(null);
                const payload = { organization_id: orgId, ...credentials };
                const result = await tempClient.selectOrganization(payload);

                await setToken(result.access_token);
                await setRefreshToken(result.refresh_token);

                // B3 FIX: Clear sync interval before re-initializing to prevent overlap
                if (timerSyncInterval) {
                    clearInterval(timerSyncInterval);
                    timerSyncInterval = null;
                }
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
    if (e.code === "ENOTFOUND" || e.code === "ERR_NETWORK")
        return "Cannot reach the server. Please check your internet connection.";
    if (e.code === "ECONNREFUSED")
        return "Server is not responding. Please try again later.";
    if (e.code === "ETIMEDOUT" || e.code === "ECONNABORTED")
        return "Connection timed out. Please try again.";
    if (e.response?.status === 409)
        return "This account is already in use on another desktop.";
    if (e.response?.status === 404)
        return "Server endpoint not found. Please update the app.";
    return e.message || "Login failed. Please try again.";
}

function checkForUpdates() {
    console.log(
        `[updater] Checking... (packaged=${app.isPackaged}, env=${process.env.NODE_ENV || "production"})`,
    );
    if (process.env.NODE_ENV === "development" || !app.isPackaged) {
        console.log("[updater] Skipped — dev mode or not packaged");
        return;
    }
    // Linux AppImage releases are not published to GitHub — skip to avoid noisy 404 errors
    if (process.platform === "linux") {
        console.log("[updater] Skipped — Linux auto-updates not yet enabled");
        return;
    }
    try {
        // For private GitHub repos, electron-updater needs a GH_TOKEN
        if (process.env.GH_TOKEN) {
            autoUpdater.requestHeaders = {
                Authorization: `token ${process.env.GH_TOKEN}`,
            };
        }

        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;
        autoUpdater.logger = null; // Suppress default electron-updater logging (we do our own)

        // Track whether an update is ready to install
        let _pendingUpdate = false;

        autoUpdater.on("update-available", (info) => {
            console.log(`[updater] Update available: v${info.version}`);
            posthog.capture(
                currentEntry?.user_id || "unknown",
                "auto_update_available",
                { new_version: info.version },
            );
        });
        autoUpdater.on("update-downloaded", (info) => {
            console.log(
                `[updater] Update downloaded: v${info.version} — will install on quit`,
            );
            _pendingUpdate = true;
            posthog.capture(
                currentEntry?.user_id || "unknown",
                "auto_update_downloaded",
                { new_version: info.version },
            );

            // Send in-app update dialog to the renderer (prominent, can't be missed)
            try {
                if (popupWindow && !popupWindow.isDestroyed()) {
                    popupWindow.webContents.send("update-ready", {
                        version: info.version,
                    });
                }
            } catch {}

            // Also show a system notification as a fallback
            try {
                const notification = new Notification({
                    title: "TrackFlow Update Ready",
                    body: `Version ${info.version} downloaded. Click to restart and update.`,
                    silent: false,
                });
                notification.on("click", () => {
                    console.log(
                        "[updater] User clicked notification — installing update now",
                    );
                    autoUpdater.quitAndInstall(false, true);
                });
                notification.show();
            } catch {}
        });
        autoUpdater.on("update-not-available", (info) => {
            console.log(
                `[updater] Already on latest version (v${info.version})`,
            );
        });
        // L11: Retry with exponential backoff on update check failure
        let _updateRetryCount = 0;
        const _updateMaxRetries = 3;
        const _updateRetryDelays = [
            2 * 60 * 1000,
            4 * 60 * 1000,
            8 * 60 * 1000,
        ]; // 2m, 4m, 8m

        autoUpdater.on("error", (err) => {
            console.warn(`[updater] Error: ${err?.message || err}`);
            posthog.captureError(null, err || new Error("auto_update_error"), {
                type: "auto_update",
            });

            // L11: Retry with backoff
            if (_updateRetryCount < _updateMaxRetries) {
                const delay = _updateRetryDelays[_updateRetryCount];
                _updateRetryCount++;
                console.log(
                    `[updater] Retrying in ${delay / 1000}s (attempt ${_updateRetryCount}/${_updateMaxRetries})`,
                );
                setTimeout(() => {
                    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
                }, delay);
            }
        });

        // When app is about to quit, force-install the update if one is pending
        // This is the belt-and-suspenders fix: autoInstallOnAppQuit should handle it,
        // but on ad-hoc signed macOS apps it silently fails. This explicit call ensures
        // the update is actually applied.
        app.on("before-quit", () => {
            if (_pendingUpdate) {
                console.log(
                    "[updater] App quitting — installing pending update",
                );
                try {
                    autoUpdater.quitAndInstall(false, true);
                } catch (e) {
                    console.error(
                        "[updater] quitAndInstall failed:",
                        e.message,
                    );
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
        const prefsPath = path.join(app.getPath("userData"), "user-prefs.json");
        let launchAtLogin = true; // default: enabled
        if (fs.existsSync(prefsPath)) {
            try {
                const prefs = JSON.parse(fs.readFileSync(prefsPath, "utf8"));
                if (prefs.launchAtLogin === false) launchAtLogin = false;
            } catch {}
        }
        app.setLoginItemSettings({ openAtLogin: launchAtLogin });
    } catch {}
}
