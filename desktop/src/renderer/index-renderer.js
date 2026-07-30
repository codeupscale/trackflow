// ── Theme: follow system preference (dark/light) ──
function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}
window.trackflow.getTheme().then(applyTheme).catch(() => {});
window.trackflow.onThemeChange(applyTheme);

// ── Platform detection for shortcut labels ──
const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
const isWin = navigator.platform.toUpperCase().indexOf('WIN') >= 0;
const modKey = isMac ? 'Cmd' : 'Ctrl';

// Tag the root with the platform so the header can reserve room for whichever
// native window controls the OS draws over it: macOS floats the traffic lights
// on the LEFT of our header ('hiddenInset'), Windows paints minimise/maximise/
// close into its RIGHT ('titleBarOverlay'), and Linux gets a real native title
// bar ABOVE the header, so it needs no reserved space at all. See the chrome
// block in main/index.js.
document.documentElement.classList.add(
  isMac ? 'platform-mac' : isWin ? 'platform-win' : 'platform-linux'
);

let elapsedSeconds = 0;
let todayTotalBase = 0;
let isRunning = false;
let isPaused = false;
let currentStartedAt = null;
let _startedAtMs = null;
// RACE-FIX: Track the latest state version from the main process.
// Any timer-started/timer-stopped notification with a version older than this
// is stale (from an async follow-up that raced with a newer action) and is discarded.
let _lastStateVersion = 0;

function showNotification(msg) {
  const el = document.createElement('div');
  el.className = 'notification';
  el.textContent = msg;
  el.setAttribute('role', 'alert');
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3000);
}

const timerDisplay = document.getElementById('timerDisplay');
const totalSumDisplay = document.getElementById('totalSumDisplay');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

// Secondary, NON-ticking total: sum of all projects today (server-synced
// `todayTotalGlobal`). Only updated when the main process sends a fresh value
// (start / stop / keep / discard / reassign / sync / network change), never on the
// per-second tick's own counting — so it shows a stable sum, not a climbing timer.
let _lastTotalSumSeconds = null;
function updateTotalSum(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return;
  const s = Math.max(0, Math.floor(seconds));
  if (s === _lastTotalSumSeconds) return;
  _lastTotalSumSeconds = s;
  if (totalSumDisplay) {
    totalSumDisplay.textContent = `Today, all projects: ${formatTime(s)}`;
  }
}
const startBtn = document.getElementById('startBtn');
const startBtnText = document.getElementById('startBtnText');
const stopBtn = document.getElementById('stopBtn');
const projectSelect = document.getElementById('projectSelect');
const logoutLink = document.getElementById('logoutLink');
const dashboardLink = document.getElementById('dashboardLink');
const permissionBanner = document.getElementById('permissionBanner');
const fixPermissionBtn = document.getElementById('fixPermissionBtn');
const wallpaperBanner = document.getElementById('wallpaperBanner');
const fixWallpaperBtn = document.getElementById('fixWallpaperBtn');
const offlineBanner = document.getElementById('offlineBanner');
const activitySection = document.getElementById('activitySection');
const activityValue = document.getElementById('activityValue');
const activityBarFill = document.getElementById('activityBarFill');
const connDot = document.getElementById('connDot');
const connText = document.getElementById('connText');
const lastSsText = document.getElementById('lastSsText');
const lastSsSep = document.getElementById('lastSsSep');

let _currentActivityScore = 0;
let _lastScreenshotAt = null;
let _isOnline = true;

// CONNECTIVITY FIX: Network status indicator
window.trackflow.getNetworkStatus().then((status) => {
  _isOnline = status.online;
  if (offlineBanner) offlineBanner.style.display = status.online ? 'none' : 'flex';
  updateConnStatus();
}).catch(() => {});
window.trackflow.onNetworkStatus((data) => {
  _isOnline = data.online;
  if (offlineBanner) offlineBanner.style.display = data.online ? 'none' : 'flex';
  updateConnStatus();
});

