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
const { configureLinuxPlatform } = require("./linux-platform");

// Linux/Wayland: stay on native Wayland + PipeWire capture. Do NOT force X11 —
// deleting WAYLAND_DISPLAY blanks the entire desktop on GNOME/KDE (see linux-platform.js).
configureLinuxPlatform(app);

const crypto = require("crypto");
const { autoUpdater } = require("electron-updater");
const ApiClient = require("./api-client");
const {
    isAgentUpgradeRequiredError,
    getAgentUpgradePayload,
} = require("./agent-upgrade");
const ActivityMonitor = require("./activity-monitor");
const ScreenshotService = require("./screenshot-service");
const IdleDetector = require("./idle-detector");
const { IDLE_STATE } = require("./idle-detector");
const OfflineQueue = require("./offline-queue");
const NetworkMonitor = require("./network-monitor");
const {
    hasPendingCompletedSession,
    unsyncedCompletedSecondsForDay,
} = require("./timer-session-sync");
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
const {
    initSystemNotifications,
    showSystemNotification,
    buildTrackingStateNotification,
    shouldNotifyTrackingState,
} = require("./system-notifications");
const PowerManager = require("./power-manager");

const WEB_DASHBOARD_URL =
    process.env.TRACKFLOW_WEB_URL || "https://trackflow.codeupscale.com";

const DESKTOP_RELEASES_URL =
    "https://github.com/codeupscale/trackflow/releases/latest";

