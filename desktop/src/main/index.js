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
} = require("./session-rules");
const { WorkSessionStore } = require("./work-session-store");
const { SessionSyncWorker } = require("./session-sync-worker");
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
    // Day-boundary zone for the midnight session split. Replaced by the org value from
    // GET /agent/config; this fallback only applies before the first successful fetch.
    timezone: "Asia/Karachi",
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

/**
 * Delete a local session outright.
 *
 * The ONLY legitimate caller is the agent-upgrade rollback below: the server has
 * refused this build, so the session it just opened represents no real tracked time and
 * must not linger as an unsyncable row. Nothing else may delete a session — the 05:00
 * purge (confirmed rows only) is the sole other deletion path.
 */
function deleteLocalTimerSession(localId) {
    if (!localId) return;
    const db = _getLocalTimerDb();
    if (!db) return;
    try {
        db.prepare(
            "DELETE FROM timer_sessions WHERE id = ? AND server_entry_id IS NULL",
        ).run(localId);
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

// Popup window size. Defined ONCE and shared by BOTH the initial creation and the
// re-show reposition, so the two can never drift apart (the bug where the window
// launched at one size and then resized itself on the next tray click).
// ── Popup sizing (Windows QA enhancement #10) ────────────────────────────────
// QA asked for the popup to behave like a normal Windows app window (drag the
// edges/corners to resize). Frameless windows on Windows support native edge
// resizing when `resizable: true` + the default thick frame (WS_THICKFRAME) is
// kept, so we only enable it there. macOS/Linux (incl. Wayland, where window
// geometry is compositor-owned) stay at the fixed 320x400 design size — QA only
// requested Windows and enabling elsewhere risks regressing the frameless tray
// popup behaviour (blur-hide, positioning, DPI anti-shrink from issue #7).
// The dimensions and clamp/resolve rules live in ./popup-size (unit-tested).
const PopupSize = require("./popup-size");
const POPUP_WIDTH = PopupSize.POPUP_WIDTH;
const POPUP_HEIGHT = PopupSize.POPUP_HEIGHT;
const POPUP_MIN_WIDTH = PopupSize.POPUP_MIN_WIDTH;
const POPUP_MIN_HEIGHT = PopupSize.POPUP_MIN_HEIGHT;
const POPUP_MAX_WIDTH = PopupSize.POPUP_MAX_WIDTH;
const POPUP_MAX_HEIGHT = PopupSize.POPUP_MAX_HEIGHT;
const IS_POPUP_RESIZABLE = process.platform === "win32";

// Windows-only: the user's chosen size persisted in user-prefs.json. On every
// other platform this always resolves to the fixed design size, so callers can
// use it unconditionally without regressing macOS/Linux.
function loadPopupSize() {
    let persisted = null;
    try {
        persisted = loadUserPrefs().popupSize;
    } catch {}
    return PopupSize.resolvePopupSize(persisted, IS_POPUP_RESIZABLE);
}

function savePopupSize(width, height) {
    if (!IS_POPUP_RESIZABLE) return;
    try {
        saveUserPrefsPatch({
            popupSize: PopupSize.clampPopupSize(width, height),
        });
    } catch (e) {
        console.error("Failed to save popup size:", e.message);
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
// Uploads local work sessions and runs the 05:00 purge. The ONLY component that talks
// to the server about tracked time — the timer itself never does.
let sessionSyncWorker = null;
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
// Retired with the offline idle-reassign replay. Idle is now resolved entirely in local
// SQLite — the session is split on the spot — so the displayed elapsed is already
// correct the instant the user answers and there is nothing to subtract. It stays at 0
// for the whole process lifetime; the remaining resets are harmless no-ops kept so the
// tray/popup total expressions read the same as before.
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

// adoptServerStartedAt() lived here. It reconciled a server-supplied `started_at`
// against the local anchor ("earlier-or-equal wins") so a skewed server clock could
// never push the visible start forward. There is no server-supplied start any more —
// the local SQLite timestamp is the only one that exists — so the reconciliation it
// performed is not merely unused, it is unrepresentable.

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
 * Refresh the displayed today-totals from a /timer/status payload.
 *
 * This is now the ONLY thing the desktop takes from the server about the timer. Server
 * status no longer drives isTimerRunning / currentEntry / the started_at anchor — local
 * SQLite is the source of truth for all of that, so there is nothing left to "adopt"
 * and no divergence to reconcile.
 *
 * We still read totals because they include MANUAL time entries, which the agent does
 * not own and cannot compute locally.
 */
function applyTotalsFromServerStatus(status) {
    if (!status) return;
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
}

/**
 * Pause tracking locally while an idle decision is pending.
 *
 * No server call. The entry stays open locally and its ended_at is decided when the
 * user answers the prompt — "continue tracking" trims the idle gap out, "stop timer"
 * closes at the idle start. Either way idle time is never credited as work, which is
 * the policy the old server-side /timer/idle wall existed to enforce.
 */
function pauseTimerForIdle(idleStartedAtIso) {
    if (!isTimerRunning || isTimerPaused) return;
    isTimerPaused = true;
    // Capture the freeze anchor BEFORE anything else — displayAnchorMs() (tray tick,
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

/**
 * Resume tracking after the user resolved the idle prompt. Purely local; the caller has
 * already rewritten the local session rows to exclude the idle gap.
 */
function resumeTimerAfterIdle() {
    if (!isTimerRunning) return;
    isTimerPaused = false;
    _idleFreezeAnchorMs = null; // idle cycle resolved — display follows the clock again
    logToFile("info", "[TIMER_RESUME] after idle action");
    notifyPopup("timer-resumed", {
        ...currentEntry,
        todayTotal: todayTotalCurrentProject,
    });
}
// NOTE: _suspendedAt is declared inside initializeApp() as a closure variable
// co-located with the powerMonitor handlers that use it. Do not re-declare here.

// ── Local Work Sessions (SQLite) ────────────────────────────────────────────
// The SOURCE OF TRUTH for tracked time. Timer start/stop/switch and idle decisions
// write here and return — no network call is on any of those paths, so a connectivity
// failure can delay an upload but can never affect or lose tracked time.
//
// SessionSyncWorker pushes rows to the server on its own schedule and marks them
// confirmed; the 05:00 purge is the only thing that deletes, and only what the server
// has acknowledged. Storage lives in WorkSessionStore (see work-session-store.js); the
// wrappers below are the seams the rest of this file calls through.
let _localTimerDb = null;
let workSessionStore = null;

function _getLocalTimerDb() {
    if (_localTimerDb) return _localTimerDb;
    try {
        const Database = require("better-sqlite3");
        const dbPath = path.join(app.getPath("userData"), "offline-queue.db");
        _localTimerDb = new Database(dbPath);
        _localTimerDb.pragma("journal_mode = WAL");
        _localTimerDb.pragma("busy_timeout = 5000");
        return _localTimerDb;
    } catch (e) {
        console.error("[LocalTimerDb] Init failed:", e.message);
        return null;
    }
}

/** Lazily build the session store over the shared offline-queue database. */
function getWorkSessionStore() {
    if (workSessionStore) return workSessionStore;
    const db = _getLocalTimerDb();
    if (!db) return null;
    try {
        workSessionStore = new WorkSessionStore(db);
        workSessionStore.setUserId(_sessionUserId);
        return workSessionStore;
    } catch (e) {
        console.error("[LocalTimerDb] Store init failed:", e.message);
        return null;
    }
}

/**
 * Id of the signed-in user, used to tag and scope local sessions. Set right after the
 * token is validated (getMe) and cleared on logout.
 */
let _sessionUserId = null;

function setSessionUserId(userId) {
    _sessionUserId = userId || null;
    getWorkSessionStore()?.setUserId(_sessionUserId);
}

/** Open a new live session. Returns the row, or null when storage is unavailable. */
function openLocalSession(projectId, startedAtIso = null, taskId = null) {
    const store = getWorkSessionStore();
    if (!store) return null;
    return store.open({ projectId, taskId, startedAt: startedAtIso });
}

/** Close a session at `endedAtIso`. Bumps its revision so the next sync carries it. */
function closeLocalSession(localId, endedAtIso = null) {
    const store = getWorkSessionStore();
    if (!store || !localId) return null;
    return store.close(localId, endedAtIso);
}

/**
 * Close the live session and open a fresh one at the same instant, atomically.
 * Used by project switch, idle "continue tracking", and the midnight split.
 */
function splitLocalSession(localId, atIso, projectId, taskId = null) {
    const store = getWorkSessionStore();
    if (!store || !localId) return null;
    return store.closeAndReopen(localId, atIso, { projectId, taskId });
}

/** Discard a just-closed session too short to be real work. Never touches synced rows. */
function dropTrivialLocalSession(localId) {
    const store = getWorkSessionStore();
    if (!store || !localId) return false;
    return store.dropIfTrivial(localId);
}

/**
 * The live local session, or null.
 *
 * Unlike the old implementation this NEVER discards a long-running row as implausible:
 * the midnight split turns a session left open for days into real per-day rows, so an
 * old open row is recoverable work rather than garbage.
 */
function getActiveLocalTimer() {
    const store = getWorkSessionStore();
    if (!store) return null;
    return store.getLive();
}

/** Seconds of completed local work the server has not seen yet, for today. */
function getUnsyncedCompletedSecondsForToday() {
    const store = getWorkSessionStore();
    if (!store) return 0;
    try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        return unsyncedCompletedSecondsForDay(
            store.getAll(),
            startOfDay.getTime(),
        );
    } catch (e) {
        console.warn("[LocalTimerDb] today unsynced total failed:", e.message);
        return 0;
    }
}

/** True while any completed session still needs uploading. */
function hasPendingCompletedOfflineSessions() {
    const store = getWorkSessionStore();
    if (!store) return false;
    try {
        return hasPendingCompletedSession(store.getAll());
    } catch {
        return false;
    }
}

/**
 * Sign-out cleanup. Keeps EVERY unconfirmed row for the signed-in user so nothing
 * tracked offline is lost; removes other accounts' rows and this user's confirmed ones.
 * The caller closes the live session first, so a kept row can never resurrect as a
 * phantom live timer on the next launch.
 */
function clearLocalTimerSessions() {
    getWorkSessionStore()?.clearForLogout();
}

/**
 * Resolve a queued screenshot/heartbeat's `local-…` placeholder to a real server entry
 * id, once the owning session has synced.
 *
 * Returns null while the session is still unsynced, so the offline queue HOLDS the item
 * instead of sending an unresolvable id (which the server 422s and drops). This is why
 * the sync worker flushes sessions BEFORE the queue.
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
                    "SELECT server_entry_id FROM timer_sessions WHERE id = ? AND server_entry_id IS NOT NULL LIMIT 1",
                )
                .get(localId);
        }
        if (!row && idemKey) {
            row = db
                .prepare(
                    "SELECT server_entry_id FROM timer_sessions WHERE idempotency_key = ? AND server_entry_id IS NOT NULL LIMIT 1",
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
        // Closing the session locally IS the stop, and it is already durable at this
        // point — the quit can no longer race a network call for it.
        if (localId) {
            closeLocalSession(localId, quitEndedAt);
        }
        isTimerRunning = false;
        isTimerPaused = false;
        currentEntry = null;
        activityMonitor?.stop();
        screenshotService?.stop();
        idleDetector?.stop();
        // UPLOAD ON QUIT: push the just-closed session (and any queued
        // heartbeats/screenshots) before we exit, so the time appears on the dashboard
        // without waiting for the next launch. Bounded so Quit still exits promptly;
        // anything left over stays in SQLite and uploads next launch.
        if (apiClient && networkMonitor?.isOnline !== false) {
            await withTimeout(
                (async () => {
                    try {
                        await sessionSyncWorker?.syncNow("quit", {
                            ignoreBackoff: true,
                        });
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
        closeLocalSession(localActive.id, new Date().toISOString());
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

    sessionSyncWorker?.stop();

    // KEEPS every unconfirmed session for this user so nothing tracked offline is
    // lost; removes other accounts' rows and this user's already-confirmed ones.
    // See WorkSessionStore.clearForLogout().
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
    sessionSyncWorker = null;
    workSessionStore = null;
    clearProjectsCache();
    todayTotalGlobal = 0;
    todayTotalCurrentProject = 0;
    config = {};
    currentShift = null;
    // Cleared AFTER clearLocalTimerSessions() above so this user's unsynced sessions
    // are correctly attributed and kept — the token is dead, so they can only be
    // uploaded when the same user signs in again.
    setSessionUserId(null);

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
            setSessionUserId(user?.id ? String(user.id) : null);
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
    // The idle_discard queue type is gone: idle is resolved entirely in local SQLite,
    // so there is no server split to replay and nothing to re-anchor to afterwards.
    // isLocalTimerActive is still consulted by legacy rows left in the queue by a
    // pre-upgrade build, which must be dropped rather than replayed.
    offlineQueue.isLocalTimerActive = () => {
        if (isTimerRunning) return true;
        const la = getActiveLocalTimer();
        return !!(la && !la.ended_at);
    };
    // Uploads sessions, then the dependent queue, then purges confirmed rows at 05:00.
    // getTimeZone reads `config` live so an org timezone change takes effect on the next
    // config refetch without restarting the worker.
    sessionSyncWorker = new SessionSyncWorker({
        store: getWorkSessionStore(),
        apiClient,
        offlineQueue,
        getTimeZone: () => config?.timezone || DEFAULT_CONFIG.timezone,
    });
    sessionSyncWorker.start();

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
        console.log("[Network] Back online — syncing sessions and flushing queue");
        // Push the local session backlog, then the dependent uploads. syncNow() does
        // both in that order (screenshots/heartbeats FK to entry ids that only exist
        // once their session has synced) and bypasses any backoff window, since a
        // confirmed reconnect is exactly when the backoff should be abandoned.
        await sessionSyncWorker?.syncNow("online", { ignoreBackoff: true });
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

    // Upload any backlog left by the previous run before doing anything else, so a
    // session tracked offline yesterday reaches the server promptly. Best-effort: the
    // rows are durable and the worker retries on its own schedule.
    try {
        await sessionSyncWorker?.syncNow("startup", { ignoreBackoff: true });
    } catch (e) {
        console.warn("[Startup] Session sync failed:", e.message);
    }

    // Read the server totals for display only (they include MANUAL entries). Timer
    // STATE is restored from local SQLite by restoreTimerFromLocalSession() below —
    // the server is never consulted about whether a timer is running.
    try {
        const status = await apiClient.getTimerStatus();
        applyTotalsFromServerStatus(status);
        updateTrayTitle();
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
            // Upload runs only after any gap-stop above has fully settled, so the
            // session boundaries pushed are the final ones.
            if (networkMonitor?.isOnline && apiClient) {
                setImmediate(() => {
                    sessionSyncWorker
                        ?.syncNow("wake", { ignoreBackoff: true })
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
        // Refresh the DISPLAYED totals only. Timer state is local, so focusing the
        // window can no longer adopt — or clobber — a running session based on a
        // stale server view. That branch is what produced both the
        // self-restart-after-stop and the phantom-stop desync.
        (async () => {
            try {
                const status = await apiClient.getTimerStatus();
                applyTotalsFromServerStatus(status);
                if (!isTimerRunning) {
                    todayTotalGlobal =
                        (status.today_total ?? 0) +
                        getUnsyncedCompletedSecondsForToday();
                    todayTotalCurrentProject = 0;
                }
                updateTrayTitle();
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

// ── ISSUE 8: focus-loss watch so an UNPINNED popup closes on a desktop/wallpaper click ──
// On macOS, clicking the desktop/wallpaper does not reliably emit a 'blur' on an
// accessory-app popup, so an unpinned popup could linger until the next click landed on
// a real window ("stays open until you click somewhere"). While the popup is visible and
// unpinned we poll focus; two consecutive unfocused samples hide it — this catches
// clicking another app AND clicking the desktop. Windows/Linux keep using the window
// 'blur' event (which DOES fire on desktop clicks there); a poll is intentionally NOT
// used on those platforms because an open native <select> steals window focus and a poll
// would wrongly hide the popup mid-selection. macOS renders <select> as an in-window
// overlay that keeps webContents focused, so the poll is safe there.
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
    if (process.platform !== "darwin") return;
    _stopUnpinnedFocusWatch();
    if (isAlwaysOnTop) return; // pinned popups stay open (ISSUE 9)
    _unpinnedFocusWatch = setInterval(() => {
        if (
            !popupWindow ||
            popupWindow.isDestroyed() ||
            !popupWindow.isVisible() ||
            isAlwaysOnTop
        ) {
            _stopUnpinnedFocusWatch();
            return;
        }
        const focused =
            popupWindow.isFocused() ||
            (popupWindow.webContents &&
                !popupWindow.webContents.isDestroyed() &&
                popupWindow.webContents.isFocused());
        if (focused) {
            _unpinnedUnfocusedTicks = 0;
            return;
        }
        _unpinnedUnfocusedTicks++;
        // ~2 ticks (~600ms) of sustained unfocus → the user clicked away (another app
        // OR the desktop). Hide to tray.
        if (_unpinnedUnfocusedTicks >= 2) {
            _stopUnpinnedFocusWatch();
            if (
                popupWindow &&
                !popupWindow.isDestroyed() &&
                !popupWindow.isFocused()
            ) {
                popupWindow.hide();
            }
        }
    }, 300);
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
        // previous show placed it on an extended monitor). On Windows the popup
        // is user-resizable, so re-assert the persisted size (not the fixed
        // design size) — otherwise the SHRINK/anti-drift setBounds below would
        // snap a user-resized window back to 320x400 on every reshow. On
        // macOS/Linux loadPopupSize() returns the fixed design size, so this is
        // identical to the previous behaviour there.
        const showSize = loadPopupSize();
        _repositionToPrimaryDisplay(
            popupWindow,
            showSize.width,
            showSize.height,
        );
        if (typeof popupWindow.moveTop === "function") {
            // Windows: moveTop() while a native <select> is open dismisses the
            // dropdown; only re-assert z-order on macOS where the tray popup
            // can slip behind other windows without it.
            if (process.platform === "darwin") {
                popupWindow.moveTop();
            }
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
    // On Windows, restore the user's last chosen size (clamped to min/max);
    // everywhere else this resolves to the fixed POPUP_WIDTH/POPUP_HEIGHT.
    const initialSize = loadPopupSize();
    const windowWidth = initialSize.width;
    const windowHeight = initialSize.height;

    // MULTI-MONITOR FIX: Always position on the PRIMARY display regardless of
    // which monitor the tray icon is on. Extended/secondary displays are excluded.
    // We still use the tray position to detect top-vs-bottom taskbar placement.
    const { x, y } = _calcPopupPosition(trayBounds, windowWidth, windowHeight);

    const popupOptions = {
        width: windowWidth,
        height: windowHeight,
        x,
        y,
        frame: false,
        resizable: IS_POPUP_RESIZABLE,
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
    };

    // Windows: enable native edge/corner resizing on the frameless popup.
    // `thickFrame: true` (the default) keeps the WS_THICKFRAME window style that
    // gives Chromium the resize borders and Aero-snap without drawing a caption
    // bar. Min size pins the designed layout floor; max keeps it a compact
    // utility window. macOS/Linux keep resizable:false — no size constraints
    // applied so their fixed-size behaviour is untouched.
    if (IS_POPUP_RESIZABLE) {
        popupOptions.thickFrame = true;
        popupOptions.minWidth = POPUP_MIN_WIDTH;
        popupOptions.minHeight = POPUP_MIN_HEIGHT;
        popupOptions.maxWidth = POPUP_MAX_WIDTH;
        popupOptions.maxHeight = POPUP_MAX_HEIGHT;
    }

    popupWindow = new BrowserWindow(popupOptions);

    // Apply always-on-top AFTER window creation (not in constructor options).
    // On macOS, use 'floating' level + relativeLevel 1 for reliable z-order.
    _applyAlwaysOnTop(popupWindow, isAlwaysOnTop);

    // Windows-only: persist the user's chosen size so it survives hide/show and
    // app restarts. Debounced so a resize drag (many 'resize' events) writes
    // once when it settles. `_repositionToPrimaryDisplay` also fires 'resize'
    // when it re-asserts the persisted size on reshow, but that writes back the
    // same clamped value, so it's a harmless no-op.
    if (IS_POPUP_RESIZABLE) {
        let _resizeSaveTimer = null;
        popupWindow.on("resize", () => {
            if (_resizeSaveTimer) clearTimeout(_resizeSaveTimer);
            _resizeSaveTimer = setTimeout(() => {
                _resizeSaveTimer = null;
                if (!popupWindow || popupWindow.isDestroyed()) return;
                const [w, h] = popupWindow.getContentSize();
                savePopupSize(w, h);
            }, 400);
        });
    }

    popupWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

    popupWindow.once("ready-to-show", () => {
        // ISSUE 7 FIX (preserved): re-assert the exact content size on first show.
        // A frameless window can be created a few px smaller than requested when a
        // fresh popup is built AFTER a logout/login on a fractional-DPI display
        // (Electron rounds the bounds by the scale factor). That shrunk height
        // clipped the footer (Sign out / Dashboard) when the activity section
        // appears on Start — but only post-relogin, where the window is rebuilt
        // mid-session. Pinning the content size guarantees the same layout as a
        // fresh launch. On Windows (resizable) we re-assert the user's PERSISTED
        // size instead of the fixed design size — still never below the minimum
        // (loadPopupSize clamps to POPUP_MIN_*), so the footer can't clip. On
        // macOS/Linux loadPopupSize() === {POPUP_WIDTH, POPUP_HEIGHT}, so this is
        // byte-for-byte the previous issue #7 behaviour. No-op where there is no
        // DPI drift (macOS, Linux, 100%-scale Windows).
        if (popupWindow && !popupWindow.isDestroyed()) {
            const readySize = loadPopupSize();
            popupWindow.setContentSize(readySize.width, readySize.height);
        }
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
        _unpinnedUnfocusedTicks = 0;
    });
    // ISSUE 8: keep the macOS focus-loss watch tied to the popup's visibility.
    // 'show' fires on both the initial show and every re-show (tray click), so this
    // covers all show paths without touching the existing-window branch.
    popupWindow.on("show", () => _startUnpinnedFocusWatch());
    popupWindow.on("hide", () => _stopUnpinnedFocusWatch());

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
                closeLocalSession(localActive.id, endedAt);
            }
        }
    }

    // UPLOAD BEFORE TEARDOWN: the stop above is recorded locally, so at this point the
    // server may still be missing this session (and the offline queue may still hold
    // heartbeats/screenshots). Push NOW — after this function the apiClient is nulled
    // and the queue closed, so nothing else can send until the next sign-in. Bounded so
    // a slow or unreachable server can never wedge sign-out; whatever does not make it
    // STAYS in SQLite (clearForLogout keeps every unconfirmed row) and uploads the next
    // time this user signs in. ignoreBackoff: sign-out is exactly when a pending
    // backoff window must not stand between the user and their tracked time.
    if (apiClient && networkMonitor?.isOnline !== false) {
        console.log("[Logout] Flushing tracked time before sign-out");
        await withTimeout(
            (async () => {
                try {
                    await sessionSyncWorker?.syncNow("logout", {
                        ignoreBackoff: true,
                    });
                } catch (e) {
                    console.warn("[Logout] session sync failed:", e.message);
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

    // Stop the worker BEFORE closing the queue it flushes through, so a cycle cannot
    // fire against a half-torn-down session.
    sessionSyncWorker?.stop();

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
    sessionSyncWorker = null;
    workSessionStore = null;
    clearProjectsCache();
    todayTotalGlobal = 0;
    todayTotalCurrentProject = 0;
    config = {};
    currentShift = null;
    setSessionUserId(null);

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
        // ISSUE 9 FIX: the close button is disabled while pinned; enforce it in the
        // main process too so a pinned modal can only be closed after unpinning.
        // (Tray-toggle and blur-to-hide call popupWindow.hide() directly, not this
        // IPC, so they are unaffected.)
        if (isAlwaysOnTop) return;
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
                closeLocalSession(localId, updateEndedAt);
            }
            try {
                // Best-effort upload before the update restarts the app. Bounded: an
                // unreachable server must not delay the install. Anything left over is
                // still in SQLite and uploads after the restart.
                await Promise.race([
                    sessionSyncWorker?.syncNow("pre-update", {
                        ignoreBackoff: true,
                    }) ?? Promise.resolve(),
                    new Promise((resolve) => setTimeout(resolve, 3000)),
                ]);
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
                const globalTotal = status.today_total ?? 0;
                const allProjectsTotal =
                    status.all_projects_today_total ?? globalTotal;

                // Timer STATE comes from local SQLite. The server's view is used only
                // for totals (which include manual entries) — it can no longer clear a
                // running timer, which is what the old "else" branch did whenever the
                // server view was merely stale.
                if (!isTimerRunning && !isTimerPaused) {
                    const localActive = getActiveLocalTimer();
                    if (localActive && !localActive.ended_at) {
                        console.log(
                            "[get-timer-state] Restoring orphaned local session after phantom stop",
                        );
                        restoreInMemoryFromLocalActive(localActive);
                    }
                }

                todayTotalGlobal =
                    allProjectsTotal + getUnsyncedCompletedSecondsForToday();
                if (!isTimerRunning) todayTotalCurrentProject = 0;

                if (isTimerRunning && currentEntry?.project_id) {
                    const sessionElapsed = _cachedStartedAtMs
                        ? Math.floor((Date.now() - _cachedStartedAtMs) / 1000)
                        : 0;
                    todayTotalForDisplay =
                        todayTotalCurrentProject + sessionElapsed;
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
/**
 * Move tracking to a different project.
 *
 * Purely local: the live session is closed and a new one opened at the SAME instant, in
 * one SQLite transaction. That atomicity is what keeps the timeline contiguous — there
 * is never a moment with two open sessions or none, which is exactly the invariant the
 * old server-side atomic switch existed to provide, now without a network dependency.
 */
async function switchProject(projectId) {
    if (!isTimerRunning) return { error: "No timer running" };

    const live = getActiveLocalTimer();
    if (!live) return { error: "No timer running" };

    try {
        // Final heartbeat for the OLD entry before the boundary moves.
        if (activityMonitor) {
            await activityMonitor.sendFinalHeartbeat().catch(() => {});
        }

        const switchAt = new Date().toISOString();
        const next = splitLocalSession(live.id, switchAt, projectId, null);
        if (!next) return { error: "Could not switch project" };

        // A switch performed within a second or two of starting leaves behind a
        // zero-ish session that is pure noise. Drop it, but only while the server has
        // never seen it.
        dropTrivialLocalSession(live.id);

        const newEntry = {
            id: next.id,
            started_at: next.started_at,
            project_id: projectId,
            idempotency_key: next.idempotency_key,
            _localId: next.id,
        };

        currentEntry = newEntry;
        _cachedStartedAtMs = new Date(next.started_at).getTime();
        todayTotalCurrentProject = 0;
        _timerStateVersion++;

        posthog.capture(currentEntry?.user_id || "unknown", "timer_switched", {
            project_id: projectId,
            stopped_entry_id: live.id,
        });

        // Rebind capture services to the new session.
        screenshotService?.stop();
        screenshotService?.start(newEntry.id);
        activityMonitor?.stop();
        activityMonitor?.start();
        idleDetector?.stop();
        idleDetector?.start();

        notifyPopup("timer-started", {
            ...newEntry,
            todayTotal: todayTotalCurrentProject,
        });
        updateTrayTitle();

        sessionSyncWorker?.syncNow("project-switch");

        return {
            success: true,
            entry: newEntry,
            todayTotal: todayTotalCurrentProject,
        };
    } catch (e) {
        console.error("[switchProject] Failed:", e.message);
        return { error: e.message };
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

        // ── Project authorization, checked locally ──────────────────────────
        // The server used to reject a start on an unassigned project. There is no
        // start call any more, so the check happens against the cached project list
        // (loadProjects()). A stale cache is not a data-integrity risk: the sync
        // endpoint re-checks assignment and stores the entry with project_id = null
        // rather than rejecting it, so the TIME survives either way.
        if (projectId && Array.isArray(projects) && projects.length > 0) {
            const known = projects.some((p) => String(p.id) === String(projectId));
            if (!known) {
                _startTimerInProgress = false;
                return { error: "You are not assigned to this project." };
            }
        }

        // LOCAL-FIRST: the session is written to SQLite and that is the whole of it.
        // No network call is on this path, so nothing about starting can fail, hang,
        // or be lost because of connectivity. The sync worker uploads it later.
        const session = openLocalSession(projectId);
        if (!session) {
            _startTimerInProgress = false;
            return { error: "Could not start the timer — local storage unavailable." };
        }

        const localId = session.id;
        const localStartedAt = session.started_at;
        _cachedStartedAtMs = new Date(localStartedAt).getTime();

        touchLastActiveAt(localStartedAt);
        console.log(
            `[Timer] Session opened locally: ${localId} (uuid=${session.idempotency_key})`,
        );

        const localEntry = {
            id: localId,
            started_at: localStartedAt,
            project_id: projectId,
            idempotency_key: session.idempotency_key,
            _localId: localId,
        };
        currentEntry = localEntry;
        isTimerRunning = true;
        isTimerPaused = false;
        todayTotalCurrentProject = 0;
        _pendingOfflineReassignIdleSec = 0;
        _timerStateVersion++;

        posthog.capture(currentEntry?.user_id || "unknown", "timer_started", {
            project_id: projectId,
        });

        if (_timerStateVersion === startVersion + 1) {
            notifyPopup("timer-started", {
                ...localEntry,
                todayTotal: todayTotalCurrentProject,
            });
        }
        setImmediate(() => afterStartTimer(projectId, todayTotalCurrentProject));

        // Nudge the sync worker so a start is visible on the dashboard promptly when
        // online, instead of waiting up to a full interval. Fire-and-forget: the
        // session is already durable.
        sessionSyncWorker?.syncNow("timer-start");

        return {
            success: true,
            entry: localEntry,
            todayTotal: todayTotalCurrentProject,
        };
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

        // LOCAL-FIRST: closing the session in SQLite IS the stop. There is no server
        // call here, so a stop can never fail, hang, or be lost to the network — the
        // failure mode that motivated this whole refactor.
        const localEndedAt = new Date(endedAtMs).toISOString();
        const localId = currentEntry?._localId || null;

        if (localId) {
            closeLocalSession(localId, localEndedAt);
            console.log(
                `[Timer] Session closed locally: ${localId}, duration=${sessionElapsed}s`,
            );
            // An idle-split artifact or a mis-click leaves a sub-second session that is
            // noise, not work. Drop it — but only while the server has never seen it;
            // anything already uploaded is the server's to keep.
            if (isZeroDurationEntry) {
                dropTrivialLocalSession(localId);
            }
        }

        // Now update local state
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

        // Post-stop async work (non-blocking). The session is already durable; this
        // only refreshes the DISPLAYED totals and nudges the upload.
        (async () => {
            // Push promptly so the dashboard reflects the stop, rather than waiting up
            // to a full sync interval. Failure is fine — the row stays dirty and the
            // worker retries on its own schedule.
            await sessionSyncWorker?.syncNow("timer-stop");

            // Re-read the server totals: they include MANUAL entries, which the agent
            // does not own and cannot compute locally. Offline, fall back to the local
            // accumulated total — NEVER 0, or a sleep auto-stop would show 00:00:00
            // despite the time being safely recorded.
            const localGlobal =
                (todayTotalGlobal || 0) +
                Math.max(0, sessionElapsed - pendingIdleAtStop);
            try {
                const serverGlobal = await apiClient?.getTodayTotal(null);
                todayTotalGlobal =
                    serverGlobal != null && serverGlobal >= 0
                        ? serverGlobal
                        : localGlobal;
            } catch {
                todayTotalGlobal = localGlobal;
            }
            updateTrayTitle();

            let todayTotalForPopup = localStoppedProjectTotal;
            try {
                const serverTotal =
                    await apiClient?.getTodayTotal(stoppedProjectId);
                if (serverTotal != null && serverTotal >= 0) {
                    todayTotalForPopup = serverTotal;
                }
            } catch {
                todayTotalForPopup = localStoppedProjectTotal;
            }
            notifyPopup("timer-stopped", {
                entry: null,
                todayTotal: todayTotalForPopup,
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

// ── Reconciliation on Reconnect — DELETED ───────────────────────────────────
// reconcileTimerState() and syncSessionStop() lived here: ~290 lines that compared
// local SQLite against GET /timer/status and tried to repair whichever had diverged,
// guarded by three interlocking mutexes to stop the repairs racing each other.
//
// They are gone because the divergence they existed to fix cannot occur any more.
// The desktop is the SOLE writer of tracked time: sessions are created, mutated and
// closed in SQLite, and SessionSyncWorker pushes them up as an idempotent upsert keyed
// on a client-generated uuid. There is no second writer, so there is nothing to
// reconcile — the server simply converges on local state.
//
// Every bug this layer accumulated (duplicate entries from a racing start, a stop
// replayed onto a newer session, an idle pause resuming behind an open alert, offline
// time destroyed at sign-out) was a symptom of split ownership rather than a defect in
// the repair logic. See bugs/offline-first-time-sync-refactor.md.

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
            // The ONLY thing taken from the server here is the today-totals, because
            // they include MANUAL time entries the agent does not own. Timer STATE
            // (running / entry / anchor) comes from local SQLite — the server no
            // longer has an opinion the desktop needs to adopt, so the whole
            // adopt-and-repair ladder that used to live here is gone.
            const status = await apiClient.getTimerStatus();
            const globalTotal = status.today_total ?? 0;
            const elapsed = status.elapsed_seconds ?? 0;

            // Completed local sessions the server has not seen yet are not in its
            // total — add them so offline time stays visible instead of the figure
            // appearing to reset the instant we reconnect.
            const pendingOfflineSecs = getUnsyncedCompletedSecondsForToday();

            if (isTimerRunning) {
                // A live session's elapsed is added by the tray tick, so strip the
                // server's own elapsed to avoid counting it twice.
                todayTotalGlobal =
                    Math.max(0, globalTotal - elapsed) + pendingOfflineSecs;
                const projectTotal = status.project_today_total ?? globalTotal;
                todayTotalCurrentProject = Math.max(0, projectTotal - elapsed);
            } else {
                todayTotalGlobal = globalTotal + pendingOfflineSecs;
                todayTotalCurrentProject = 0;
            }

            // Phantom-stop recovery: in-memory state was cleared (a renderer glitch,
            // an exception mid-stop) but SQLite still holds an open session. SQLite
            // wins — restore from it. This is the one repair still worth making, and
            // it needs no server input at all.
            if (!isTimerRunning && !isTimerPaused) {
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
                }
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

/**
 * Split the live session at any org-local midnight it has crossed, and re-point the
 * in-memory timer at the resulting new session.
 *
 * The displayed elapsed necessarily resets at midnight — the current SESSION really did
 * just begin. The day's accumulated total resets at the same moment, so the two agree.
 */
function maybeSplitAtMidnight() {
    if (!isTimerRunning || isTimerPaused || !sessionSyncWorker) return;
    if (_stopTimerInProgress || _isHandlingIdleAction) return;

    const result = sessionSyncWorker.splitAtMidnightIfNeeded();
    if (!result || result.splits === 0 || !result.live) return;

    const live = result.live;
    currentEntry = {
        id: live.id,
        started_at: live.started_at,
        project_id: live.project_id || null,
        idempotency_key: live.idempotency_key,
        _localId: live.id,
    };
    _cachedStartedAtMs = new Date(live.started_at).getTime();
    todayTotalCurrentProject = 0;
    todayTotalGlobal = 0;
    _timerStateVersion++;

    // Rebind capture so screenshots/heartbeats attach to the NEW session rather than
    // the one that just closed at the boundary.
    screenshotService?.rebindEntryId(live.id);

    console.log(
        `[Timer] Crossed midnight — continuing on a new session (${live.id})`,
    );
    notifyPopup("timer-started", {
        ...currentEntry,
        todayTotal: todayTotalCurrentProject,
        _splitAtMidnight: true,
    });

    sessionSyncWorker.syncNow("midnight-split");
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

        // ── Midnight split ──────────────────────────────────────────────────
        // Close the live session at 00:00 (ORG timezone) and reopen it, so no entry
        // ever spans two calendar days and daily reports, attendance rollups and
        // payroll stay exact. Loops internally, so a machine that slept from Friday
        // to Monday produces one row per day rather than one impossible row.
        //
        // Driven from this 1s tick rather than the sync worker's timer because it is
        // a purely LOCAL correctness operation: it must happen promptly and whether
        // or not the network is up.
        maybeSplitAtMidnight();
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
                // Both land here as a DISCARD. Crediting idle time as work was removed
                // by owner policy (2026-07-16); the desktop only ever offers "continue
                // tracking" and "stop timer", both of which drop the idle gap. The
                // reassign case is kept only so an older renderer cannot smuggle idle
                // time onto another project.
                if (currentEntry && effectiveIdleStartedAt) {
                    const idleStartIso = new Date(
                        effectiveIdleStartedAt,
                    ).toISOString();
                    const resumeIso = new Date().toISOString();

                    // LOCAL SPLIT — no network. Close the live session at the moment
                    // the user went idle and open a fresh one now, so the idle gap
                    // simply does not exist in any session. Both rows sync normally.
                    const prevLocalId = currentEntry._localId || null;
                    const prevStartIso = currentEntry.started_at;

                    const next = prevLocalId
                        ? splitLocalSession(
                              prevLocalId,
                              idleStartIso,
                              currentEntry.project_id || null,
                              null,
                          )
                        : null;

                    if (next) {
                        // Credit only the PRE-IDLE work to the running total. Measuring
                        // to idle-START (never idle-end) is what stops the discarded gap
                        // being counted twice — the new session already counts from now.
                        const preIdleSeconds = Math.floor(
                            (effectiveIdleStartedAt -
                                new Date(prevStartIso).getTime()) /
                                1000,
                        );
                        todayTotalCurrentProject =
                            (todayTotalCurrentProject || 0) +
                            Math.max(0, preIdleSeconds);

                        // A session that was idle almost from the moment it began
                        // leaves a sub-second stub — drop it rather than upload noise.
                        dropTrivialLocalSession(prevLocalId);

                        currentEntry = {
                            id: next.id,
                            started_at: next.started_at,
                            project_id: next.project_id || null,
                            idempotency_key: next.idempotency_key,
                            _localId: next.id,
                        };
                        _cachedStartedAtMs = new Date(
                            next.started_at,
                        ).getTime();
                        _timerStateVersion++;

                        logToFile(
                            "info",
                            `[IDLE_ACTION] discard split local session at ${idleStartIso}, resumed at ${resumeIso}`,
                        );

                        // No screenshots are captured during idle (Hubstaff behavior),
                        // so there is nothing to re-attach or drop here.
                        sessionSyncWorker?.syncNow("idle-discard");
                    }
                }
                // FIX D1: Reset _idleAlertShownAt after action handled
                _idleAlertShownAt = null;
                resumeTimerAfterIdle();
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
        // After idle is resolved: push the (possibly just-split) sessions and flush
        // any data queued during sleep. Especially important after a long sleep.
        if (networkMonitor?.isOnline && apiClient) {
            setImmediate(() => {
                sessionSyncWorker
                    ?.syncNow("idle-resolved", { ignoreBackoff: true })
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