// ── Activity & Status Footer Helpers ──
function getActivityLevel(score) {
  if (score < 30) return 'low';
  if (score < 60) return 'medium';
  return 'high';
}

function updateActivityDisplay(score) {
  _currentActivityScore = score;
  const level = getActivityLevel(score);
  activityValue.textContent = `${score}%`;
  activityValue.className = `activity-value ${level}`;
  activityBarFill.style.width = `${score}%`;
  activityBarFill.className = `activity-bar-fill ${level}`;
}

function formatTimeAgo(isoString) {
  if (!isoString) return '';
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 10) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function updateConnStatus() {
  connDot.className = `dot ${_isOnline ? 'online' : 'offline'}`;
  connText.textContent = _isOnline ? 'Online' : 'Offline';
  const ssAgo = _lastScreenshotAt ? formatTimeAgo(_lastScreenshotAt) : null;
  if (ssAgo) {
    lastSsSep.style.display = '';
    lastSsText.textContent = `Last SS ${ssAgo}`;
  } else {
    lastSsSep.style.display = 'none';
    lastSsText.textContent = '';
  }
}

function showTrackingInfo(visible) {
  activitySection.classList.toggle('visible', visible);
}

// Listen for activity updates from main process (on screenshot capture)
window.trackflow.onActivityUpdate((data) => {
  if (data.activityScore != null) updateActivityDisplay(data.activityScore);
  if (data.lastScreenshotAt) _lastScreenshotAt = data.lastScreenshotAt;
  if (data.isOnline != null) _isOnline = data.isOnline;
  updateConnStatus();
});

// Fetch initial activity info
window.trackflow.getActivityInfo().then((info) => {
  if (info) {
    if (info.activityScore != null) updateActivityDisplay(info.activityScore);
    if (info.lastScreenshotAt) _lastScreenshotAt = info.lastScreenshotAt;
    if (info.isOnline != null) _isOnline = info.isOnline;
    updateConnStatus();
  }
}).catch(() => {});

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function calcElapsedFromStartedAt() {
  if (!_startedAtMs) return 0;
  return Math.max(0, Math.floor((Date.now() - _startedAtMs) / 1000));
}

function setStartedAt(isoOrMs) {
  if (!isoOrMs) { currentStartedAt = null; _startedAtMs = null; return; }
  if (typeof isoOrMs === 'number') {
    _startedAtMs = isoOrMs;
    currentStartedAt = new Date(isoOrMs).toISOString();
  } else {
    currentStartedAt = isoOrMs;
    _startedAtMs = new Date(isoOrMs).getTime();
  }
}

// ── Idle lock ──
// While the idle alert is waiting for an answer, the popup must not offer a second
// way to drive the timer (the QA repro: Stop/Start still clickable behind the idle
// window, producing states nobody asked for). Main broadcasts `idle-lock` on every
// show/dismiss/resolve and also returns `idleLocked` from get-timer-state so a
// re-opened popup renders locked from the first paint.
let _idleLocked = false;

function applyIdleLock(locked) {
  _idleLocked = !!locked;
  const banner = document.getElementById('idleLockBanner');
  if (banner) banner.style.display = _idleLocked ? 'flex' : 'none';
  if (_idleLocked) {
    startBtn.disabled = true;
    stopBtn.disabled = true;
    projectSelect.disabled = true;
    startBtn.style.opacity = '0.5';
    stopBtn.style.opacity = '0.5';
    startBtn.style.cursor = 'not-allowed';
    stopBtn.style.cursor = 'not-allowed';
    stopBtn.title = 'Answer the idle prompt first';
    startBtn.title = 'Answer the idle prompt first';
  } else {
    stopBtn.disabled = false;
    stopBtn.style.opacity = '1';
    stopBtn.style.cursor = 'pointer';
    stopBtn.title = '';
    startBtn.title = '';
    // Start / project select ownership goes back to the normal state machine.
    syncProjectSelectEnabled();
    updateStartBtnState();
  }
}