let _agentUpgradeDialogShown = false;

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
    // Offline fallback only — the real value comes from GET /agent/config
    // (Settings → Idle detection) and is re-read every ~5 min.
    idle_timeout: 10,
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
// DEFAULT CHANGED to unpinned. While this was a frameless tray popup, pinning it
// on top was the only way to keep it visible while you worked — hide-on-blur
// made an unpinned popup vanish the moment you clicked away. The main window is
// now an ordinary window that stays put on its own, so floating it above every
// other application by default is simply intrusive. Users who explicitly pinned
// it keep their choice: only the "never chose" case flips.
function loadAlwaysOnTop() {
    try {
        const p = getPrefsPath();
        if (!p || !fs.existsSync(p)) return false; // default: unpinned
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        return data.alwaysOnTop !== undefined ? !!data.alwaysOnTop : false;
    } catch {
        return false;
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
                // Clear any "permission needed" banner — permission is confirmed.
                notifyPopup("permission-status", { granted: true });
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

/**
 * Show a blocking "update required" dialog. Used when the server rejects this
 * desktop build (HTTP 426) — must NOT fall back to local-first tracking.
 */
async function showAgentUpgradeRequired(error) {
    if (_agentUpgradeDialogShown) return;
    _agentUpgradeDialogShown = true;

    const { message, minVersion } = getAgentUpgradePayload(error);
    const detailLines = [message];
    if (minVersion) {
        detailLines.push(`Minimum version required: ${minVersion}`);
    }
    detailLines.push(
        "\nDownload the latest TrackFlow desktop app to continue tracking time.",
    );

    const result = await dialog.showMessageBox({
        type: "warning",
        title: "Update Required",
        message: "This version of TrackFlow is no longer supported",
        detail: detailLines.join("\n"),
        buttons: ["Download Update", "Quit"],
        defaultId: 0,
        cancelId: 1,
    });

    if (result.response === 0) {
        shell.openExternal(DESKTOP_RELEASES_URL);
    }
}

function deleteLocalTimerSession(localId) {
    if (!localId) return;
    const db = _getLocalTimerDb();
    if (!db) return;
    try {
        db.prepare("DELETE FROM timer_sessions WHERE id = ?").run(localId);
    } catch (e) {
        console.error("[LocalTimerDb] deleteSession failed:", e.message);
    }
}

/** Roll back a local-first start when the server refuses this app version. */
function abortLocalTimerStartDueToUpgrade(localId) {
    deleteLocalTimerSession(localId);

    if (currentEntry?._localId === localId || currentEntry?.id === localId) {
        isTimerRunning = false;
        isTimerPaused = false;
        currentEntry = null;
        _cachedStartedAtMs = null;
        todayTotalCurrentProject = 0;
        _pendingOfflineReassignIdleSec = 0;
        screenshotService?.stop();
        activityMonitor?.stop();
        idleDetector?.stop();
        stopTrayTimer();
        updateTrayTitle();
        notifyPopup("timer-stopped", {});
    }
}

/**
 * Handle HTTP 426 / AGENT_UPGRADE_REQUIRED. Returns a result object for callers,
 * or null if this error is not an upgrade rejection.
 */
async function handleAgentUpgradeRequired(error, { localId = null } = {}) {
    if (!isAgentUpgradeRequiredError(error)) return null;

    console.warn("[Upgrade] Server rejected this desktop version — blocking tracking");
    if (localId) {
        abortLocalTimerStartDueToUpgrade(localId);
    }

    const payload = getAgentUpgradePayload(error);
    setImmediate(() => {
        showAgentUpgradeRequired(error).catch(() => {});
    });

    return {
        error: payload.message,
        upgradeRequired: true,
        minVersion: payload.minVersion,
    };
}

let tray = null;
let popupWindow = null;
let loginWindow = null;

// ── Main window geometry ─────────────────────────────────────────────────────
// The main window is an ordinary resizable desktop window with native minimise /
// maximise / close on all three platforms — not the old frameless, tray-anchored
// 320x480 popup. Its full rect (position + size) is persisted and restored, and
// a rect stranded off-screen by an unplugged monitor is re-centred rather than
// restored invisibly. The dimensions and resolve rules live in
// ./window-geometry (unit-tested, no Electron import).
const WindowGeometry = require("./window-geometry");
const WINDOW_WIDTH = WindowGeometry.WINDOW_WIDTH;
const WINDOW_HEIGHT = WindowGeometry.WINDOW_HEIGHT;
const WINDOW_MIN_WIDTH = WindowGeometry.WINDOW_MIN_WIDTH;
const WINDOW_MIN_HEIGHT = WindowGeometry.WINDOW_MIN_HEIGHT;

// The user's window rect persisted in user-prefs.json.
function loadWindowBounds() {
    let persisted = null;
    try {
        persisted = loadUserPrefs().windowBounds;
    } catch {}
    let displays = [];
    let primary = null;
    try {
        displays = screen.getAllDisplays();
        primary = screen.getPrimaryDisplay();
    } catch {}
    return WindowGeometry.resolveWindowBounds(persisted, displays, primary);
}

function saveWindowBounds(bounds) {
    if (!bounds) return;
    try {
        const size = WindowGeometry.clampWindowSize(
            bounds.width,
            bounds.height,
        );
        saveUserPrefsPatch({
            windowBounds: {
                x: Math.round(bounds.x),
                y: Math.round(bounds.y),
                width: size.width,
                height: size.height,
            },
        });
    } catch (e) {
        console.error("Failed to save window bounds:", e.message);
    }
}

let idleAlertWindow = null;
// ISSUE 4 FIX: On multi-monitor setups the idle alert must appear on EVERY display
// so it is never missed on the screen the user is actually looking at. `idleAlertWindow`
// is the PRIMARY, interactive window (on the display under the cursor); these are the
// mirror windows shown on the other displays. All are torn down together on resolve.
let _idleAlertExtraWindows = [];
// Bug B: snapshot of the idle state preserved across a sleep/lock while an idle
// alert is genuinely pending. Set in onSuspendCleanup, consumed (and cleared) in
// onResumeAfterSleep to re-enter ALERTING with the SAME idleStartedAt. null when
// no idle decision was in flight at suspend (normal hard-auto-stop path).
let _idleSuspendState = null;
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

// ISSUE 4 FIX: every live idle-alert window (primary + per-display mirrors).
function _getAllIdleAlertWindows() {
    const all = [];
    if (idleAlertWindow && !idleAlertWindow.isDestroyed())
        all.push(idleAlertWindow);
    for (const w of _idleAlertExtraWindows) {
        if (w && !w.isDestroyed()) all.push(w);
    }
    return all;
}

// Send an IPC message to every idle-alert window (all displays).
function _broadcastToIdleAlerts(channel, payload) {
    for (const w of _getAllIdleAlertWindows()) {
        try {
            w.webContents.send(channel, payload);
        } catch {}
    }
}

// Destroy the mirror (non-primary) idle-alert windows and clear the list.
function _destroyIdleAlertExtras() {
    for (const w of _idleAlertExtraWindows) {
        if (w && !w.isDestroyed()) {
            w._dismissedProgrammatically = true;
            try {
                w.destroy();
            } catch {}
        }
    }
    _idleAlertExtraWindows = [];
}

function pushProjectsToIdleAlert(projects) {
    if (!Array.isArray(projects) || projects.length === 0) return;
    _broadcastToIdleAlerts("idle-data", { projects });
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
// Did POST /timer/pause for the CURRENT idle cycle actually land on the server?
// False after an idle pause that failed (offline). While false the server still
// believes the entry is running, so every sync tick re-pushes the pause instead of
// adopting the server's stale "running" state (which used to resume tracking behind
// the open idle alert). See bugs/desktop-idle-alert-timer-resumes-on-reconnect.md.
let _idlePauseSynced = true;
let _idlePauseRetryInFlight = false;
// Wall-clock instant the visible elapsed is frozen at for the CURRENT idle cycle.
// Backstop for displayAnchorMs() when idleDetector.idleStartedAt is unavailable
// (detector re-armed / rebuilt) — without it the display would fall back to "now"
// and silently absorb the whole idle window into the tracked total.
let _idleFreezeAnchorMs = null;
// All-projects today total returned by POST /timer/start, handed to afterStartTimer()
// so the "Today, all projects" line stays global instead of collapsing to the started
// project's total. Null when the backend predates the field (then the existing
// todayTotalGlobal — already the correct completed sum — is simply kept).
let _startAllProjectsTotal = null;
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
    // `today_total` is PROJECT-SCOPED whenever the status call passed a project id
    // (historical API semantics) — using it here made the "Today, all projects" line
    // collapse to the selected project's total while the timer ran. Always prefer the
    // never-scoped `all_projects_today_total`, falling back for older backends.
    // Bug: bugs/desktop-today-total-project-scoped-when-project-selected.md
    const allProjectsTotal = status.all_projects_today_total ?? globalTotal;
    todayTotalGlobal = Math.max(0, allProjectsTotal - elapsed);
    const projectTotal = status.project_today_total ?? globalTotal;
    todayTotalCurrentProject = Math.max(0, projectTotal - elapsed);

    const serverPaused = status.state === "paused" || status.paused === true;
    if ((!status.running && !serverPaused) || !status.entry) return false;

    isTimerRunning = true;
    // IDLE GUARD: while an idle decision is pending, the LOCAL pause is authoritative.
    // The pause POST can fail (offline at the moment idle was detected), leaving the
    // server entry "running"; adopting that state un-paused the timer behind the still
    // open idle alert and tracking silently resumed without the user choosing anything.
    // See bugs/desktop-idle-alert-timer-resumes-on-reconnect.md.
    isTimerPaused = isIdlePauseAuthoritative() ? true : serverPaused;
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
    // IDLE GUARD: never adopt server state while an idle alert is waiting for the
    // user. Two ways this used to resurrect tracking behind the open alert:
    //   1. the idle pause POST failed (offline) → server still says "running" while
    //      local is paused → the sync tick adopted "running" and restarted capture;
    //   2. `!isTimerRunning` transient → the "server open, local stopped" branch
    //      re-opened the timer.
    // Instead: keep local state and re-push the pause so the server converges to us.
    if (isIdlePauseAuthoritative()) {
        console.log(
            "[TimerSync] Idle alert active — server timer state ignored, re-pushing idle pause",
        );
        retryIdlePauseIfUnsynced();
        return false;
    }
    const wasRunning = isTimerRunning;
    const wasPaused = isTimerPaused;
    if (!applyRunningStatusFromServer(status)) return false;

    if (isTimerPaused) {
        activityMonitor?.stop();
        screenshotService?.stop();
        if (!isIdleAlertActive()) idleDetector?.stop();
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
    if (isIdleAlertActive()) return true;
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

/**
 * True while an idle decision is pending AND the local "paused" state must win over
 * whatever the server reports. The server can legitimately still say "running" here
 * because the pause POST is best-effort (it fails when idle is detected offline), so
 * adopting the server view would silently resume tracking behind the open alert.
 */
function isIdlePauseAuthoritative() {
    return _isHandlingIdleAction || isIdleAlertActive();
}

/**
 * Re-push the idle pause when the original POST /timer/pause never landed (offline at
 * idle-detection time). Back-dated to idleStartedAt so the server freezes elapsed at
 * the true idle start, not at reconnect time. Fire-and-forget; safe to call on every
 * sync tick — it self-gates on the unsynced flag and a single in-flight attempt.
 */
function retryIdlePauseIfUnsynced() {
    if (_idlePauseSynced || _idlePauseRetryInFlight) return;
    if (!isTimerPaused || !isIdleAlertActive()) return;
    if (!apiClient || !currentEntry?.id) return;
    if (String(currentEntry.id).startsWith("local-")) return; // start not synced yet
    if (networkMonitor && !networkMonitor.isOnline) return;

    const idleStartedAt = idleDetector?.idleStartedAt;
    const pausedAt = idleStartedAt
        ? new Date(idleStartedAt).toISOString()
        : new Date().toISOString();
    _idlePauseRetryInFlight = true;
    apiClient
        .pauseTimer({ pausedAt, reason: "idle" })
        .then(() => {
            _idlePauseSynced = true;
            console.log("[Timer] Idle pause re-synced to server");
        })
        .catch((e) => {
            console.warn("[Timer] Idle pause retry failed:", e.message);
        })
        .finally(() => {
            _idlePauseRetryInFlight = false;
        });
}

async function pauseTimerForIdle(idleStartedAtIso) {
    if (!isTimerRunning || isTimerPaused) return;
    isTimerPaused = true;
    _idlePauseSynced = false;
    // Capture the freeze anchor BEFORE any await — displayAnchorMs() (tray tick,
    // get-timer-state, renderIdleFreeze) reads it the moment isTimerPaused flips.
    _idleFreezeAnchorMs = idleStartedAtIso
        ? new Date(idleStartedAtIso).getTime()
        : Date.now();
    if (!Number.isFinite(_idleFreezeAnchorMs)) _idleFreezeAnchorMs = Date.now();
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
            _idlePauseSynced = true;
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
    const pauseAnchorMs = _idleFreezeAnchorMs;
    notifyPopup("timer-paused", {
        entry: currentEntry,
        todayTotal: todayTotalCurrentProject,
        elapsed: _cachedStartedAtMs
            ? Math.max(
                  0,
                  Math.floor((pauseAnchorMs - _cachedStartedAtMs) / 1000),
              )
            : 0,
    });
}

async function resumeTimerAfterIdle() {
    if (!isTimerRunning) return;
    isTimerPaused = false;
    _idlePauseSynced = true; // no pending pause to re-push once the user resumed
    _idleFreezeAnchorMs = null; // idle cycle resolved — display follows the clock again
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
        // OWNERSHIP: sessions are tagged with the user that recorded them so a sign-out
        // no longer has to WIPE the table to stay safe for the next account. Added by
        // migration because the table predates it; legacy rows keep user_id NULL and
        // stay visible to whoever is signed in (they can only have come from this
        // install's own pre-upgrade session).
        try {
            _localTimerDb.exec(
                "ALTER TABLE timer_sessions ADD COLUMN user_id TEXT",
            );
        } catch {
            // Column already exists — expected on every launch after the first.
        }
        return _localTimerDb;
    } catch (e) {
        console.error("[LocalTimerDb] Init failed:", e.message);
        return null;
    }
}

/**
 * Id of the signed-in user, used to tag and scope local timer sessions. Set right
 * after the token is validated (getMe) and cleared on logout.
 */
let _sessionUserId = null;

/** SQL fragment + params scoping a timer_sessions query to the signed-in user. */
function _ownRowsClause(prefix = "AND") {
    if (!_sessionUserId) return { sql: "", params: [] };
    return {
        sql: ` ${prefix} (user_id IS NULL OR user_id = ?)`,
        params: [_sessionUserId],
    };
}

function generateIdempotencyKey() {
    return crypto.randomUUID();
}

function saveLocalTimerStart(id, idempotencyKey, projectId, startedAt) {
    const db = _getLocalTimerDb();
    if (!db) return;
    try {
        db.prepare(
            "INSERT OR REPLACE INTO timer_sessions (id, idempotency_key, project_id, started_at, user_id) VALUES (?, ?, ?, ?, ?)",
        ).run(id, idempotencyKey, projectId, startedAt, _sessionUserId);
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
        const own = _ownRowsClause();
        return db
            .prepare(
                "SELECT * FROM timer_sessions WHERE (synced_start = 0 OR (ended_at IS NOT NULL AND synced_stop = 0))" +
                    own.sql +
                    " ORDER BY created_at ASC",
            )
            .all(...own.params);
    } catch (e) {
        console.error("[LocalTimerDb] getUnsynced failed:", e.message);
        return [];
    }
}

/**
 * True when a session that was created AND stopped locally still needs syncing —
 * either the start never reached the server (synced_start = 0) or the start synced
 * but the stop didn't (synced_stop = 0). Drives the periodic retry-until-synced loop
 * so a fully-offline start+stop is flushed even when no NetworkMonitor 'online'
 * transition fires (net.isOnline() stays true, or the offline window is sub-poll).
 */
function hasPendingCompletedOfflineSessions() {
    const db = _getLocalTimerDb();
    if (!db) return false;
    try {
        const own = _ownRowsClause();
        const rows = db
            .prepare(
                "SELECT synced_start, synced_stop, ended_at FROM timer_sessions WHERE ended_at IS NOT NULL AND (synced_start = 0 OR synced_stop = 0)" +
                    own.sql +
                    " LIMIT 1",
            )
            .all(...own.params);
        return hasPendingCompletedSession(rows);
    } catch (e) {
        console.warn(
            "[LocalTimerDb] hasPendingCompletedOfflineSessions failed:",
            e.message,
        );
        return false;
    }
}

/**
 * Seconds from completed offline sessions the SERVER has no knowledge of yet
 * (synced_start = 0), started today (local day). The server's today_total excludes
 * these, so they are added to the displayed total to keep the offline time visible
 * until the retry loop syncs it — instead of the total visibly "resetting" to the
 * server value the moment the app reconnects. Only synced_start = 0 rows are counted:
 * once the start is on the server the entry is part of the server total (double-count
 * guard), and stop-only-pending rows are already reflected server-side as open time.
 */
function getUnsyncedCompletedSecondsForToday() {
    const db = _getLocalTimerDb();
    if (!db) return 0;
    try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const own = _ownRowsClause();
        const rows = db
            .prepare(
                "SELECT started_at, duration_seconds, synced_start, ended_at FROM timer_sessions WHERE ended_at IS NOT NULL AND synced_start = 0" +
                    own.sql,
            )
            .all(...own.params);
        return unsyncedCompletedSecondsForDay(rows, startOfDay.getTime());
    } catch (e) {
        console.warn(
            "[LocalTimerDb] getUnsyncedCompletedSecondsForToday failed:",
            e.message,
        );
        return 0;
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
        const own = _ownRowsClause();
        const row =
            db
                .prepare(
                    "SELECT * FROM timer_sessions WHERE ended_at IS NULL" +
                        own.sql +
                        " ORDER BY created_at DESC LIMIT 1",
                )
                .get(...own.params) || null;
        if (row && row.started_at) {
            const ageMs = Date.now() - new Date(row.started_at).getTime();
            if (
                !Number.isFinite(ageMs) ||
                ageMs > MAX_PLAUSIBLE_OPEN_SESSION_MS
            ) {
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
 * Clear local timer sessions at logout WITHOUT throwing away tracked time.
 *
 * The old behaviour was `DELETE FROM timer_sessions` — needed because the table had
 * no owner and a stale OPEN row was restored on the next login as a phantom
 * "Tracking HH:MM:SS" timer. But it also deleted rows whose start/stop had never
 * reached the server, so signing out while offline silently DESTROYED that tracked
 * time: nothing was left for reconcile to push on the next launch.
 *
 * Now that rows carry `user_id`, keep exactly what still has to be uploaded — the
 * signed-in user's CLOSED but unsynced sessions — and delete everything else
 * (open rows, fully-synced rows, and any other account's rows). Kept rows are
 * invisible to another account (every read is scoped by `_ownRowsClause()`), and
 * they cannot resurrect a live timer because they are closed. `reconcileTimerState()`
 * pushes them the next time this user signs in.
 */
function clearLocalTimerSessions() {
    const db = _getLocalTimerDb();
    if (!db) return;
    try {
        if (_sessionUserId) {
            const kept = db
                .prepare(
                    "DELETE FROM timer_sessions WHERE NOT (user_id = ? AND ended_at IS NOT NULL AND (synced_start = 0 OR synced_stop = 0))",
                )
                .run(_sessionUserId);
            const pending = db
                .prepare("SELECT COUNT(*) AS n FROM timer_sessions")
                .get();
            if (pending?.n > 0) {
                console.warn(
                    `[LocalTimerDb] Kept ${pending.n} unsynced session(s) for upload on next sign-in (deleted ${kept.changes} others)`,
                );
            }
        } else {
            // No known user (pre-migration rows / forced logout before getMe) — fall
            // back to the original wipe rather than leaving unattributable rows.
            db.prepare("DELETE FROM timer_sessions").run();
        }
    } catch (e) {
        console.error(
            "[LocalTimerDb] clearLocalTimerSessions failed:",
            e.message,
        );
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
    const idemKey =
        meta && meta.idempotency_key ? String(meta.idempotency_key) : null;
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
        if (
            row &&
            row.server_entry_id &&
            !String(row.server_entry_id).startsWith("local-")
        ) {
            return String(row.server_entry_id);
        }
    } catch (e) {
        console.warn(
            "[LocalTimerDb] resolveServerEntryIdForQueue failed:",
            e.message,
        );
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
    initSystemNotifications();
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

// Clicking the Dock (macOS) or taskbar (Windows/Linux) icon must bring the
// window back. The window is a real, taskbar-visible application window now and
// its close button HIDES rather than destroys, so without this the icon stays in
// the Dock with no way to reopen from it — the user would have to go find the
// tray. `showPopup()` also handles the not-yet-authenticated case (login window)
// and un-minimises.
app.on("activate", () => {
    if (!app.isReady()) return;
    showPopup();
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
                "[Quit] Force-exit fallback fired (cleanup exceeded 6s)",
            );
            app.exit(0);
        }, 6000);
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
        // UPLOAD ON QUIT: the direct stop above only lands when the server already
        // knows the entry. A session that STARTED offline has no server entry to stop,
        // so push start+stop (and any queued heartbeats/screenshots) before we exit —
        // otherwise that time sits locally until the app is next launched. Bounded so
        // Quit still exits promptly; anything left over is synced by reconcile on the
        // next launch (unchanged local-first guarantee).
        if (apiClient && networkMonitor?.isOnline !== false) {
            await withTimeout(
                (async () => {
                    try {
                        await reconcileTimerState();
                    } catch {}
                    try {
                        await offlineQueue?.flush(apiClient);
                    } catch {}
                })(),
                2500,
                "[Quit] Sync budget exceeded — remaining data syncs on next launch",
            );
        }
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
    stopIdleWatchdog();
    app.removeAllListeners("browser-window-focus");
    // Reset tracking-state notification dedup so the NEXT login always re-notifies
    // (and no post-logout resume can suppress a fresh state notif).
    _lastStateNotifAt = 0;
    _lastNotifiedTracking = null;
    _lastAutoStopNotifAt = 0;
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
    // Cleared AFTER clearLocalTimerSessions() above so this user's unsynced sessions
    // are correctly attributed and kept — the token is dead, so they can only be
    // uploaded when the same user signs in again.
    _sessionUserId = null;

    _stopUnpinnedFocusWatch();
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

    console.log(
        `[Uninstall] Watching install path for removal: ${watchTarget}`,
    );
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
    // Install the application menu before any window exists, so Electron's stock
    // default menu never gets a chance to render into a framed window.
    buildAppMenu();

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
            // Tag local timer sessions with their owner so a sign-out can keep this
            // user's unsynced time instead of wiping the table (see
            // clearLocalTimerSessions).
            _sessionUserId = user?.id ? String(user.id) : null;
            break;
        } catch (e) {
            if (isAgentUpgradeRequiredError(e)) {
                await deleteToken();
                isAuthenticated = false;
                createTray();
                createLoginWindow();
                setImmediate(() => {
                    showAgentUpgradeRequired(e).catch(() => {});
                });
                return;
            }
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
                  time_entry_id:
                      currentEntry._localId || currentEntry.id || null,
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
        // A successful capture is definitive proof that Screen Recording permission
        // is granted — clear the "permission needed" banner. macOS's
        // getMediaAccessStatus() is unreliable for ad-hoc-signed builds and the
        // banner otherwise stays up forever once shown (it was only hidden by the
        // one-shot checkPermission() on load), even after the user grants permission.
        _screenPermissionGranted = true;
        notifyPopup("permission-status", { granted: true });
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
        // An idle pause raised while offline never reached the server — push it FIRST,
        // before anything reads server state, so the entry is frozen at idleStartedAt
        // and no reconnect path can mistake "server says running" for "resume".
        retryIdlePauseIfUnsynced();
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
        // Raise the pause FIRST: it flips isTimerPaused and stamps the freeze anchor
        // synchronously (its `await` only covers the best-effort server POST), so the
        // repaint below — and every later tray/popup repaint — measures elapsed to the
        // idle-start instant instead of the wall clock. Tray shows the TRACKED TIME
        // frozen at the moment idle began (e.g. "⏸ 02:26:40"), NOT "Idle (5m)"; the
        // popup gets the same value so the two never disagree. The idle interval is not
        // counted yet (pending keep/discard/reassign) — resumeTimerAfterIdle() clears
        // the freeze and startTrayTimer() re-arms the live count.
        pauseTimerForIdle(
            idleStartedAt
                ? new Date(idleStartedAt).toISOString()
                : new Date().toISOString(),
        ).catch(() => {});
        renderIdleFreeze();
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
        // This IS the state message for an idle auto-stop — suppress the generic
        // "not tracking" notif a subsequent resume/unlock would otherwise fire.
        markAutoStopNotified();
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
                        // Auto-resumed a valid session — confirm tracking is active.
                        notifyTrackingState("startup-auto-resume");
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

    // ── Sleep / Wake / Lock — pause capture; timer keeps running ─────────────
    PowerManager.registerPowerHandlers({
        isTimerRunning: () => isTimerRunning,
        autoStopForPowerEvent: autoStopTimerForPowerEvent,
        // Hard auto-stop on sleep is opt-in only (legacy/tests). Normal lid-close /
        // lock keeps the timer running so elapsed time spans the sleep gap.
        shouldAutoStopOnSuspend: () => false,
        // On suspend/lock: preserve idle alert across sleep, or pause capture while
        // the timer keeps running. Tear down idle detector only when timer is off.
        onSuspendCleanup: () => {
            if (isIdleAlertActive()) {
                // Capture the snapshot exactly once — a lid-close fires paired
                // lock-screen + suspend events; the second call finds the detector
                // already SUSPENDED (isIdle=false) and must NOT clobber the snapshot.
                if (!_idleSuspendState) {
                    const snap = idleDetector?.suspend?.();
                    _idleSuspendState = {
                        isIdle: true,
                        idleStartedAt:
                            (snap && snap.idleStartedAt) ||
                            idleDetector?.idleStartedAt ||
                            null,
                    };
                }
                hideIdleAlertWindows();
            } else if (isTimerRunning) {
                touchLastActiveAt(new Date().toISOString());
                screenshotService?.stop();
                activityMonitor?.stop();
                stopTrayTimer();
            } else {
                idleDetector?.stop();
                dismissIdleAlert();
            }
        },
        onResumeAfterSleep: async ({ sleepSec, suspendedAtMs } = {}) => {
            // Bug B: re-surface a preserved idle alert with the SAME idleStartedAt so
            // getIdleDuration() spans the sleep gap and the user decides on the full
            // away duration. isTimerPaused stays true throughout (never un-paused
            // here), so the reconcile resume self-heal remains suppressed during the
            // idle decision.
            const preserved = _idleSuspendState;
            _idleSuspendState = null;
            if (preserved && preserved.isIdle && preserved.idleStartedAt) {
                if (isTimerRunning) {
                    try {
                        idleDetector?.resume();
                        const newActionId =
                            idleDetector?.setAlertState(
                                preserved.idleStartedAt,
                            ) ?? idleDetector?.getActionId();
                        const idleSeconds = Math.max(
                            0,
                            Math.floor(
                                (Date.now() - preserved.idleStartedAt) / 1000,
                            ),
                        );
                        _idleAlertShownAt = Date.now();
                        reshowIdleAlertAfterResume(
                            idleSeconds,
                            preserved.idleStartedAt,
                            newActionId,
                        );
                    } catch (e) {
                        console.error(
                            "[power] idle resume re-show failed:",
                            e.message,
                        );
                    }
                } else {
                    // Timer no longer running (edge) — do not leave orphan windows.
                    idleDetector?.stop();
                    dismissIdleAlert();
                }
            } else if (isTimerRunning && !isIdleAlertActive()) {
                // Long-sleep backstop. Must run BEFORE capture restarts: if the
                // gap exceeded the idle threshold the entry is closed at the last
                // real activity, so there is nothing left to capture for.
                const stopped = await autoStopAfterSleepGap(
                    sleepSec,
                    suspendedAtMs,
                );
                if (!stopped) {
                    activityMonitor?.start();
                    if (currentEntry) {
                        screenshotService?.start(currentEntry.id, {
                            immediateCapture:
                                config.screenshot_capture_immediate_after_idle ===
                                true,
                        });
                    }
                    startTrayTimer();
                    updateTrayIcon(true);
                    updateTrayTitle();
                }
            }
            // Reconcile runs only after any gap-stop above has fully settled —
            // otherwise it would see a still-running local session and push the
            // stale started_at back to the server, resurrecting the phantom.
            if (networkMonitor?.isOnline && offlineQueue && apiClient) {
                setImmediate(() => {
                    reconcileTimerState()
                        .then(() => offlineQueue.flush(apiClient))
                        .catch(() => {});
                });
            }
            // Tell the user their CURRENT state on wake/unlock. Self-suppresses if
            // the sleep-gap/watchdog just auto-stopped (markAutoStopNotified ran
            // above) or if an idle alert is being re-shown — one message, no
            // contradiction. The debounce coalesces the paired resume+unlock.
            notifyTrackingState("wake");
        },
    });

    // ── Idle hard-stop watchdog (clamshell / never-sleeps backstop) ──────────
    // Always-on interval that self-gates on isTimerRunning. Independent of the
    // idle-detection feature toggle and the idle detector's state, so it stops a
    // 12h phantom even when idle detection is off or the alert never showed.
    // Torn down in removeSessionListeners() (both logout paths).
    startIdleWatchdog();

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
                    if (shouldPreserveLocalRunningWhenServerStopped()) {
                        console.log(
                            "[ImmediateSync] Server says stopped but local idle/paused/unsynced state preserved — keeping local state",
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

    // Transition #3: login / startup. Tell the user their current tracking state
    // once the session is established and any server-open timer has been adopted
    // above (isTimerRunning is authoritative here). A local restart-state
    // auto-resume that starts a timer ~2s later fires its own state notif (the
    // state genuinely changes, so the debounce lets it through).
    notifyTrackingState("startup");
}

/**
 * Install the application menu.
 *
 * Previously no menu was ever set, so Electron installed its stock default. That
 * was invisible while the window was frameless, but a real window would render
 * that default menu bar (File/Edit/View/Window/Help, complete with Reload and
 * Toggle DevTools) INSIDE the frame on Windows/Linux — clutter on a compact
 * tracker, and it hands end users a reload button.
 *
 *   - Windows/Linux: no menu at all. Chromium still handles clipboard and
 *     undo/redo inside text inputs natively, so the login form is unaffected.
 *   - macOS: a menu is NOT optional — without one, Cmd+C/V/A, Cmd+W, Cmd+M and
 *     Cmd+Q all stop working, because on macOS those live in the menu bar rather
 *     than in the window. This builds the minimum standard set.
 *
 * Cmd+W maps to the window's close, which HIDES to tray (see the 'close' handler
 * in createPopupWindow) — so it tucks the window away without stopping a timer,
 * exactly like the red button.
 */
function buildAppMenu() {
    if (process.platform !== "darwin") {
        Menu.setApplicationMenu(null);
        return;
    }

    Menu.setApplicationMenu(
        Menu.buildFromTemplate([
            {
                label: app.name,
                submenu: [
                    { role: "about" },
                    { type: "separator" },
                    { role: "hide" },
                    { role: "hideOthers" },
                    { role: "unhide" },
                    { type: "separator" },
                    // 'quit' runs before-quit → graceful timer stop + queue flush.
                    { role: "quit" },
                ],
            },
            {
                label: "Edit",
                submenu: [
                    { role: "undo" },
                    { role: "redo" },
                    { type: "separator" },
                    { role: "cut" },
                    { role: "copy" },
                    { role: "paste" },
                    { role: "selectAll" },
                ],
            },
            {
                label: "Window",
                submenu: [
                    { role: "minimize" },
                    // Hides to tray rather than destroying — the timer keeps running.
                    { role: "close", label: "Close Window" },
                    { type: "separator" },
                    {
                        label: "Show TrackFlow",
                        accelerator: "CmdOrCtrl+Shift+T",
                        click: () => showPopup(),
                    },
                ],
            },
        ]),
    );
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
    // Same lock as the popup: while an idle alert waits for an answer, the tray must
    // not offer a competing way to start/stop the timer.
    if (isIdleAlertActive()) {
        template.push({
            label: "Waiting for idle response…",
            enabled: false,
        });
    } else if (isTimerRunning) {
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
                    // ISSUE 8: keep the focus-loss watch in sync with the pin state.
                    if (isAlwaysOnTop) {
                        _stopUnpinnedFocusWatch();
                    } else if (popupWindow.isVisible()) {
                        _startUnpinnedFocusWatch();
                    }
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

// ── ISSUE 8 (RETIRED): focus-loss watch that hid an unpinned popup on a click-away ──
// This polled focus on macOS and hid the window after ~600ms of sustained
// unfocus, so that clicking the desktop/wallpaper dismissed the tray popup the
// same way clicking another app did.
//
// The main window is no longer a tray popup — it is an ordinary application
// window with native minimise/maximise/close — so auto-hiding it when the user
// clicks elsewhere is exactly the wrong behaviour: no desktop app disappears
// because you looked at your browser. The watchdog is retired rather than
// deleted so the several call sites (tray pin toggle, logout teardown) keep
// working and any timer left over from an older session is still cleared.
let _unpinnedFocusWatch = null;
let _unpinnedUnfocusedTicks = 0;

function _stopUnpinnedFocusWatch() {
    if (_unpinnedFocusWatch) {
        clearInterval(_unpinnedFocusWatch);
        _unpinnedFocusWatch = null;
    }
    _unpinnedUnfocusedTicks = 0;
}

function _startUnpinnedFocusWatch() {
    // Intentionally a no-op: never auto-hide the main window on focus loss.
    _stopUnpinnedFocusWatch();
}

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

function showPopup() {
    if (!isAuthenticated) {
        createLoginWindow();
        return;
    }

    if (popupWindow && !popupWindow.isDestroyed()) {
        // Show the window where the user left it. It is NOT re-anchored to the
        // tray or forced back onto the primary display any more — dragging it to
        // a second monitor and having it jump home on the next show was popup
        // behaviour, not window behaviour. The only correction applied is the
        // off-screen rescue (a monitor unplugged while the window was hidden),
        // which restores the saved size centred on the primary display.
        try {
            const b = popupWindow.getBounds();
            if (
                !WindowGeometry.isVisibleOnAnyDisplay(b, screen.getAllDisplays())
            ) {
                popupWindow.setBounds(
                    WindowGeometry.centerOnDisplay(
                        screen.getPrimaryDisplay(),
                        b.width,
                        b.height,
                    ),
                    false,
                );
            }
        } catch {}
        // A window minimised to the Dock/taskbar must come back, not just focus.
        if (popupWindow.isMinimized()) popupWindow.restore();
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

    // Restore the window where the user last left it (size AND position). A rect
    // stranded off-screen by an unplugged monitor is re-centred on the primary
    // display instead of restored invisibly — see window-geometry.js.
    const initialBounds = loadWindowBounds();
    const windowWidth = initialBounds.width;
    const windowHeight = initialBounds.height;

    const popupOptions = {
        width: windowWidth,
        height: windowHeight,
        x: initialBounds.x,
        y: initialBounds.y,
        minWidth: WINDOW_MIN_WIDTH,
        minHeight: WINDOW_MIN_HEIGHT,
        // A real app window: resizable and maximisable everywhere, present in
        // the Dock / taskbar so it can be reached without the tray.
        resizable: true,
        maximizable: true,
        minimizable: true,
        skipTaskbar: false,
        show: false,
        title: "TrackFlow",
        backgroundColor: "#121110", // matches --bg-primary; no white flash
        webPreferences: {
            preload: path.join(__dirname, "..", "preload", "index.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            devTools: true,
        },
    };

    // Native window controls, styled per platform — see resolveWindowChrome().
    Object.assign(
        popupOptions,
        WindowGeometry.resolveWindowChrome(process.platform, {
            background: "#121110",
            symbol: "#a8a29e",
        }),
    );

    popupWindow = new BrowserWindow(popupOptions);

    // Apply always-on-top AFTER window creation (not in constructor options).
    // On macOS, use 'floating' level + relativeLevel 1 for reliable z-order.
    _applyAlwaysOnTop(popupWindow, isAlwaysOnTop);

    // Persist the window rect (position AND size) so it survives hide/show and
    // app restarts. Debounced so a resize/move drag — which fires a burst of
    // events — writes once when it settles. A maximised window is deliberately
    // NOT recorded: we want to restore the underlying restored-size rect, not a
    // full-screen-sized one that would un-maximise to fill the display.
    let _boundsSaveTimer = null;
    const _persistBounds = () => {
        if (_boundsSaveTimer) clearTimeout(_boundsSaveTimer);
        _boundsSaveTimer = setTimeout(() => {
            _boundsSaveTimer = null;
            if (!popupWindow || popupWindow.isDestroyed()) return;
            if (popupWindow.isMaximized() || popupWindow.isMinimized()) return;
            saveWindowBounds(popupWindow.getBounds());
        }, 400);
    };
    popupWindow.on("resize", _persistBounds);
    popupWindow.on("move", _persistBounds);

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

    // NO hide-on-blur. This is an ordinary window now: clicking into another app
    // must leave it exactly where it is, the same as any other desktop app. The
    // old debounced blur->hide (plus the macOS unfocused-ticks watchdog that
    // backed it up) was the single biggest reason the window felt like a
    // fly-away popup rather than an application.

    // Close (native red/X button) HIDES the window instead of destroying it, so
    // a running timer is never silently killed by tidying up your desktop. The
    // app keeps running in the tray; quitting is deliberate — tray > Quit, or
    // Cmd/Ctrl+Q — and that path already stops the timer and flushes the offline
    // queue in `before-quit`.
    popupWindow.on("close", (e) => {
        if (isQuitting) return; // real quit: let it through and tear down
        e.preventDefault();
        // Persist the final rect before hiding — the debounced move/resize saver
        // may still have a pending write when the user closes right after a drag.
        try {
            if (!popupWindow.isMaximized() && !popupWindow.isMinimized()) {
                saveWindowBounds(popupWindow.getBounds());
            }
        } catch {}
        popupWindow.hide();
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

/**
 * How long sign-out may spend pushing tracked time to the server before giving up.
 * Long enough for a reconcile + a modest queue flush, short enough that a dead
 * network never makes "Sign out" feel broken. Anything not sent stays in SQLite.
 */
const LOGOUT_SYNC_BUDGET_MS = 6000;

/** Await `promise`, but never longer than `ms`. Never rejects. */
function withTimeout(promise, ms, timeoutLog = null) {
    let timer = null;
    return Promise.race([
        Promise.resolve(promise).catch(() => {}),
        new Promise((resolve) => {
            timer = setTimeout(() => {
                if (timeoutLog) console.warn(timeoutLog);
                resolve();
            }, ms);
        }),
    ]).finally(() => {
        if (timer) clearTimeout(timer);
    });
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

    // UPLOAD BEFORE TEARDOWN: the stop above is recorded locally first, so at this
    // point the server may still be missing this session's start/stop (offline start,
    // failed stop) and the offline queue may still hold heartbeats/screenshots. Push
    // both NOW — after this function the apiClient is nulled and the queue closed, so
    // nothing else can send them until the next sign-in. Bounded so a slow or
    // unreachable server can never wedge sign-out; whatever doesn't make it stays in
    // SQLite and is pushed by reconcile the next time this user signs in.
    if (apiClient && networkMonitor?.isOnline !== false) {
        console.log("[Logout] Flushing tracked time before sign-out");
        await withTimeout(
            (async () => {
                try {
                    await reconcileTimerState();
                } catch (e) {
                    console.warn("[Logout] reconcile failed:", e.message);
                }
                try {
                    await offlineQueue?.flush(apiClient);
                } catch (e) {
                    console.warn("[Logout] queue flush failed:", e.message);
                }
            })(),
            LOGOUT_SYNC_BUDGET_MS,
            "[Logout] sync budget exceeded — remaining data stays queued locally",
        );
    }

    // Prune local timer_sessions so the NEXT account can't inherit this one's rows
    // (anything still unsynced for THIS user is deliberately kept — see the function).
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
    _sessionUserId = null;

    _stopUnpinnedFocusWatch();
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
    const windows = [popupWindow, loginWindow, ..._getAllIdleAlertWindows()];
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
        // Backs the Escape shortcut. The pin no longer blocks hiding: pinning
        // means "float above other apps", not "refuse to close" — that coupling
        // only existed because the pinned popup had no other dismiss affordance.
        // The window now has a native close button, so blocking this IPC while
        // pinned would just make Escape silently do nothing.
        if (popupWindow && !popupWindow.isDestroyed()) {
            popupWindow.hide();
        }
    });

    // Cmd/Ctrl+Q must QUIT, the way it does in every other desktop app. It used
    // to be wired to sign-out in the renderer, which was survivable while this
    // was a transient tray popup and is not now that it is a normal window with
    // a Dock/taskbar entry. app.quit() runs the `before-quit` handler, which
    // stops the timer and flushes the offline queue before exiting.
    ipcMain.handle("quit-app", () => {
        app.quit();
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
            // ISSUE 8: unpinning should make the popup close on click-away again;
            // pinning should stop the focus-loss watch so it stays put.
            if (isAlwaysOnTop) {
                _stopUnpinnedFocusWatch();
            } else if (popupWindow.isVisible()) {
                _startUnpinnedFocusWatch();
            }
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
                // `today_total` is scoped to `validProjectId` when a project is selected
                // (historical API semantics). `all_projects_today_total` is ALWAYS the global
                // sum — use it for the "Today, all projects" line + tray so a selected project
                // never scopes those. Falls back to today_total for older backends.
                // Bug: bugs/desktop-today-total-project-scoped-when-project-selected.md
                const globalTotal = status.today_total ?? 0;
                const allProjectsTotal =
                    status.all_projects_today_total ?? globalTotal;

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
                        todayTotalGlobal = allProjectsTotal;
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
                        todayTotalGlobal = allProjectsTotal;
                    }
                } else {
                    todayTotalGlobal = allProjectsTotal;
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
            elapsedForState = Math.max(
                0,
                Math.floor((displayAnchorMs() - _cachedStartedAtMs) / 1000),
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
            // True while an idle alert is waiting for an answer — the popup renders
            // itself locked so a re-opened window can never come back unlocked.
            idleLocked: isIdleAlertActive(),
        };
    });

    // Timer controls are LOCKED while an idle alert is pending. The renderer already
    // disables the buttons; this is the authoritative guard (tray, keyboard, an
    // out-of-date renderer) so the timer can only ever be driven from the idle window
    // until the user answers it.
    ipcMain.handle("start-timer", async (_, projectId) => {
        if (isIdleAlertActive()) {
            return {
                error: "Respond to the idle prompt first (Continue Tracking or Stop Timer).",
            };
        }
        const validProjectId = validateProjectId(projectId);
        return await startTimer(validProjectId);
    });

    ipcMain.handle("stop-timer", () => {
        if (isIdleAlertActive()) {
            return {
                error: "Respond to the idle prompt first (Continue Tracking or Stop Timer).",
            };
        }
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
        // NOTE: do NOT assign `todayTotalGlobal = todayTotalForPopup` here.
        // `todayTotalForPopup` is the PROJECT-scoped today total from the start
        // response, so this overwrote the "Today, all projects" line with the
        // just-started project's total (0 for a project with no time today) until the
        // 10s sync tick repaired it — the "total starts from zero for ~10s" bug.
        // Starting a timer cannot change the completed all-projects sum, so the
        // existing value already IS correct; refresh it only from an authoritative
        // all-projects number when the backend provides one.
        // Bug: bugs/desktop-all-projects-total-resets-on-start.md
        if (_startAllProjectsTotal != null) {
            const elapsed = _cachedStartedAtMs
                ? Math.max(
                      0,
                      Math.floor((Date.now() - _cachedStartedAtMs) / 1000),
                  )
                : 0;
            // The server figure includes the freshly-started entry's elapsed; the
            // desktop keeps `todayTotalGlobal` as the COMPLETED base and adds live
            // elapsed on each tick, so subtract it back out here.
            todayTotalGlobal = Math.max(0, _startAllProjectsTotal - elapsed);
            _startAllProjectsTotal = null;
        }
        updateTrayTitle();
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
        // Keep the "Today, all projects" line global across a project switch — the
        // response's `today_total` is scoped to the NEW project.
        if (result.all_projects_today_total != null) {
            todayTotalGlobal = Math.max(0, result.all_projects_today_total);
        }

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
        const upgradeResult = await handleAgentUpgradeRequired(e);
        if (upgradeResult) return upgradeResult;

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
            _startAllProjectsTotal = result.all_projects_today_total ?? null;
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

            const upgradeResult = await handleAgentUpgradeRequired(e, {
                localId,
            });
            if (upgradeResult) {
                return upgradeResult;
            }

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
                    _startAllProjectsTotal =
                        retryResult.all_projects_today_total ?? null;
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
                    const upgradeResult = await handleAgentUpgradeRequired(
                        retryErr,
                        { localId },
                    );
                    if (upgradeResult) {
                        return upgradeResult;
                    }
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

// ── "Always know your tracking state" notifications ──────────────────────────
// Fires a single system notification of the CURRENT tracking state on the four
// transitions where the user might otherwise be surprised: wake (resume), unlock,
// login / startup auto-resume, and (via the auto-stop toast) any automatic stop.
//
// Dedup model:
//   - _lastNotifiedTracking + _lastStateNotifAt coalesce the PAIRED power events a
//     single lid-open emits (resume + unlock, a tick apart): the second call sees
//     the SAME tracking state within the debounce window and is dropped. A genuine
//     state change (not-tracking → tracking) is always allowed through.
//   - _lastAutoStopNotifAt: whenever an automatic-stop toast fires (sleep-gap,
//     idle-watchdog, idle hard-stop, startup/stale gap) we stamp this; the generic
//     state notif then suppresses itself briefly so a resume that just auto-STOPPED
//     shows only the specific "…because no activity was detected" toast, never a
//     contradictory second message.
const STATE_NOTIF_DEBOUNCE_MS = 5000; // coalesce paired resume+unlock
const AUTOSTOP_NOTIF_SUPPRESS_MS = 8000; // let the specific auto-stop toast win
let _lastStateNotifAt = 0;
let _lastNotifiedTracking = null;
let _lastAutoStopNotifAt = 0;

/** Live all-projects today total (server total + current running session). */
function liveTodayTotalSeconds() {
    const base = todayTotalGlobal || 0;
    if (isTimerRunning && _cachedStartedAtMs) {
        return (
            base +
            Math.max(
                0,
                Math.floor((Date.now() - _cachedStartedAtMs) / 1000) -
                    _pendingOfflineReassignIdleSec,
            )
        );
    }
    return base;
}

/**
 * Show ONE notification reflecting the current tracking state. Guarded so it never
 * fires after logout, never double-fires on paired power events, and never
 * contradicts a just-shown automatic-stop toast or a live idle alert.
 *
 * @param {string} reason - transition tag for logs (resume/unlock/login/startup)
 */
function notifyTrackingState(reason) {
    try {
        const now = Date.now();
        const isTracking = !!isTimerRunning;

        // All dedup/coalescing/suppression guards live in the pure decision fn.
        if (
            !shouldNotifyTrackingState({
                isAuthenticated,
                isTracking,
                isIdleAlertActive: isIdleAlertActive(),
                now,
                lastStateNotifAt: _lastStateNotifAt,
                lastNotifiedTracking: _lastNotifiedTracking,
                lastAutoStopNotifAt: _lastAutoStopNotifAt,
                debounceMs: STATE_NOTIF_DEBOUNCE_MS,
                autoStopSuppressMs: AUTOSTOP_NOTIF_SUPPRESS_MS,
            })
        ) {
            return;
        }

        _lastStateNotifAt = now;
        _lastNotifiedTracking = isTracking;

        const { title, body } = buildTrackingStateNotification({
            isTracking,
            todayTotalSeconds: liveTodayTotalSeconds(),
        });
        showSystemNotification({
            title,
            body,
            durationMs: 6000,
            id: `trackflow-state-${now}`,
            // Nice-to-have: clicking focuses the app (cross-platform via Electron).
            onClick: () => {
                try {
                    showPopup();
                } catch {}
            },
        });
        console.log(
            `[Notify] tracking-state (${reason}): ${isTracking ? "active" : "stopped"}`,
        );
    } catch (e) {
        console.warn("[Notify] state notification failed:", e.message);
    }
}

/** Stamp the moment an automatic-stop toast is shown so the generic state notif
 *  suppresses itself and never contradicts it. */
function markAutoStopNotified() {
    _lastAutoStopNotifAt = Date.now();
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
    let reasonClause;
    if (reason === "lock-screen") {
        reasonClause = "your computer was locked";
    } else if (reason === "idle-watchdog" || reason === "idle") {
        reasonClause = "no activity was detected";
    } else {
        reasonClause = "your computer went to sleep";
    }
    PowerManager.showAutoStopNotification(
        "TrackFlow — Timer auto-stopped",
        `Timer stopped at ${label} because ${reasonClause}. All time tracked before then was saved.`,
    );
    // This specific toast IS the state message for an automatic stop — suppress the
    // generic "not tracking" notif that a paired resume would otherwise fire.
    markAutoStopNotified();
}

/**
 * Sleep-gap threshold: the same idle window the admin configures in Settings →
 * Idle detection. One number governs both "away at the desk" and "asleep", so
 * the promise the product makes ("no activity for N minutes stops the timer")
 * holds whether the machine stayed awake or not.
 */
function getSleepGapThresholdSec() {
    const min = Number(config?.idle_timeout);
    if (Number.isFinite(min) && min > 0) return Math.round(min * 60);
    return PowerManager.DEFAULT_GAP_THRESHOLD_SEC;
}

/**
 * Long-sleep backstop, run on resume.
 *
 * The idle detector cannot catch a sleep (its interval is frozen while suspended
 * and the OS idle counter resets on wake), so without this a machine that sleeps
 * overnight with the timer running accrues the whole gap as tracked time — the
 * "20 hours tracked" report.
 *
 * Short sleeps keep running by design; only a gap longer than the idle threshold
 * closes the entry, back-dated to the last real activity (stamped by
 * onSuspendCleanup at the suspend instant) so the sleep itself is never credited.
 *
 * @returns {Promise<boolean>} true when the timer was stopped.
 */
async function autoStopAfterSleepGap(sleepSec, suspendedAtMs) {
    if (!isTimerRunning) return false;

    const lastActiveIso = loadLastActiveAt();
    const { shouldClose, stopAtMs, gapSec } = PowerManager.evaluateSleepGap({
        sleepSec,
        gapThresholdSec: getSleepGapThresholdSec(),
        lastActiveAtMs: lastActiveIso
            ? new Date(lastActiveIso).getTime()
            : null,
        suspendedAtMs,
        hasOpenSession: isTimerRunning,
    });

    if (!shouldClose || stopAtMs == null) return false;

    console.log(
        `[power] Sleep gap ${gapSec}s exceeded threshold — stopping timer at ${new Date(stopAtMs).toISOString()}`,
    );
    logToFile(
        "info",
        `[TIMER_SLEEP_GAP_STOP] gapSec=${gapSec} stopAt=${new Date(stopAtMs).toISOString()}`,
    );

    // Tear down capture/idle state first so nothing re-arms against a closed entry.
    screenshotService?.stop();
    activityMonitor?.stop();
    idleDetector?.stop();
    dismissIdleAlert();

    await autoStopTimerForPowerEvent("sleep-gap", stopAtMs);
    return true;
}

// ── Idle hard-stop watchdog (clamshell / never-sleeps backstop) ───────────────
//
// Failure mode this closes: the lid is closed but the machine stays AWAKE (on
// charger or with an external display), or the user simply walks away. NO
// `suspend` event ever fires, so `autoStopAfterSleepGap` never runs. If the
// interactive idle alert is disabled, misconfigured, never shown, or never
// answered, nothing stops the timer and the entire idle span is credited — the
// reported "12 hours tracked while asleep" phantom.
//
// This watchdog is defense-in-depth: it runs on a fixed cadence whenever the
// timer is running and is INDEPENDENT of the idle-detection feature toggle and of
// the idle detector's internal state. It reads the OS idle counter directly and
// hard-stops the timer, back-dated to the true last activity, once idle exceeds
// an absolute cap. The idle detector's own hard cap fires first in the normal
// (idle-detection-enabled) case; this is the layer that survives idle detection
// being turned off entirely or the detector getting wedged.
let _idleWatchdogInterval = null;
const IDLE_WATCHDOG_TICK_MS = 30_000; // cheap: one getSystemIdleTime() per 30s

/**
 * Absolute idle ceiling (seconds) past which the watchdog force-stops the timer.
 *
 * DECOUPLED from `idle_alert_auto_stop_min` on purpose (matches the idle
 * detector's hardStopIdleSec): the interactive countdown can be configured up to
 * 4h, but this safety net is a FIXED, tight bound — idle threshold + a fixed few
 * minutes grace + margin — so worst-case billed idle stays bounded no matter the
 * org config. The +120s margin (vs. the idle detector's +60s) means the idle
 * detector's own hard cap wins in the normal case; this layer only fires when
 * idle detection is disabled or the detector is wedged.
 */
const IDLE_WATCHDOG_GRACE_SEC = 10 * 60; // fixed 10-min grace (few minutes)
function getIdleWatchdogCapSec() {
    const rawTimeout = Number(config?.idle_timeout);
    const thresholdSec =
        Number.isFinite(rawTimeout) && rawTimeout > 0
            ? Math.round(rawTimeout * 60)
            : PowerManager.DEFAULT_GAP_THRESHOLD_SEC;
    return thresholdSec + IDLE_WATCHDOG_GRACE_SEC + 120;
}

async function _idleWatchdogTick() {
    try {
        if (!isTimerRunning) return;
        // An interactive idle action or an in-flight stop is already resolving the
        // idle — do not race it (the stopTimer mutex would no-op anyway).
        if (_idleActionInProgress || _stopTimerInProgress) return;
        // NEVER kill a live idle alert. The alert is answerable only by the user
        // (2026-07-23 product decision: it must never auto-dismiss), and this
        // watchdog fires at idle_timeout + 12 min — which is what was silently
        // closing the popup ~10 minutes after it appeared. It is safe to stand down
        // because the timer is server-PAUSED at idle detection, so nothing accrues
        // while the alert waits; if that pause never landed (offline) we re-push it
        // instead of hard-stopping. The watchdog still covers its real purpose:
        // idle detection disabled, or the detector wedged with no alert on screen.
        // See bugs/desktop-idle-alert-closed-by-idle-watchdog.md.
        if (isIdleAlertActive()) {
            retryIdlePauseIfUnsynced();
            return;
        }
        // Respect the "always keep idle time" policy: those orgs intentionally
        // credit presence, so awake-idle is not a phantom for them. (True sleep is
        // still stopped by autoStopAfterSleepGap regardless of policy.)
        if (config?.keep_idle_time === "always") return;

        let systemIdleSec;
        try {
            systemIdleSec = powerMonitor.getSystemIdleTime();
        } catch (e) {
            // Some Linux/Wayland sessions can throw or return unreliable values —
            // fail open (do nothing) rather than false-stop.
            return;
        }

        const lastActiveIso = loadLastActiveAt();
        const { shouldStop, stopAtMs, idleSec } =
            PowerManager.evaluateIdleHardStop({
                systemIdleSec,
                hardStopSec: getIdleWatchdogCapSec(),
                nowMs: Date.now(),
                lastActiveAtMs: lastActiveIso
                    ? new Date(lastActiveIso).getTime()
                    : null,
            });

        if (!shouldStop || stopAtMs == null) return;

        console.log(
            `[IdleWatchdog] idle ${idleSec}s exceeded cap — hard-stopping at ${new Date(stopAtMs).toISOString()}`,
        );
        logToFile(
            "warn",
            `[IDLE_WATCHDOG_STOP] idleSec=${idleSec} cap=${getIdleWatchdogCapSec()} stopAt=${new Date(stopAtMs).toISOString()}`,
        );

        // Tear down capture/idle state first so nothing re-arms against a closed
        // entry, then stop through the shared back-dated power-event path so the
        // server receives the correct ended_at and reconcile cannot resurrect it.
        screenshotService?.stop();
        activityMonitor?.stop();
        idleDetector?.stop();
        dismissIdleAlert();
        await autoStopTimerForPowerEvent("idle-watchdog", stopAtMs);
    } catch (e) {
        console.error("[IdleWatchdog] tick failed:", e.message);
    }
}

function startIdleWatchdog() {
    stopIdleWatchdog();
    _idleWatchdogInterval = setInterval(
        () => {
            _idleWatchdogTick();
        },
        IDLE_WATCHDOG_TICK_MS,
    );
    // Don't hold the event loop open on the watchdog alone.
    if (_idleWatchdogInterval.unref) _idleWatchdogInterval.unref();
}

function stopIdleWatchdog() {
    if (_idleWatchdogInterval) {
        clearInterval(_idleWatchdogInterval);
        _idleWatchdogInterval = null;
    }
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
    markAutoStopNotified();
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
            let todayTotalForPopup =
                result?.today_total ?? localStoppedProjectTotal;
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
    if (isIdleAlertActive()) {
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
            // LIVE-TIMER GUARD: a session whose START never synced can only be created
            // via POST /timer/start, which the server force-CLOSES the currently-open
            // timer to honor (one-open-timer-per-user). If a timer is live right now,
            // pushing this historical start would auto-stop and truncate it — the
            // "new time entry lost after stop→start" bug. Defer: the row stays in
            // timer_sessions (its time stays visible via the pending-offline total) and
            // syncs on a later reconcile once no timer is open. Pass 1a (stop-only,
            // synced_start=1) is unaffected — it targets a specific entry, never auto-stops.
            if (!session.synced_start && (isTimerRunning || isTimerPaused)) {
                continue;
            }
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
                    const upgradeResult = await handleAgentUpgradeRequired(e, {
                        localId: session.id,
                    });
                    if (upgradeResult) return;

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
                const upgradeResult = await handleAgentUpgradeRequired(
                    startErr,
                    { localId: localActive.id },
                );
                if (upgradeResult) return;

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
                const upgradeResult = await handleAgentUpgradeRequired(e, {
                    localId: currentEntry?._localId,
                });
                if (upgradeResult) return;

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
            // Server reachable — if an idle pause failed to land earlier, push it now.
            retryIdlePauseIfUnsynced();
            const globalTotal = status.today_total ?? 0;
            const elapsed = status.elapsed_seconds ?? 0;
            // Completed offline sessions the server hasn't seen yet aren't in its
            // today_total — add them so the offline time stays visible instead of the
            // total "resetting" to the server value the instant we reconnect.
            const pendingOfflineSecs = getUnsyncedCompletedSecondsForToday();
            if (isServerTimerOpen(status)) {
                todayTotalGlobal =
                    Math.max(0, globalTotal - elapsed) + pendingOfflineSecs;
                const projectTotal = status.project_today_total ?? globalTotal;
                todayTotalCurrentProject = Math.max(0, projectTotal - elapsed);
            } else {
                todayTotalGlobal = globalTotal + pendingOfflineSecs;
                todayTotalCurrentProject = 0;
            }

            // RETRY-UNTIL-SYNCED: a session created AND stopped while offline lives in
            // timer_sessions with synced_start/synced_stop = 0 and is flushed ONLY by
            // reconcileTimerState(). That historically ran only on a NetworkMonitor
            // 'online' transition, which never fires when net.isOnline() stays true
            // (interface up but server was unreachable) or when the offline window is
            // shorter than the monitor's poll — so the offline session was never synced
            // and its time appeared to reset. Reaching here means the status fetch just
            // succeeded (server is reachable), so drive reconcile every tick until any
            // completed-but-unsynced session lands on the server. scheduleReconcileAndFlush()
            // defers to the shared mutation guard (runs after this tick releases it).
            //
            // CRITICAL: only drain while NO timer is live. Pushing a historical
            // synced_start=0 start via POST /timer/start force-closes the currently-open
            // server timer (one-open-timer-per-user), which would auto-stop and truncate
            // the running session (the "new entry lost after stop→start" bug). While a
            // timer runs/pauses the pending row stays local (its time still shows via
            // pendingOfflineSecs) and syncs once the timer stops. Belt-and-suspenders with
            // the Pass 1b live-timer guard in reconcileTimerState().
            if (
                !isTimerRunning &&
                !isTimerPaused &&
                hasPendingCompletedOfflineSessions()
            ) {
                scheduleReconcileAndFlush();
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
                // Don't kill a live idle decision (ALERTING/SUSPENDED/hidden window),
                // a server-paused idle timer, or an unsynced local-first start.
                if (shouldPreserveLocalRunningWhenServerStopped()) {
                    console.log(
                        "[TimerSync] Server says stopped but local idle/paused/unsynced state preserved — keeping local state",
                    );
                    _isSyncing = false;
                    _timerStateMutationInProgress = false;
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
    // An idle decision is pending — never repaint the tray with a live/base total,
    // that is what let the idle window's own duration leak back into the display.
    if (isTimerRunning && isTimerPaused) {
        renderIdleFreeze();
        return;
    }
    const total = isTimerRunning ? todayTotalCurrentProject : todayTotalGlobal;
    if (total > 0) {
        setTrayText(formatTimeShort(total));
    } else {
        setTrayText("");
    }
}

/**
 * The instant the VISIBLE elapsed is measured to.
 *
 * While an idle decision is pending (`isTimerPaused`) this is the moment the user
 * went idle — NOT `Date.now()`. The idle period is not counted yet (it is pending
 * keep/discard/reassign), so anchoring to "now" is what made the minutes the idle
 * prompt sat on screen appear in the tracked total.
 * Bug: bugs/desktop-idle-window-time-counted-while-paused.md
 */
function displayAnchorMs() {
    if (!isTimerPaused) return Date.now();
    const idleStart = idleDetector?.idleStartedAt;
    if (idleStart != null) {
        const ms = new Date(idleStart).getTime();
        if (Number.isFinite(ms) && ms > 0) return ms;
    }
    // Detector already re-armed / lost its anchor — fall back to the instant the
    // pause was raised, captured in pauseTimerForIdle().
    if (Number.isFinite(_idleFreezeAnchorMs)) return _idleFreezeAnchorMs;
    return Date.now();
}

/** Seconds to display for the current session, frozen while idle-paused. */
function computeDisplaySeconds() {
    if (!_cachedStartedAtMs) return todayTotalCurrentProject;
    const elapsed = Math.floor((displayAnchorMs() - _cachedStartedAtMs) / 1000);
    return (
        todayTotalCurrentProject +
        Math.max(0, elapsed - _pendingOfflineReassignIdleSec)
    );
}

/**
 * Paint tray + popup with the FROZEN idle-start elapsed. Idempotent, so any path
 * that re-arms the tray timer or refreshes the tray during an idle decision lands
 * back on the same value instead of resuming the count.
 */
function renderIdleFreeze() {
    const frozen = computeDisplaySeconds();
    setTrayText(`⏸ ${formatTimeShort(frozen)}`);
    if (popupWindow && !popupWindow.isDestroyed()) {
        popupWindow.webContents.send("timer-tick", {
            totalSeconds: frozen,
            formatted: formatTimeShort(frozen),
            // Marks this as the authoritative frozen value: the renderer applies a
            // paused tick even when it is already showing "Paused (idle)", and drops
            // every UNflagged tick while paused.
            isPaused: true,
            todayTotalGlobal,
            todayTotalGlobalLive:
                todayTotalGlobal +
                Math.max(0, frozen - todayTotalCurrentProject),
            activityScore: 0,
            lastScreenshotAt: _lastScreenshotAt,
            isOnline: networkMonitor?.isOnline ?? true,
        });
    }
}

function startTrayTimer() {
    stopTrayTimer();
    // Hard gate: several paths (wake-from-sleep, idle-alert window closed, phantom
    // -stop recovery) call startTrayTimer() without knowing an idle decision is
    // still open. Counting from `_cachedStartedAtMs` there walks the display straight
    // through the idle period. Freeze instead and let resumeTimerAfterIdle() re-arm.
    if (isTimerPaused) {
        renderIdleFreeze();
        return;
    }
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
        // Idle pause raised while this interval was live (pauseTimerForIdle calls
        // stopTrayTimer, but a re-arm can race it) — freeze and stand down.
        if (isTimerPaused) {
            stopTrayTimer();
            renderIdleFreeze();
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
                // Server-synced completed all-projects sum (excludes the live running
                // session). Kept for compatibility / stopped-state convergence.
                todayTotalGlobal,
                // ISSUE 1 FIX: LIVE all-projects total for the secondary field. The
                // base `todayTotalGlobal` excludes the running session, so it used to
                // sit frozen while tracking and only jump after stop. Add the current
                // session's live elapsed so "Today, all projects" ticks up in real time
                // (derived from the local started_at anchor, the source of truth).
                todayTotalGlobalLive:
                    todayTotalGlobal +
                    Math.max(
                        0,
                        currentElapsed - _pendingOfflineReassignIdleSec,
                    ),
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

/**
 * Broadcast whether the main popup must be LOCKED because an idle alert is waiting
 * for an answer. While locked the renderer disables Start / Stop / project select so
 * the user cannot drive the timer from two places at once (e.g. hitting Stop in the
 * popup while the idle window is still deciding what to do with the idle period).
 * Recomputed from the single source of truth on every call, so it is safe to fire
 * from any show/dismiss/resolve path.
 */
function notifyIdleLockState() {
    notifyPopup("idle-lock", { locked: isIdleAlertActive() });
}

// ── Idle Alert System ────────────────────────────────────────────────────────

/**
 * ALL-WORKSPACES / FULLSCREEN VISIBILITY (idle alert)
 *
 * Root cause of the "idle alert only shows on the workspace it was created on"
 * bug: the alert relied on the BrowserWindow constructor option
 * `visibleOnAllWorkspaces: true`. Electron has NO such constructor option — it
 * is silently ignored — so the alert only ever inherited the plain
 * `alwaysOnTop: true` ('floating') level and stayed pinned to the Space/virtual
 * desktop it was born on. A macOS fullscreen app lives on its own dedicated
 * Space, so a user working there never saw the alert. The tray popup does NOT
 * have this problem because it calls `setVisibleOnAllWorkspaces()` (a method,
 * not a constructor flag) with `{ visibleOnFullScreen: true }`.
 *
 * This helper gives every idle alert window (primary + per-display mirrors) the
 * same everywhere-visible treatment as the popup:
 *   - macOS: setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }) so
 *     it surfaces on every Space AND over fullscreen apps, plus the
 *     'screen-saver' always-on-top level (higher than 'floating') so it floats
 *     above a fullscreen Space and the menu bar. This does not steal focus
 *     beyond the existing win.focus() call in showAndSendData(); the level only
 *     affects z-order/Space membership, not activation policy, so the
 *     close/re-show state machine is unaffected.
 *   - Windows: no Spaces API. setVisibleOnAllWorkspaces is a documented no-op;
 *     the 'screen-saver' level maps to an HWND_TOPMOST window so the alert sits
 *     over other apps — at least parity with the popup's always-on-top.
 *   - Linux/X11: 'screen-saver' maps to _NET_WM_STATE_ABOVE; workspace pinning
 *     is best-effort via setVisibleOnAllWorkspaces.
 *   - Linux/Wayland: the compositor owns window stacking AND workspace/output
 *     placement — both calls are advisory. The alert appears on the active
 *     output (same documented limitation as the multi-monitor fix); we cannot
 *     force it onto every virtual desktop from the app side.
 */
function _applyIdleAlertEverywhereVisible(win) {
    if (!win || win.isDestroyed()) return;
    try {
        if (typeof win.setVisibleOnAllWorkspaces === "function") {
            win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        }
        // Linux/Wayland: avoid 'screen-saver' level — on some compositors it can
        // paint a fullscreen black layer over the desktop. 'floating' is enough.
        if (typeof win.setAlwaysOnTop === "function") {
            const level = process.platform === "linux" ? "floating" : "screen-saver";
            win.setAlwaysOnTop(true, level);
        }
    } catch (err) {
        console.error(
            "[IdleAlert] Failed to apply everywhere-visible flags:",
            err.message,
        );
    }
}

/**
 * Actually surface an idle-alert window (primary or mirror), defeating the OS
 * placement quirks that made the alert "sometimes not appear" (Bug A):
 *   - macOS: re-assert setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true})
 *     AFTER show(), mirroring the tray-popup pattern — a fullScreenable:false
 *     window that re-asserts all-workspaces post-show reliably overlays another
 *     app's dedicated fullscreen Space.
 *   - Windows: flashFrame(true) + moveTop() defeat the foreground-lock that
 *     otherwise opens the window behind the active app, unfocused, with no
 *     taskbar flash. (Residual: Windows has no per-app "show on all virtual
 *     desktops" API, so the alert opens on the ACTIVE virtual desktop only.)
 *   - Linux/Wayland: placement is compositor-owned/advisory (unchanged).
 * Sets win._shown so the show-race guard (A4) can detect a window that exists
 * but never actually became visible.
 */
function _revealIdleAlertWindow(win) {
    if (!win || win.isDestroyed()) return;
    try {
        win.show();
        win._shown = true;
        if (process.platform === "darwin") {
            if (typeof win.setVisibleOnAllWorkspaces === "function") {
                win.setVisibleOnAllWorkspaces(true, {
                    visibleOnFullScreen: true,
                });
            }
        }
        if (
            process.platform === "win32" &&
            typeof win.flashFrame === "function"
        ) {
            win.flashFrame(true);
        }
        if (typeof win.moveTop === "function") win.moveTop();
        win.focus();
    } catch (err) {
        console.error("[IdleAlert] reveal failed:", err.message);
    }
}

/** True while an idle decision is genuinely pending — the detector is DETECTED/
 * ALERTING/SUSPENDED-with-preserved-idle, or an alert window still exists (even
 * hidden across sleep). Gates ALL Bug-B sleep-preservation logic so the 'never'
 * and 'always' idle policies (which never open a window) are untouched, and so
 * the normal non-idle lid-close still hard-stops. */
function isIdleAlertActive() {
    const detectorIdle =
        idleDetector &&
        typeof idleDetector.isIdleActive === "function" &&
        idleDetector.isIdleActive();
    const detectorSuspended =
        idleDetector?.state === "SUSPENDED" ||
        (_idleSuspendState && _idleSuspendState.isIdle);
    const windowLive =
        (idleAlertWindow && !idleAlertWindow.isDestroyed()) ||
        _idleAlertExtraWindows.some((w) => w && !w.isDestroyed());
    return !!(detectorIdle || detectorSuspended || windowLive);
}

/** Hide every idle-alert window WITHOUT destroying it, so the same windows can
 * be re-shown after wake (Bug B). Marks them not-shown so the resume path / show-
 * race guard force-reveal them. */
function hideIdleAlertWindows() {
    for (const w of _getAllIdleAlertWindows()) {
        try {
            if (typeof w.hide === "function") w.hide();
            w._shown = false;
        } catch {}
    }
}

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
        // Alert already exists — bring the primary to front and update idle data on
        // EVERY display's alert window (ISSUE 4). Keep the _actionId in sync on all of
        // them so whichever window the user acts on resolves the correct idle cycle.
        //
        // A4 show-race guard: if a prior idle window exists but never actually
        // became visible (its show() never landed — shown stayed false — or the OS
        // hid it), only calling focus()/moveTop() leaves an INVISIBLE window and the
        // new detection is swallowed. Force-reveal it (and any mirror) instead.
        const notVisible =
            !idleAlertWindow._shown ||
            (typeof idleAlertWindow.isVisible === "function" &&
                !idleAlertWindow.isVisible());
        if (notVisible) {
            for (const w of _getAllIdleAlertWindows()) {
                _revealIdleAlertWindow(w);
            }
        } else {
            idleAlertWindow.focus();
            if (typeof idleAlertWindow.moveTop === "function") {
                idleAlertWindow.moveTop();
            }
        }
        for (const w of _getAllIdleAlertWindows()) {
            w._actionId = alertActionId;
        }
        _broadcastToIdleAlerts(
            "idle-data",
            buildIdleAlertPayload(_idleAlertShownAt),
        );
        notifyIdleLockState();
        return;
    }
    // BUG-2 FIX: Check idle detector state instead of isTimerRunning to avoid race condition
    // where a concurrent sync cycle temporarily sets isTimerRunning=false, preventing the
    // modal from appearing. The idle detector is the authoritative source of idle state.
    if (!idleDetector?.isIdleActive()) return;

    // Lock the popup for the whole life of this alert — the idle window is the only
    // place the user may act until they answer it.
    notifyIdleLockState();

    screenshotService?.stop();

    // Notify + sound the user they are idle. Routed through showSystemNotification()
    // so it gets a UNIQUE toast id (per idle cycle) — without it, Windows Action
    // Center dedups/suppresses back-to-back idle toasts (Bug A) — plus the branded
    // icon and AppUserModelID. The in-renderer WebAudio beep (idle-alert.js) is the
    // primary, OS-policy-independent sound; this Notification is the secondary path.
    showSystemNotification({
        title: "TrackFlow — You appear to be idle",
        body: `You've been idle for ${Math.floor(idleSeconds / 60)} minutes`,
        silent: false,
        durationMs: 5000,
        id: `trackflow-idle-${alertActionId}`,
    });

    // Use cached project list — do not block the idle popup on a network call.
    // Force a background refresh on open (throttled) so a newly assigned project
    // shows in the reassign dropdown; the cached list renders immediately, and the
    // fresh list is pushed via idle-data when it arrives.
    refreshProjectsOnOpen(pushProjectsToIdleAlert);

    // ISSUE 4 FIX: show one idle alert per display. Clear any stray mirrors from a
    // previous cycle first, then pick the display under the cursor as the PRIMARY
    // (interactive) window and mirror the alert onto every other display.
    _destroyIdleAlertExtras();

    let displays;
    let primaryDisplay;
    try {
        displays = screen.getAllDisplays();
        primaryDisplay = screen.getDisplayNearestPoint(
            screen.getCursorScreenPoint(),
        );
    } catch {
        displays = [];
        primaryDisplay = null;
    }
    if (!Array.isArray(displays) || displays.length === 0) {
        displays = primaryDisplay ? [primaryDisplay] : [];
    }

    const IDLE_W = 380;
    const IDLE_H = 520;

    // Build a BrowserWindow centered on a specific display's work area. Passing
    // explicit x/y (instead of `center: true`) targets the intended monitor on
    // Windows / macOS / X11. On Wayland the compositor owns placement, so the
    // window still appears (on the active output) — never worse than before.
    function _createIdleWindowOnDisplay(display) {
        let x;
        let y;
        if (display && display.workArea) {
            const wa = display.workArea;
            x = Math.round(wa.x + (wa.width - IDLE_W) / 2);
            y = Math.round(wa.y + (wa.height - IDLE_H) / 2);
        }
        const opts = {
            width: IDLE_W,
            height: IDLE_H,
            frame: false,
            resizable: false,
            alwaysOnTop: true,
            skipTaskbar: false,
            show: false,
            backgroundColor: "#0a0a0a", // Prevent white flash on all platforms
            webPreferences: {
                preload: path.join(__dirname, "..", "preload", "index.js"),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                devTools: true,
            },
        };
        if (x != null && y != null) {
            opts.x = x;
            opts.y = y;
        } else {
            opts.center = true;
        }
        // macOS (Bug A2): a fullScreenable:true window in Electron 28 frequently
        // fails to overlay another app's dedicated fullscreen Space even with
        // setVisibleOnAllWorkspaces({visibleOnFullScreen:true}) — so the alert is
        // created on the default Space and never surfaces for a user working in a
        // fullscreen app. fullScreenable:false lets it float over the fullscreen
        // Space. macOS-only; Windows/Linux ignore this option.
        if (process.platform === "darwin") {
            opts.fullScreenable = false;
        }
        const win = new BrowserWindow(opts);
        // ALL-WORKSPACES FIX: make the alert follow the user everywhere, exactly
        // like the tray popup. Must be applied to EVERY alert window (primary +
        // per-display mirrors), which is why it lives here in the shared factory.
        _applyIdleAlertEverywhereVisible(win);
        return win;
    }

    // Order displays so the cursor's display is created first (becomes primary).
    const orderedDisplays = [];
    if (primaryDisplay) orderedDisplays.push(primaryDisplay);
    for (const d of displays) {
        if (!primaryDisplay || d.id !== primaryDisplay.id)
            orderedDisplays.push(d);
    }
    if (orderedDisplays.length === 0) orderedDisplays.push(null);

    // Create every display's window. The first (cursor display) is the primary,
    // interactive window and carries the full close/re-show state machine; the
    // rest are mirrors that share the same resolve path via the preload bridge.
    idleAlertWindow = _createIdleWindowOnDisplay(orderedDisplays[0]);
    for (let i = 1; i < orderedDisplays.length; i++) {
        const mirror = _createIdleWindowOnDisplay(orderedDisplays[i]);
        mirror._actionId = alertActionId;
        mirror._dismissedProgrammatically = false;
        let mirrorShown = false;
        const showMirror = () => {
            if (mirrorShown || mirror.isDestroyed()) return;
            mirrorShown = true;
            // Same platform reveal treatment as the primary (macOS re-assert /
            // Windows flashFrame+moveTop) so every display's alert surfaces.
            _revealIdleAlertWindow(mirror);
            mirror.webContents.send(
                "idle-data",
                buildIdleAlertPayload(_idleAlertShownAt),
            );
        };
        mirror.once("ready-to-show", showMirror);
        mirror.webContents.once("did-finish-load", showMirror);
        mirror.on("closed", () => {
            _idleAlertExtraWindows = _idleAlertExtraWindows.filter(
                (w) => w !== mirror,
            );
        });
        mirror
            .loadFile(path.join(__dirname, "..", "renderer", "idle-alert.html"))
            .catch((err) => {
                console.error(
                    "[IdleAlert] Failed to load idle-alert.html (mirror):",
                    err.message,
                );
            });
        _idleAlertExtraWindows.push(mirror);
    }

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
        // Bug A: reveal with the platform quirks handled (macOS re-assert /
        // Windows flashFrame+moveTop) instead of a bare show()+focus() that the OS
        // could leave behind the active app or off the fullscreen Space.
        _revealIdleAlertWindow(win);
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
        // The primary is gone — tear down any mirror windows so no orphan idle
        // alert is left on another display.
        _destroyIdleAlertExtras();
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
    // Any pending sleep-preservation snapshot is moot once the alert is genuinely
    // torn down (resolve/stop/logout) — clear it so a later resume never re-shows
    // a stale idle window.
    _idleSuspendState = null;
    // ISSUE 4 FIX: tear down every display's idle alert together so none is orphaned.
    _destroyIdleAlertExtras();
    if (idleAlertWindow && !idleAlertWindow.isDestroyed()) {
        // Mark as programmatic dismissal so the 'closed' handler doesn't
        // re-arm the idle detector (handleIdleAction already did that).
        idleAlertWindow._dismissedProgrammatically = true;
        idleAlertWindow.destroy();
    }
    idleAlertWindow = null;
    // Alert is gone — release the popup lock (recomputed, so a still-ALERTING
    // detector with a hidden window keeps the popup locked).
    notifyIdleLockState();
}

/**
 * Bug B — re-surface the idle alert after wake with the SAME idle cycle so the
 * user can still choose Keep/Discard/Reassign on the FULL away duration (idle +
 * sleep). Reuses the windows we merely hid on suspend when they survived; rebuilds
 * a fresh alert if they were lost. Broadcasts fresh idle-data (extended seconds,
 * new actionId, alertShownAt=now) with playSound:true so the renderer re-beeps.
 */
function reshowIdleAlertAfterResume(idleSeconds, idleStartedAt, actionId) {
    const existing = _getAllIdleAlertWindows();
    if (existing.length > 0) {
        for (const w of existing) {
            w._actionId = actionId;
            w._dismissedProgrammatically = false;
            _revealIdleAlertWindow(w);
        }
        _broadcastToIdleAlerts("idle-data", {
            idleStartedAt,
            idleSeconds,
            actionId,
            alertShownAt: _idleAlertShownAt ?? Date.now(),
            autoStopGraceSec: idleDetector?.alertAutoStopSec ?? 0,
            projects: cachedProjects || [],
            playSound: true,
        });
    } else {
        // Windows were destroyed while asleep — rebuild from scratch. A fresh
        // renderer beeps on its first idle-data (no playSound flag needed).
        showIdleAlert(idleSeconds, idleStartedAt, actionId);
    }
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
        // The idle decision is over (or was aborted) — re-evaluate the popup lock so
        // Start/Stop/project select come back. Runs on EVERY exit path, including the
        // early returns above.
        notifyIdleLockState();
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
        // 520, up from 500: the branded header row grew from 32px to 40px, and the
        // form needs to stay clear of the bottom edge once the inline error message
        // appears (this dialog is deliberately not resizable, so it cannot grow).
        height: 520,
        // 400x520 is the CONTENT box. Linux gets a real native title bar, whose
        // height would otherwise be taken OUT of the content area and clip the
        // bottom of a fixed-size, non-resizable form.
        useContentSize: true,
        // Sign-in stays a fixed-size dialog, but it gets the same native window
        // controls as the main window — the first screen users see should not be
        // the one place the app looks like a frameless widget.
        resizable: false,
        maximizable: false,
        center: true,
        title: "Sign in to TrackFlow",
        backgroundColor: "#121110", // matches --bg-primary (was a stale #0a0a0a)
        ...WindowGeometry.resolveWindowChrome(process.platform, {
            background: "#121110",
            symbol: "#a8a29e",
        }),
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
    if (isAgentUpgradeRequiredError(e)) {
        return getAgentUpgradePayload(e).message;
    }
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
