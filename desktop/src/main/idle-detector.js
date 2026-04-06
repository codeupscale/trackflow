// Idle Detection Service — State Machine Implementation
//
// States:
//   STOPPED    — detector is off (timer not running or explicitly stopped)
//   WATCHING   — timer running, monitoring system idle time
//   DETECTED   — idle threshold exceeded, waiting for alert to show
//   ALERTING   — popup is visible, counting idle time, checking auto-stop
//   SUSPENDED  — laptop is asleep / screen locked, intervals paused
//   RESOLVED   — action was taken, transitioning back to WATCHING
//
// Transitions:
//   STOPPED    → WATCHING   : start()
//   WATCHING   → DETECTED   : _check() finds idle >= threshold
//   DETECTED   → ALERTING   : after onIdleDetected callback fires
//   ALERTING   → RESOLVED   : user clicks action OR auto-stop fires
//   RESOLVED   → WATCHING   : after cooldown reset, resume monitoring
//   ANY        → SUSPENDED  : suspend()
//   SUSPENDED  → WATCHING   : resume() (caller decides whether to show alert)
//   ANY        → STOPPED    : stop()
//
// Invalid transitions are logged and ignored, preventing double-actions.

const { powerMonitor } = require('electron');

const DEFAULT_IDLE_TIMEOUT_MIN = 5;
const DEFAULT_IDLE_CHECK_INTERVAL_SEC = 10;

const IDLE_STATE = Object.freeze({
  STOPPED: 'STOPPED',
  WATCHING: 'WATCHING',
  DETECTED: 'DETECTED',
  ALERTING: 'ALERTING',
  SUSPENDED: 'SUSPENDED',
  RESOLVED: 'RESOLVED',
});

