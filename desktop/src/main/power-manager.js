// Power Manager — suspend/resume/shutdown handlers (H2 refactor, M4 fix)
// Registered ONCE at app startup, never inside initializeApp().
// Reads from AppState so handlers always have current state.

const { powerMonitor } = require('electron');
const AppState = require('./app-state');

let _registered = false;

/**
 * Handle system suspend or screen lock.
 * Pauses screenshot and activity capture, sends final heartbeat.
 */
function handleSuspend() {
  if (!AppState.isTimerRunning) return;
  AppState._suspendedAt = Date.now();
  console.log('[power] Suspended/locked -- pausing capture');
  if (AppState.activityMonitor) {
    AppState.activityMonitor.sendFinalHeartbeat().catch(() => {});
    AppState.activityMonitor.stop();
  }
  AppState.screenshotService?.stop();
}

/**
 * Handle system resume or screen unlock.
 * Caller must provide callbacks for idle handling since those depend on UI logic.
 */
function handleResume(callbacks = {}) {
  const { onLongSleep, onShortSleep, onAlreadyIdle } = callbacks;

  if (!AppState.isTimerRunning || !AppState._suspendedAt) {
    AppState._suspendedAt = null;
    return;
  }
  const sleepDurationSec = Math.floor((Date.now() - AppState._suspendedAt) / 1000);
  const sleepStartedAt = AppState._suspendedAt;
  AppState._suspendedAt = null;
  console.log(`[power] Resumed/unlocked after ${sleepDurationSec}s`);

  if (AppState.idleDetector?.isIdle && AppState.idleDetector.idleStartedAt) {
    if (onAlreadyIdle) onAlreadyIdle(sleepStartedAt);
    return;
  }

  const idleThresholdSec = AppState.idleDetector?.idleTimeoutSec || (AppState.config.idle_timeout || 5) * 60;

  if (sleepDurationSec >= idleThresholdSec) {
    if (onLongSleep) onLongSleep(sleepDurationSec, sleepStartedAt);
  } else {
    if (onShortSleep) onShortSleep();
  }
}

/**
 * Register power event listeners ONCE at app startup.
 * M4 FIX: Defensive removeAllListeners before adding to prevent stacking.
 */
function registerPowerHandlers(resumeCallbacks = {}) {
  if (_registered) return;
  _registered = true;

  // M4 FIX: Remove any existing listeners defensively
  powerMonitor.removeAllListeners('suspend');
  powerMonitor.removeAllListeners('resume');
  powerMonitor.removeAllListeners('lock-screen');
  powerMonitor.removeAllListeners('unlock-screen');

  powerMonitor.on('suspend', handleSuspend);
  powerMonitor.on('resume', () => handleResume(resumeCallbacks));
  powerMonitor.on('lock-screen', handleSuspend);
  powerMonitor.on('unlock-screen', () => handleResume(resumeCallbacks));

  console.log('[PowerManager] Handlers registered once');
}

module.exports = {
  handleSuspend,
  handleResume,
  registerPowerHandlers,
};