window.trackflow.onIdleLock?.((data) => applyIdleLock(data?.locked));

function updateDisplay(running, paused = false) {
  isRunning = running;
  isPaused = paused;
  timerDisplay.textContent = formatTime(elapsedSeconds);
  timerDisplay.className = `time ${running ? 'running' : paused ? 'paused' : 'stopped'}`;
  statusDot.className = `dot ${running ? 'green' : paused ? 'amber' : 'gray'}`;
  statusText.textContent = running
    ? 'Tracking'
    : paused
      ? 'Paused (idle)'
      : (todayTotalBase > 0 ? 'Today\u2019s Total' : 'Stopped');
  startBtn.style.display = running || paused ? 'none' : 'flex';
  stopBtn.style.display = running || paused ? 'flex' : 'none';
  projectSelect.disabled = running || paused || projectSelect.options.length <= 1;
  // When stopped, Start must stay disabled until a project is selected — defer to
  // updateStartBtnState() instead of unconditionally enabling it. (The old
  // `startBtn.disabled = isRunning || isPaused` re-enabled Start with no project,
  // letting the timer start unassigned.)
  if (running || paused) {
    startBtn.disabled = true;
  } else {
    updateStartBtnState();
  }
  showTrackingInfo(running || paused);
  if (!running) {
    updateActivityDisplay(0);
    _lastScreenshotAt = null;
    updateConnStatus();
  }
  // The lock outranks the normal running/stopped button logic above.
  if (_idleLocked) applyIdleLock(true);
}

// The main process is the single source of truth for elapsed time.
// It computes the total seconds on each tick and broadcasts to both
// the tray title and the renderer via IPC, keeping them perfectly in sync.
let _tickListenerRegistered = false;

function startTicking() {
  // Register the tick listener once; main process drives updates via timer-tick IPC
  if (!_tickListenerRegistered) {
    _tickListenerRegistered = true;
    window.trackflow.onTimerTick((data) => {
      // A tick flagged isPaused is the AUTHORITATIVE frozen value pushed by
      // renderIdleFreeze() — the tracked time as of the moment the user went idle.
      // Always apply it, and flip the UI to "Paused (idle)" if it isn't already.
      const pausedTick = data?.isPaused === true;
      // Any UNflagged tick that arrives while an idle decision is pending is a stale
      // live tick: its elapsed is measured to now, so it carries the idle window's own
      // duration. Dropping it is what stops idle minutes appearing in the total.
      if (!pausedTick && (!isRunning || isPaused)) return;
      elapsedSeconds = data.totalSeconds;
      timerDisplay.textContent = data.formatted;
      if (pausedTick && !isPaused) updateDisplay(false, true);
      // ISSUE 1 FIX: "Today, all projects" now reflects the running session live.
      // Prefer the live value (base sum + current session elapsed) computed by the
      // main process; fall back to the static server-synced sum for older payloads
      // (stop / sync / offline) that only carry todayTotalGlobal.
      updateTotalSum(
        data.todayTotalGlobalLive != null
          ? data.todayTotalGlobalLive
          : data.todayTotalGlobal
      );
      // Update activity and connection status from tick data
      if (data.activityScore != null) updateActivityDisplay(data.activityScore);
      if (data.lastScreenshotAt) _lastScreenshotAt = data.lastScreenshotAt;
      if (data.isOnline != null) _isOnline = data.isOnline;
      updateConnStatus();
    });
  }
}

function stopTicking() {
  // No interval to clear — main process stops sending ticks when timer stops
}

