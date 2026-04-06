// ── Theme: always light for the timer window (white background per design) ──
document.documentElement.setAttribute('data-theme', 'light');
// No-op theme listeners — timer window is always light regardless of OS theme
window.trackflow.getTheme().catch(() => {});
window.trackflow.onThemeChange(() => {});

// ── Platform detection for shortcut labels ──
const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
const modKey = isMac ? 'Cmd' : 'Ctrl';

// Apply shortcut hints
document.getElementById('logoutBtn').title = `Sign out (${modKey}+Q)`;

let elapsedSeconds = 0;
let todayTotalBase = 0;
let isRunning = false;
let currentStartedAt = null;
let _startedAtMs = null;

function showNotification(msg) {
  const el = document.createElement('div');
  el.className = 'notification';
  el.textContent = msg;
  el.setAttribute('role', 'alert');
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3000);
}

const timerDisplay = document.getElementById('timerDisplay');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const startBtn = document.getElementById('startBtn');
const startBtnText = document.getElementById('startBtnText');
const stopBtn = document.getElementById('stopBtn');
const projectSelect = document.getElementById('projectSelect');
const logoutBtn = document.getElementById('logoutBtn');
const logoutLink = document.getElementById('logoutLink');
const dashboardLink = document.getElementById('dashboardLink');
const permissionBanner = document.getElementById('permissionBanner');
const fixPermissionBtn = document.getElementById('fixPermissionBtn');
const wallpaperBanner = document.getElementById('wallpaperBanner');
const fixWallpaperBtn = document.getElementById('fixWallpaperBtn');
const offlineBanner = document.getElementById('offlineBanner');

// CONNECTIVITY FIX: Network status indicator
window.trackflow.getNetworkStatus().then((status) => {
  if (offlineBanner) offlineBanner.style.display = status.online ? 'none' : 'flex';
}).catch(() => {});
window.trackflow.onNetworkStatus((data) => {
  if (offlineBanner) offlineBanner.style.display = data.online ? 'none' : 'flex';
});

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

function updateDisplay(running) {
  isRunning = running;
  timerDisplay.textContent = formatTime(elapsedSeconds);
  timerDisplay.className = `time ${running ? 'running' : 'stopped'}`;
  statusDot.className = `dot ${running ? 'green' : 'gray'}`;
  statusText.textContent = running ? 'Tracking' : (todayTotalBase > 0 ? 'Today\u2019s Total' : 'Stopped');
  startBtn.style.display = running ? 'none' : 'flex';
  stopBtn.style.display = running ? 'flex' : 'none';
  projectSelect.disabled = running || projectSelect.options.length <= 1;
  startBtn.disabled = isRunning;
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
      if (!isRunning) return;
      elapsedSeconds = data.totalSeconds;
      timerDisplay.textContent = data.formatted;
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
    if (state.isRunning) {
      setStartedAt(state.entry?.started_at || null);
      const currentElapsed = state.elapsed || calcElapsedFromStartedAt();
      todayTotalBase = Math.max(0, todayTotalBase - currentElapsed);
      elapsedSeconds = todayTotalBase + currentElapsed;
      updateDisplay(true);
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

async function loadProjects(retryCount = 0) {
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

    const currentValue = projectSelect.value || '';
    projectSelect.innerHTML = '<option value="">Select a project</option>';
    list.forEach(p => {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.name;
      projectSelect.appendChild(option);
    });
    if (currentValue && list.some(p => String(p.id) === currentValue)) {
      projectSelect.value = currentValue;
    }
    updateStartBtnState();
  } catch (e) {
    console.error('[loadProjects] Failed:', e);
    // Retry on error (network issue, token refresh in progress)
    if (retryCount < MAX_RETRIES) {
      const delay = 1000 * (retryCount + 1);
      console.log(`[loadProjects] Error, retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      setTimeout(() => loadProjects(retryCount + 1), delay);
    }
  }
}

// Disable Start button when no project selected
function updateStartBtnState() {
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
    showNotification('Failed to start timer');
  }
  startBtnText.textContent = 'Start';
  updateStartBtnState();
});

stopBtn.addEventListener('click', () => {
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
  }).catch(() => {});
});

async function handleLogout() {
  logoutBtn.disabled = true;
  stopTicking();
  await window.trackflow.logout();
}
logoutBtn.addEventListener('click', handleLogout);
logoutLink.addEventListener('click', handleLogout);
dashboardLink.addEventListener('click', () => window.trackflow.openDashboard());

// Hide button — dismiss window to tray without logging out
document.getElementById('hideBtn').addEventListener('click', () => {
  window.trackflow.hideWindow();
});

// ── Pin (Always on Top) Button Logic ──
const pinBtn = document.getElementById('pinBtn');

function updatePinUI(pinned) {
  if (pinned) {
    pinBtn.classList.add('pinned');
    pinBtn.title = 'Always on top (pinned)';
  } else {
    pinBtn.classList.remove('pinned');
    pinBtn.title = 'Pin window on top';
  }
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
  if ((e.ctrlKey || e.metaKey) && e.key === 'q') {
    e.preventDefault();
    handleLogout();
  }
  if (e.key === 'Escape') window.blur();
});

// Events from main process
window.trackflow.onTimerStarted((data) => {
  setStartedAt(data?.started_at || new Date().toISOString());
  if (data?.todayTotal > 0) todayTotalBase = data.todayTotal;
  elapsedSeconds = todayTotalBase + calcElapsedFromStartedAt();
  updateDisplay(true);
  startTicking();
});

window.trackflow.onTimerStopped((data) => {
  stopTicking();
  setStartedAt(null);
  if (data?.entry?.project_id) {
    projectSelect.value = data.entry.project_id;
    todayTotalBase = data.todayTotal ?? 0;
  } else if (data?.todayTotal !== undefined) {
    todayTotalBase = data.todayTotal;
  } else { syncTimerState(); return; }
  elapsedSeconds = todayTotalBase;
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
  updateBody.textContent = `TrackFlow v${version} is ready to install. Restart now to get the latest features and bug fixes.`;
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

window.addEventListener('error', (e) => console.error('Renderer error:', e.message));
window.addEventListener('unhandledrejection', (e) => console.error('Renderer unhandled rejection:', e.reason));

init();
