// idle-alert.js — Idle alert renderer logic
//
// Communicates with the main process via the preload bridge (window.trackflow).
// Tracks the idle detector's actionId to prevent stale actions from being sent
// back when the user responds after auto-stop has already fired.

// ── OS Theme Detection ──
function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}
window.trackflow.getTheme().then(applyTheme).catch(() => {});
window.trackflow.onThemeChange(applyTheme);

const idleTimeEl = document.getElementById('idleTime');
let idleStartMs = Date.now();
let tickInterval = null;

// The idle detector action ID for the current idle cycle.
// Passed back to the main process on resolve to prevent stale actions.
let currentActionId = null;

// Guard against double-sends (e.g., keyboard shortcut + button click)
let actionSent = false;

// Auto-stop countdown state
let autoStopTotalSec = 0; // total seconds from idle start to auto-stop
let autoStopBar = document.getElementById('autoStopBar');
let autoStopCountdownEl = document.getElementById('autoStopCountdown');

function formatIdleTime(seconds) {
  // Guard against negative or absurdly large values (>99h would overflow display)
  if (seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function formatCountdown(seconds) {
  if (seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function startTicking() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - idleStartMs) / 1000);
    idleTimeEl.textContent = formatIdleTime(elapsed);

    // Update auto-stop countdown if configured
    if (autoStopTotalSec > 0 && autoStopBar && autoStopCountdownEl) {
      const remaining = autoStopTotalSec - elapsed;
      if (remaining > 0) {
        autoStopBar.style.display = '';
        autoStopCountdownEl.textContent = formatCountdown(remaining);
      } else {
        autoStopCountdownEl.textContent = '0:00';
      }
    }
  }, 1000);
}

let projects = [];

window.trackflow.onIdleData((data) => {
  if (data.idleStartedAt) idleStartMs = data.idleStartedAt;
  if (data.actionId != null) currentActionId = data.actionId;

  // Reset actionSent when new idle data arrives (e.g., resume after suspend
  // extends the idle period and sends updated data to an existing window)
  actionSent = false;
  enableAllButtons();

  const elapsed = Math.floor((Date.now() - idleStartMs) / 1000);
  idleTimeEl.textContent = formatIdleTime(elapsed);

  // Configure auto-stop countdown
  // autoStopTotalSec = idleTimeoutSec + alertAutoStopSec (total from idle start)
  if (data.autoStopTotalSec && data.autoStopTotalSec > 0) {
    autoStopTotalSec = data.autoStopTotalSec;
    const remaining = autoStopTotalSec - elapsed;
    if (remaining > 0 && autoStopBar && autoStopCountdownEl) {
      autoStopBar.style.display = '';
      autoStopCountdownEl.textContent = formatCountdown(remaining);
    }
  }

  startTicking();

  if (Array.isArray(data.projects)) {
    projects = data.projects;
    const sel = document.getElementById('reassignProject');
    sel.innerHTML = '<option value="">Reassign to project\u2026</option>';
    projects.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name || p.id;
      sel.appendChild(opt);
    });
  }
});

document.getElementById('reassignProject').addEventListener('change', function () {
  document.getElementById('reassignBtn').disabled = !this.value;
});

function disableAllButtons() {
  ['keepBtn', 'discardBtn', 'reassignBtn', 'stopBtn'].forEach(id => {
    document.getElementById(id).disabled = true;
  });
}

function enableAllButtons() {
  ['keepBtn', 'discardBtn', 'stopBtn'].forEach(id => {
    document.getElementById(id).disabled = false;
  });
  // Reassign stays disabled unless a project is selected
  document.getElementById('reassignBtn').disabled = !document.getElementById('reassignProject').value;
}

function sendAction(action, projectId) {
  if (actionSent) return; // Prevent double-send
  actionSent = true;
  disableAllButtons();
  window.trackflow.resolveIdle(action, projectId || null, currentActionId);
}

document.getElementById('keepBtn').addEventListener('click', () => sendAction('keep'));
document.getElementById('discardBtn').addEventListener('click', () => sendAction('discard'));
document.getElementById('reassignBtn').addEventListener('click', () => {
  const projectId = document.getElementById('reassignProject').value;
  if (projectId) sendAction('reassign', projectId);
});
document.getElementById('stopBtn').addEventListener('click', () => sendAction('stop'));

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (actionSent) return;
  // Don't trigger shortcuts when the select dropdown is focused
  if (document.activeElement && document.activeElement.tagName === 'SELECT') {
    if (e.key.toLowerCase() !== 'r') return;
  }
  switch (e.key.toLowerCase()) {
    case 'k': document.getElementById('keepBtn').click(); break;
    case 'd': document.getElementById('discardBtn').click(); break;
    case 's': document.getElementById('stopBtn').click(); break;
    case 'r':
      const sel = document.getElementById('reassignProject');
      if (sel.value) document.getElementById('reassignBtn').click();
      else sel.focus();
      break;
  }
});

window.addEventListener('beforeunload', () => {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
});

window.addEventListener('error', (e) => console.error('Idle alert renderer error:', e.message));