async function syncTimerState() {
  try {
    await loadProjects();
    const selectedProjectId = projectSelect.value || null;
    const state = await window.trackflow.getTimerState(selectedProjectId);
    todayTotalBase = state.todayTotal ?? 0;
    updateTotalSum(state.todayTotalGlobal);
    // Re-opened popup must come back LOCKED if an idle alert is still pending.
    applyIdleLock(state.idleLocked === true);
    // PAUSED OUTRANKS RUNNING. Main keeps `isRunning` true through an idle pause
    // (the entry is still open, just frozen), so testing isRunning first painted
    // "Tracking" and re-armed ticking mid-idle — the popup then walked forward
    // through the idle window. Check isPaused first so a re-opened / re-synced popup
    // renders "Paused (idle)" frozen at the idle-start elapsed main returns.
    if (state.isPaused) {
      setStartedAt(state.entry?.started_at || null);
      // NOTE: no calcElapsedFromStartedAt() fallback here — that measures to now and
      // would re-introduce the idle window. `state.elapsed` is already frozen at the
      // idle-start instant; 0 is the correct value when there is nothing to show.
      const currentElapsed = state.elapsed ?? 0;
      todayTotalBase = Math.max(0, todayTotalBase - currentElapsed);
      elapsedSeconds = todayTotalBase + currentElapsed;
      stopTicking();
      updateDisplay(false, true);
    } else if (state.isRunning) {
      setStartedAt(state.entry?.started_at || null);
      const currentElapsed = state.elapsed || calcElapsedFromStartedAt();
      todayTotalBase = Math.max(0, todayTotalBase - currentElapsed);
      elapsedSeconds = todayTotalBase + currentElapsed;
      updateDisplay(true, false);
      startTicking();
    } else {
      setStartedAt(null);
      stopTicking();
      elapsedSeconds = todayTotalBase;
      updateDisplay(false);
    }
    if (state.entry && state.entry.project_id) {
      projectSelect.value = state.entry.project_id;
    }
  } catch (e) {
    console.error('Failed to sync timer state:', e);
  }
}

