// Power Manager — sleep/lock/shutdown auto-stop and startup gap detection.
// Registered from initializeApp(); uses callbacks so timer/UI logic stays in index.js.

const { powerMonitor, Notification } = require('electron');

const DEFAULT_GAP_THRESHOLD_SEC = 180; // 3 minutes

let _registered = false;
let _suspendedAt = null;
let _callbacks = null;

/**
 * @param {object} callbacks
 * @param {() => boolean} callbacks.isTimerRunning
 * @param {() => Promise<void>} callbacks.autoStopForPowerEvent - async (reason, endedAtMs)
 * @param {() => void} callbacks.onResumeAfterSleep - optional; timer already stopped on suspend
 * @param {() => void} callbacks.removeListeners - unregister power handlers (logout)
 */
function registerPowerHandlers(callbacks) {
  if (_registered) {
    unregisterPowerHandlers();
  }
  _registered = true;
  _callbacks = callbacks;

  powerMonitor.removeAllListeners('suspend');
  powerMonitor.removeAllListeners('resume');
  powerMonitor.removeAllListeners('lock-screen');
  powerMonitor.removeAllListeners('unlock-screen');

  powerMonitor.on('suspend', () => handleSuspend('sleep'));
  powerMonitor.on('lock-screen', () => handleSuspend('lock-screen'));
  powerMonitor.on('resume', handleResume);
  powerMonitor.on('unlock-screen', handleResume);

  console.log('[PowerManager] Handlers registered (hard auto-stop on suspend/lock)');
}

function unregisterPowerHandlers() {
  powerMonitor.removeAllListeners('suspend');
  powerMonitor.removeAllListeners('resume');
  powerMonitor.removeAllListeners('lock-screen');
  powerMonitor.removeAllListeners('unlock-screen');
  _registered = false;
  _suspendedAt = null;
  _callbacks = null;
}

async function handleSuspend(reason) {
  // FIX D5: Always tear down idle state on suspend, even if the timer isn't running
  // (defensive — a detached/armed idle detector must never survive a power event and
  // fire a spurious auto-stop / bogus idle_discard on wake). Runs before the
  // isTimerRunning short-circuit below.
  try {
    _callbacks?.onSuspendCleanup?.();
  } catch (e) {
    console.error('[power] onSuspendCleanup failed:', e.message);
  }

  if (!_callbacks?.isTimerRunning?.()) return;
  const endedAtMs = Date.now();
  _suspendedAt = endedAtMs;
  console.log(`[power] ${reason} — auto-stopping timer at ${new Date(endedAtMs).toISOString()}`);
  try {
    await _callbacks.autoStopForPowerEvent(reason, endedAtMs);
  } catch (e) {
    console.error('[power] auto-stop failed:', e.message);
  }
}

function handleResume() {
  if (_suspendedAt) {
    const sleepSec = Math.floor((Date.now() - _suspendedAt) / 1000);
    console.log(`[power] Resumed after ${sleepSec}s — timer remains stopped (hard auto-stop policy)`);
    _suspendedAt = null;
  }
  _callbacks?.onResumeAfterSleep?.();
}

/**
 * Pure gap-detection logic for unit tests.
 * @returns {{ shouldClose: boolean, stopAtMs: number|null, gapSec: number }}
 */
function evaluateStartupGap({ lastActiveAtMs, nowMs, gapThresholdSec, hasOpenSession }) {
  if (!hasOpenSession || !lastActiveAtMs) {
    return { shouldClose: false, stopAtMs: null, gapSec: 0 };
  }
  const gapSec = Math.floor((nowMs - lastActiveAtMs) / 1000);
  if (gapSec > gapThresholdSec) {
    return { shouldClose: true, stopAtMs: lastActiveAtMs, gapSec };
  }
  return { shouldClose: false, stopAtMs: null, gapSec };
}

function formatTimeShortLocal(date) {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function showAutoStopNotification(title, body) {
  try {
    if (Notification.isSupported()) {
      const n = new Notification({ title, body, silent: false });
      n.show();
    }
  } catch (e) {
    console.warn('[power] Notification failed:', e.message);
  }
}

module.exports = {
  registerPowerHandlers,
  unregisterPowerHandlers,
  evaluateStartupGap,
  showAutoStopNotification,
  formatTimeShortLocal,
  DEFAULT_GAP_THRESHOLD_SEC,
};
