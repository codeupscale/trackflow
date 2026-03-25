// idle-alert.js — Idle alert renderer logic (extracted from inline script)

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

function formatIdleTime(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function startTicking() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - idleStartMs) / 1000);
    idleTimeEl.textContent = formatIdleTime(elapsed);
  }, 1000);
}

let projects = [];

window.trackflow.onIdleData((data) => {
  if (data.idleStartedAt) idleStartMs = data.idleStartedAt;
  const elapsed = Math.floor((Date.now() - idleStartMs) / 1000);
  idleTimeEl.textContent = formatIdleTime(elapsed);
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

document.getElementById('keepBtn').addEventListener('click', () => window.trackflow.resolveIdle('keep'));
document.getElementById('discardBtn').addEventListener('click', () => window.trackflow.resolveIdle('discard'));
document.getElementById('reassignBtn').addEventListener('click', () => {
  const projectId = document.getElementById('reassignProject').value;
  if (projectId) window.trackflow.resolveIdle('reassign', projectId);
});
document.getElementById('stopBtn').addEventListener('click', () => window.trackflow.resolveIdle('stop'));

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.repeat) return;
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