let _loadProjectsInFlight = false;
async function loadProjects(retryCount = 0) {
  // Prevent concurrent calls from racing and duplicating options
  if (retryCount === 0 && _loadProjectsInFlight) return;
  if (retryCount === 0) _loadProjectsInFlight = true;
  const MAX_RETRIES = 3;
  try {
    const projects = await window.trackflow.getProjects();
    const list = Array.isArray(projects) ? projects
      : (projects?.data && Array.isArray(projects.data)) ? projects.data : [];

    // If we got an empty list and haven't exhausted retries, try again after a delay.
    // This handles the race where the API returns empty because the access token
    // is being refreshed during app startup.
    if (list.length === 0 && retryCount < MAX_RETRIES) {
      const delay = 1000 * (retryCount + 1);
      console.log(`[loadProjects] Empty list, retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      setTimeout(() => loadProjects(retryCount + 1), delay);
      return;
    }

    // OFFLINE FIX: Don't clear the dropdown if we got empty and already have options
    if (list.length === 0 && projectSelect.options.length > 1) {
      console.log('[loadProjects] Empty list but dropdown has options — keeping current');
      syncProjectSelectEnabled();
      _loadProjectsInFlight = false;
      return;
    }

    // Skip the rebuild when the project list is unchanged. loadProjects() runs on
    // init, every syncTimerState() (incl. the one fired right after a `change`),
    // polls and the projects-ready signal — rebuilding the <select> each time
    // destroys/recreates its <option>s. On Windows that disrupts an in-progress
    // selection (closes the native dropdown), so the user can never complete a
    // pick. Only rebuild when the set of project ids actually changed.
    const existingIds = Array.from(projectSelect.options)
      .map(o => o.value)
      .filter(v => v !== '');
    const newIds = list.map(p => String(p.id));
    const sameList = existingIds.length === newIds.length
      && existingIds.every((id, i) => id === newIds[i]);
    if (sameList && projectSelect.options.length > 1) {
      _loadProjectsInFlight = false;
      syncProjectSelectEnabled();
      updateStartBtnState();
      return;
    }

    const currentValue = projectSelect.value || '';
    projectSelect.innerHTML = '<option value="">Select a project</option>';
    _loadProjectsInFlight = false;
    list.forEach(p => {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.name;
      projectSelect.appendChild(option);
    });
    if (currentValue && list.some(p => String(p.id) === currentValue)) {
      projectSelect.value = currentValue;
    }
    // Re-enable the dropdown now that options exist. An earlier updateDisplay()
    // may have disabled it while the list was still loading, leaving it stuck
    // disabled/empty-looking even after projects arrived (the "doesn't load" bug).
    syncProjectSelectEnabled();
    updateStartBtnState();
  } catch (e) {
    console.error('[loadProjects] Failed:', e);
    // Retry on error (network issue, token refresh in progress)
    if (retryCount < MAX_RETRIES) {
      const delay = 1000 * (retryCount + 1);
      console.log(`[loadProjects] Error, retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      setTimeout(() => loadProjects(retryCount + 1), delay);
    } else {
      _loadProjectsInFlight = false;
    }
  }
}

// Keep the project dropdown enabled whenever the timer is stopped and the list
// has real options. Called after async project loads so a dropdown disabled by an
// earlier updateDisplay() (while the list was empty) gets re-enabled.
function syncProjectSelectEnabled() {
  projectSelect.disabled = _idleLocked || isRunning || isPaused || projectSelect.options.length <= 1;
}

// Disable Start button when no project selected
function updateStartBtnState() {
  if (_idleLocked) return; // Idle alert owns the controls — applyIdleLock decides
  if (isRunning) return; // Don't touch button state while running
  const hasProject = projectSelect.value && projectSelect.value !== '';
  startBtn.disabled = !hasProject;
  startBtn.style.opacity = hasProject ? '1' : '0.5';
  startBtn.style.cursor = hasProject ? 'pointer' : 'not-allowed';
  if (!hasProject) {
    startBtn.title = 'Select a project to start tracking';
  } else {
    startBtn.title = '';
  }
}

// ── Permission Banner Logic ──
function showPermissionBanner() {
  permissionBanner.style.display = 'flex';
}
function hidePermissionBanner() {
  permissionBanner.style.display = 'none';
}

// Check permission on load and show banner if needed
async function checkPermission() {
  try {
    const result = await window.trackflow.checkScreenPermission();
    if (result && !result.granted && result.platform === 'darwin') {
      showPermissionBanner();
    } else {
      hidePermissionBanner();
    }
  } catch {}
}

fixPermissionBtn.addEventListener('click', async () => {
  try {
    await window.trackflow.requestScreenPermission();
  } catch {}
});

// Listen for permission status updates from main process
window.trackflow.onPermissionStatus((data) => {
  if (data && data.granted === false) {
    showPermissionBanner();
  } else {
    hidePermissionBanner();
  }
});

// ── Wallpaper-Only Warning Banner Logic ──
function showWallpaperBanner() {
  wallpaperBanner.style.display = 'flex';
}
function hideWallpaperBanner() {
  wallpaperBanner.style.display = 'none';
}

fixWallpaperBtn.addEventListener('click', async () => {
  try {
    await window.trackflow.openScreenRecordingSettings();
  } catch {}
});

// Listen for wallpaper-only detection from main process
window.trackflow.onScreenshotPermissionIssue((data) => {
  if (data && data.type === 'wallpaper-detected') {
    console.log('[renderer] Wallpaper-only capture detected — showing warning banner');
    showWallpaperBanner();
  }
});

async function init() {
  await loadProjects();

  // Restore last selected project from persistent storage
  try {
    const lastProjectId = await window.trackflow.getLastProject();
    if (lastProjectId && !isRunning) {
      // Check the project still exists in the dropdown
      const optionExists = Array.from(projectSelect.options).some(o => o.value === lastProjectId);
      if (optionExists) {
        projectSelect.value = lastProjectId;
      }
    }
  } catch (e) {
    console.error('Failed to restore last project:', e);
  }

  await syncTimerState();
  updateStartBtnState();

  // Check screen recording permission on renderer init
  checkPermission();
  projectSelect.addEventListener('change', () => {
    // Persist the selected project so it survives logout/login and app restarts
    window.trackflow.setLastProject(projectSelect.value || null);
    updateStartBtnState();
    if (!isRunning) syncTimerState();
  });
}

startBtn.addEventListener('click', async () => {
  if (_idleLocked) return; // idle alert is waiting for an answer
  const projectId = projectSelect.value || null;
  if (!projectId) {
    // Safety check — button should already be disabled
    projectSelect.focus();
    return;
  }
  startBtn.disabled = true;
  startBtnText.textContent = 'Starting\u2026';
  try {
    const result = await window.trackflow.startTimer(projectId);
    if (result.success) {
      setStartedAt(result.entry?.started_at || new Date().toISOString());
      if (result.todayTotal > 0) todayTotalBase = result.todayTotal;
      elapsedSeconds = todayTotalBase;
      updateDisplay(true);
      startTicking();
    } else if (result.error) {
      showNotification(result.error);
    }
  } catch (e) {
    // Surface the underlying reason. A bare "Failed to start timer" is
    // indistinguishable between a thrown IPC error, a missing handler and a
    // storage fault, which is exactly the ambiguity that makes these reports
    // unactionable from a screenshot.
    const detail = (e && (e.message || String(e))) || '';
    showNotification(detail ? `Failed to start timer — ${detail}` : 'Failed to start timer');
    console.error('[Timer] start-timer threw:', e);
  }
  startBtnText.textContent = 'Start';
  updateStartBtnState();
});

let _stopInFlight = false; // RACE-FIX: Prevent rapid stop-start from overlapping
stopBtn.addEventListener('click', () => {
  if (_idleLocked) return; // idle alert is waiting for an answer
  if (_stopInFlight) return;
  _stopInFlight = true;
  stopTicking();
  const stoppedTotal = elapsedSeconds;
  setStartedAt(null);
  todayTotalBase = stoppedTotal;
  elapsedSeconds = stoppedTotal;
  updateDisplay(false);
  updateStartBtnState();
  window.trackflow.stopTimer().then((result) => {
    if (result && result.todayTotal > 0 && result.todayTotal !== stoppedTotal) {
      todayTotalBase = result.todayTotal;
      elapsedSeconds = result.todayTotal;
      updateDisplay(false);
    }
  }).catch(() => {}).finally(() => {
    _stopInFlight = false;
    // Converge the stopped display onto the server-authoritative total. The
    // synchronous paint above shows the last *live* tick (floored from the local
    // clock), which can sit 1s above the server's stored duration (the server
    // floors from its own received timestamps) — the "desktop 06:03 vs web 06:02"
    // remainder. get-timer-state does a fresh status fetch and, when stopped,
    // returns the server total; offline it falls back to the local total (never 0).
    syncTimerState();
  });
});

let _loggingOut = false;
async function handleLogout() {
  if (_loggingOut) return;
  _loggingOut = true;
  stopTicking();
  await window.trackflow.logout();
}
logoutLink.addEventListener('click', handleLogout);
logoutLink.title = `Sign out (${modKey}+Q)`;
dashboardLink.addEventListener('click', () => window.trackflow.openDashboard());

// ── Pin (Always on Top) Button Logic ──
// The custom hide-to-tray and sign-out buttons that used to sit beside this one
// are gone: the window now has NATIVE close/minimise/maximise, and closing hides
// to tray without stopping the timer. Sign out lives in the footer only.
const pinBtn = document.getElementById('pinBtn');

function updatePinUI(pinned) {
  if (pinned) {
    pinBtn.classList.add('pinned');
    pinBtn.title = 'Always on top — click to unpin';
  } else {
    pinBtn.classList.remove('pinned');
    pinBtn.title = 'Keep window on top of other apps';
  }
  pinBtn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
}

// Load initial pin state from main process
window.trackflow.getPinState().then((state) => {
  if (state) updatePinUI(state.pinned);
}).catch(() => {});

pinBtn.addEventListener('click', async () => {
  try {
    const result = await window.trackflow.togglePin();
    if (result) updatePinUI(result.pinned);
  } catch (e) {
    console.error('Failed to toggle pin:', e);
  }
});

// Listen for pin state changes from main process (e.g. tray menu toggle)
window.trackflow.onPinStateChanged((data) => {
  if (data) updatePinUI(data.pinned);
});

// Keyboard shortcuts — platform-aware
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.repeat) {
    e.preventDefault();
    if (isRunning) stopBtn.click(); else startBtn.click();
  }
  // Cmd/Ctrl+Q quits the app — the universal desktop meaning. It used to sign
  // the user out, which was tolerable for a throwaway tray popup and is not for
  // a normal window. Sign out is the footer link (and the tray menu).
  if ((e.ctrlKey || e.metaKey) && e.key === 'q') {
    e.preventDefault();
    window.trackflow.quitApp();
  }
  // Escape hides the window to the tray. It used to call window.blur() and rely
  // on the hide-on-blur handler, which no longer exists — so this was dead.
  if (e.key === 'Escape') window.trackflow.hideWindow();
});