class IdleDetector {
  constructor(config = {}) {
    this._state = IDLE_STATE.STOPPED;
    this._applyConfig(config);
    this.checkInterval = null;
    this.idleStartedAt = null;
    this.alertShownAt = null;

    // Cooldown: after idle is resolved, suppress re-detection until the user
    // has provided new input (system idle time drops below threshold).
    this._lastResolvedAt = null;

    // Monotonic action ID — incremented on each idle detection cycle.
    // Passed to callbacks so the caller can detect stale/duplicate actions.
    this._actionId = 0;

    // Callbacks — set by main process
    this._onIdleDetected = null;   // (idleSeconds, idleStartedAt, actionId) => void
    this._onAutoStop = null;       // (totalIdleSeconds, actionId) => void
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  get state() { return this._state; }

  onIdleDetected(callback) { this._onIdleDetected = callback; }
  onAutoStop(callback) { this._onAutoStop = callback; }

  updateConfig(config) {
    this._applyConfig(config);
  }

  /**
   * Start monitoring. Only valid from STOPPED state.
   * Resets all internal state for a fresh monitoring session.
   */
  start() {
    if (!this.enabled) return;
    const previousState = this._state;
    // Allow start from STOPPED or RESOLVED (re-arm after action)
    if (previousState !== IDLE_STATE.STOPPED && previousState !== IDLE_STATE.RESOLVED) {
      console.warn(`[IdleDetector] start() called in state ${previousState} — stopping first`);
      this._clearInterval();
    }

    this._state = IDLE_STATE.WATCHING;
    this.idleStartedAt = null;
    this.alertShownAt = null;

    // Only reset cooldown when starting from a fully stopped state (e.g., new
    // timer session). When re-arming after resolveIdle (RESOLVED state), preserve
    // the cooldown so _check() waits for fresh user input before re-detecting.
    // Without this, starting from RESOLVED with the system still idle causes
    // immediate re-detection (the user hasn't actually returned yet).
    if (previousState === IDLE_STATE.STOPPED) {
      this._lastResolvedAt = null;
    }

    this._clearInterval();
    this.checkInterval = setInterval(() => this._check(), this.checkIntervalMs);
  }

  /**
   * Fully stop the detector. Clears all state and intervals.
   * Valid from any state.
   */
  stop() {
    this._clearInterval();
    this._state = IDLE_STATE.STOPPED;
    this.idleStartedAt = null;
    this.alertShownAt = null;
  }

  /**
   * Notify the detector that the system is suspending (sleep/lock).
   * Pauses the check interval but preserves idle state so handleResume
   * can inspect it.
   *
   * Returns a snapshot of the current idle state for the caller.
   */
  suspend() {
    const snapshot = {
      previousState: this._state,
      isIdle: this._state === IDLE_STATE.ALERTING || this._state === IDLE_STATE.DETECTED,
      idleStartedAt: this.idleStartedAt,
    };

    // Clear interval to prevent _check() from firing on resume before
    // the main process has had a chance to run handleResume.
    this._clearInterval();
    this._state = IDLE_STATE.SUSPENDED;

    return snapshot;
  }

  /**
   * Notify the detector that the system has resumed.
   * Does NOT restart the check interval — the caller must call start()
   * or setAlertState() depending on whether they want to show an alert.
   */
  resume() {
    if (this._state !== IDLE_STATE.SUSPENDED) {
      console.warn(`[IdleDetector] resume() called in state ${this._state} — ignoring`);
      return;
    }
    // Transition to STOPPED; caller will call start() or setAlertState()
    this._state = IDLE_STATE.STOPPED;
  }

  /**
   * Externally set the detector into ALERTING state with a specific
   * idleStartedAt time. Used by handleResume when sleep duration exceeds
   * threshold and the caller wants to show an alert.
   *
   * Also starts the check interval so auto-stop can fire.
   */
  setAlertState(idleStartedAt) {
    this._clearInterval();
    this._actionId++;
    this._state = IDLE_STATE.ALERTING;
    this.idleStartedAt = idleStartedAt;
    this.alertShownAt = Date.now();

    // Start check interval so auto-stop can fire while alert is showing
    if (this.alertAutoStopSec > 0) {
      this.checkInterval = setInterval(() => this._checkAutoStop(), this.checkIntervalMs);
    }

    return this._actionId;
  }

  /**
   * Called when the user responds to the idle alert or auto-stop fires.
   * Transitions from ALERTING → RESOLVED.
   *
   * @param {number} actionId — must match the current _actionId to prevent
   *   stale actions from a previous idle cycle.
   * @returns {object|null} — idle info if action was valid, null if stale/invalid.
   */
  resolveIdle(actionId = null) {
    // Guard: only resolve from ALERTING state
    if (this._state !== IDLE_STATE.ALERTING && this._state !== IDLE_STATE.DETECTED) {
      console.warn(`[IdleDetector] resolveIdle() called in state ${this._state} — ignoring`);
      return null;
    }

    // Guard: stale action ID (e.g., user clicked after auto-stop already fired)
    if (actionId !== null && actionId !== this._actionId) {
      console.warn(`[IdleDetector] resolveIdle() stale actionId ${actionId} (current: ${this._actionId}) — ignoring`);
      return null;
    }

    const info = {
      idleStartedAt: this.idleStartedAt,
      idleDuration: this.getIdleDuration(),
    };

    this._clearInterval();
    this._state = IDLE_STATE.RESOLVED;
    this._lastResolvedAt = Date.now();
    this.idleStartedAt = null;
    this.alertShownAt = null;

    return info;
  }

  /**
   * Get current idle duration in seconds.
   */
  getIdleDuration() {
    if (!this.idleStartedAt) return 0;
    return Math.floor((Date.now() - this.idleStartedAt) / 1000);
  }

  /**
   * Whether the detector is currently in a state where an idle alert
   * is being shown or should be shown.
   */
  isShowingAlert() {
    return this._state === IDLE_STATE.ALERTING;
  }

  /**
   * Whether idle has been detected but not yet fully resolved.
   */
  isIdleActive() {
    return this._state === IDLE_STATE.ALERTING || this._state === IDLE_STATE.DETECTED;
  }

  /**
   * Get the current action ID. Used by the caller to pass to resolveIdle()
   * for stale-action detection.
   */
  getActionId() {
    return this._actionId;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  _applyConfig(config) {
    const timeout = config.idle_timeout != null ? config.idle_timeout : DEFAULT_IDLE_TIMEOUT_MIN;
    this.idleTimeoutSec = timeout > 0 ? timeout * 60 : 0;
    const autoStopMin = config.idle_alert_auto_stop_min != null ? config.idle_alert_auto_stop_min : 10;
    this.alertAutoStopSec = autoStopMin > 0 ? autoStopMin * 60 : 0;
    const checkSec = config.idle_check_interval_sec != null ? config.idle_check_interval_sec : DEFAULT_IDLE_CHECK_INTERVAL_SEC;
    this.checkIntervalMs = Math.min(60, Math.max(1, checkSec)) * 1000;
    this.enabled = config.idle_detection !== false && this.idleTimeoutSec > 0;
  }

  _clearInterval() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Main check loop — only runs in WATCHING state.
   * Detects when the user crosses the idle threshold.
   */
  _check() {
    // Only detect idle while in WATCHING state
    if (this._state !== IDLE_STATE.WATCHING) return;

    const systemIdleSec = powerMonitor.getSystemIdleTime();

    // Cooldown: after resolution, wait for fresh user input before re-detecting
    if (this._lastResolvedAt) {
      if (systemIdleSec < this.idleTimeoutSec) {
        this._lastResolvedAt = null; // Fresh input — resume detection
      } else {
        return; // Still idle from before resolution
      }
    }

    if (systemIdleSec >= this.idleTimeoutSec) {
      // Idle threshold crossed — transition to DETECTED
      this._state = IDLE_STATE.DETECTED;
      this._actionId++;
      this.idleStartedAt = Date.now() - (systemIdleSec * 1000);
      this.alertShownAt = Date.now();

      // Stop the WATCHING interval — we will start a different interval
      // (auto-stop check) once the alert is confirmed shown
      this._clearInterval();

      if (this._onIdleDetected) {
        this._onIdleDetected(systemIdleSec, this.idleStartedAt, this._actionId);
      }

      // Transition to ALERTING after callback (caller should show alert)
      // Start auto-stop check interval
      this._state = IDLE_STATE.ALERTING;
      if (this.alertAutoStopSec > 0) {
        this.checkInterval = setInterval(() => this._checkAutoStop(), this.checkIntervalMs);
      }
    }
  }

  /**
   * Auto-stop check — only runs in ALERTING state.
   * Fires the auto-stop callback when the alert has been shown for longer
   * than alertAutoStopSec. Uses alertShownAt (not idleStartedAt) so that
   * long sleeps don't cause immediate auto-stop before the user sees the popup.
   *
   * Previously this compared total idle time (Date.now() - idleStartedAt)
   * against idleTimeoutSec + alertAutoStopSec, which caused a bug: after a
   * long sleep (> idle + autoStop threshold), the first _checkAutoStop tick
   * would fire auto-stop immediately — before showIdleAlert() had finished
   * creating the BrowserWindow. The user's timer was stopped without them
   * ever seeing the idle alert.
   */
  _checkAutoStop() {
    if (this._state !== IDLE_STATE.ALERTING) {
      this._clearInterval();
      return;
    }

    if (!this.alertShownAt) {
      this._clearInterval();
      return;
    }

    const alertDurationSec = (Date.now() - this.alertShownAt) / 1000;
    if (alertDurationSec >= this.alertAutoStopSec) {
      const totalIdleDuration = this.idleStartedAt
        ? Math.floor((Date.now() - this.idleStartedAt) / 1000)
        : Math.floor(alertDurationSec);
      const actionId = this._actionId;
      // Fire auto-stop BEFORE resolving, so the callback can read idleStartedAt
      if (this._onAutoStop) {
        this._onAutoStop(totalIdleDuration, actionId);
      }
      // Auto-resolve (the callback should also call resolveIdle, but
      // we do it here defensively in case the callback doesn't)
      if (this._state === IDLE_STATE.ALERTING) {
        this.resolveIdle(actionId);
      }
    }
  }
}

// Export both the class and the state enum
module.exports = IdleDetector;
module.exports.IDLE_STATE = IDLE_STATE;
