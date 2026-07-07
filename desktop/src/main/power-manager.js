// Power Manager — sleep/lock/shutdown auto-stop and startup gap detection.
// Registered from initializeApp(); uses callbacks so timer/UI logic stays in index.js.

const { powerMonitor, Notification } = require('electron');

const DEFAULT_GAP_THRESHOLD_SEC = 180; // 3 minutes

let _registered = false;
let _suspendedAt = null;
let _callbacks = null;
// Coalesce the back-to-back power events a single lid-close emits. macOS (and
// Windows) fire BOTH 'lock-screen' and 'suspend' for one lid-close, a tick apart.
// Without this guard each event runs autoStopForPowerEvent and shows its own
// "auto-stopped" toast, so the user sees two notifications for one real stop
// (the timer itself is protected by the stopTimer mutex, but the toast is not).
// Reset on resume (next sleep cycle) and via a short fallback timeout.
let _autoStopInFlight = false;
let _autoStopResetTimer = null;

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
  _autoStopInFlight = false;
  if (_autoStopResetTimer) {
    clearTimeout(_autoStopResetTimer);
    _autoStopResetTimer = null;
  }
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

  // A lid-close fires 'lock-screen' + 'suspend' back-to-back. isTimerRunning() is
  // still true when the second event arrives (it only flips deep inside the async
  // stopTimer), so without this guard both events auto-stop and both toast. Let the
  // first event own the stop + notification; ignore the trailing one.
  if (_autoStopInFlight) {
    console.log(`[power] ${reason} ignored — auto-stop already in progress from a paired power event`);
    return;
  }
  _autoStopInFlight = true;
  // Fallback reset in case 'resume'/'unlock-screen' never fires (defensive).
  if (_autoStopResetTimer) clearTimeout(_autoStopResetTimer);
  _autoStopResetTimer = setTimeout(() => { _autoStopInFlight = false; }, 10_000);

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
  // New sleep/lock cycle begins — clear the paired-event coalescing guard.
  _autoStopInFlight = false;
  if (_autoStopResetTimer) {
    clearTimeout(_autoStopResetTimer);
    _autoStopResetTimer = null;
  }
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
  const hours24 = date.getHours();
  const h = hours24 % 12 || 12;
  const m = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours24 >= 12 ? 'PM' : 'AM';
  return `${h}:${m} ${ampm}`;
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