// Events from main process
window.trackflow.onTimerStarted((data) => {
  // RACE-FIX: Discard stale notifications that arrive out of order.
  // This prevents an async follow-up from a previous stop overwriting
  // the UI after a new start has already updated it.
  if (data?._stateVersion != null && data._stateVersion < _lastStateVersion) {
    console.log(`[renderer] Ignoring stale timer-started (v${data._stateVersion} < current v${_lastStateVersion})`);
    return;
  }
  if (data?._stateVersion != null) _lastStateVersion = data._stateVersion;

  setStartedAt(data?.started_at || new Date().toISOString());
  if (data?.todayTotal > 0) todayTotalBase = data.todayTotal;
  elapsedSeconds = todayTotalBase + calcElapsedFromStartedAt();
  updateDisplay(true);
  startTicking();
});

if (window.trackflow.onTimerPaused) {
  window.trackflow.onTimerPaused((data) => {
    stopTicking();
    if (data?.entry?.started_at) setStartedAt(data.entry.started_at);
    if (data?.todayTotal != null) todayTotalBase = data.todayTotal;
    // Main always sends the frozen idle-start elapsed. Never fall back to
    // calcElapsedFromStartedAt() — it measures to now, which is exactly the idle
    // window's duration leaking back into the tracked total.
    const currentElapsed = data?.elapsed ?? 0;
    elapsedSeconds = todayTotalBase + currentElapsed;
    updateDisplay(false, true);
  });
}

if (window.trackflow.onTimerResumed) {
  window.trackflow.onTimerResumed((data) => {
    if (data?.started_at) setStartedAt(data.started_at);
    if (data?.todayTotal > 0) todayTotalBase = data.todayTotal;
    elapsedSeconds = todayTotalBase + calcElapsedFromStartedAt();
    updateDisplay(true, false);
    startTicking();
  });
}

window.trackflow.onTimerStopped((data) => {
  // RACE-FIX: Discard stale notifications that arrive out of order.
  if (data?._stateVersion != null && data._stateVersion < _lastStateVersion) {
    console.log(`[renderer] Ignoring stale timer-stopped (v${data._stateVersion} < current v${_lastStateVersion})`);
    return;
  }
  if (data?._stateVersion != null) _lastStateVersion = data._stateVersion;

  stopTicking();
  setStartedAt(null);
  if (data?.entry?.project_id) {
    projectSelect.value = data.entry.project_id;
    todayTotalBase = data.todayTotal ?? 0;
  } else if (data?.todayTotal !== undefined) {
    todayTotalBase = data.todayTotal;
  } else { syncTimerState(); return; }
  elapsedSeconds = todayTotalBase;
  updateTotalSum(data.todayTotalGlobal);
  updateDisplay(false);
});

window.trackflow.onSyncTimer(() => syncTimerState());

// When main process signals that projects are ready (e.g. after app init
// completes and API client has a valid token), reload the project list.
// This fixes the race where the renderer fetches projects before the
// main process has finished validating/refreshing the auth token.
window.trackflow.onProjectsReady(() => {
  console.log('[renderer] Received projects-ready signal — reloading projects');
  loadProjects();
});

// ── Update Dialog Logic ──
const updateOverlay = document.getElementById('updateOverlay');
const updateBody = document.getElementById('updateBody');
const updateRestartBtn = document.getElementById('updateRestartBtn');
const updateLaterBtn = document.getElementById('updateLaterBtn');
const updateBadge = document.getElementById('updateBadge');
let _pendingUpdateVersion = null;

function showUpdateDialog(version) {
  _pendingUpdateVersion = version;
  const isMacPlatform = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const permNote = isMacPlatform ? ' On macOS, you may need to re-grant screen recording permission after the update.' : '';
  updateBody.textContent = `TrackFlow v${version} is ready to install. Restart now to get the latest features and bug fixes.${permNote}`;
  updateOverlay.classList.add('visible');
  updateRestartBtn.focus();
}

function hideUpdateDialog() {
  updateOverlay.classList.remove('visible');
  // Show the badge so the user can reopen the dialog
  if (_pendingUpdateVersion) {
    updateBadge.classList.add('visible');
    updateBadge.title = `Update v${_pendingUpdateVersion} available \u2014 click to show`;
  }
}

updateRestartBtn.addEventListener('click', () => {
  updateRestartBtn.disabled = true;
  updateRestartBtn.textContent = 'Restarting\u2026';
  window.trackflow.installUpdate();
});

updateLaterBtn.addEventListener('click', () => {
  hideUpdateDialog();
});

updateBadge.addEventListener('click', () => {
  if (_pendingUpdateVersion) showUpdateDialog(_pendingUpdateVersion);
});

// Listen for update-ready IPC from main process
window.trackflow.onUpdateReady((data) => {
  if (data && data.version) {
    showUpdateDialog(data.version);
  }
});

// If quitAndInstall fails (e.g. unsigned macOS app), reset the button and
// show a message directing the user to download manually via the browser.
window.trackflow.onUpdateInstallFailed?.(() => {
  updateRestartBtn.disabled = false;
  updateRestartBtn.textContent = 'Download Manually';
  updateRestartBtn.onclick = () => {
    window.trackflow.installUpdate(); // opens releases page (already handled in main)
  };
  // Update the subtitle to explain what happened
  const desc = document.querySelector('.update-description');
  if (desc) {
    desc.textContent = 'Auto-install is not available on this system. The releases page has been opened — download and run the installer to update.';
  }
});

// ── Shift Info ──────────────────────────────────────────
function formatShiftTime(timeStr) {
  if (!timeStr) return '';
  return timeStr.substring(0, 5);
}

function updateShiftDisplay(shift) {
  const el = document.getElementById('shiftInfo');
  const nameEl = document.getElementById('shiftName');
  const timeEl = document.getElementById('shiftTime');
  if (!el) return;

  if (shift) {
    nameEl.textContent = shift.name;
    timeEl.textContent = `${formatShiftTime(shift.start_time)} - ${formatShiftTime(shift.end_time)}`;
    el.style.display = 'flex';
  } else {
    el.style.display = 'none';
  }
}

window.trackflow.getShiftInfo().then(data => {
  updateShiftDisplay(data?.shift);
}).catch(() => {});

window.trackflow.onShiftUpdate(data => {
  updateShiftDisplay(data?.shift);
});

window.addEventListener('error', (e) => console.error('Renderer error:', e.message));
window.addEventListener('unhandledrejection', (e) => console.error('Renderer unhandled rejection:', e.reason));

init();
