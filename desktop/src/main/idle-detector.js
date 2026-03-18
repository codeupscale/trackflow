// Idle Detection Service
// Monitors user activity and triggers idle alerts like Hubstaff
//
// Architecture:
//   ActivityMonitor tracks raw input events (keyboard/mouse counts).
//   IdleDetector runs a separate check loop that queries the OS-level
//   idle time (seconds since last input). When idle exceeds the configured
//   threshold it emits 'idle' / 'idle-resolved' events via a callback
//   interface so the main process can show/dismiss the idle alert window.
//
// Hubstaff behavior replicated:
//   1. Idle threshold (default 5 min) — configurable per org
//   2. Alert popup with 3 choices: keep time, discard idle, stop timer
//   3. Auto-stop after extended idle (alert timeout, default 10 min)
//   4. Tracks exact idle start time for accurate time deduction

const { powerMonitor } = require('electron');

const DEFAULT_IDLE_TIMEOUT_MIN = 5;
const DEFAULT_IDLE_CHECK_INTERVAL_SEC = 10;

class IdleDetector {
  constructor(config = {}) {
    const timeout = config.idle_timeout != null ? config.idle_timeout : DEFAULT_IDLE_TIMEOUT_MIN;
    this.idleTimeoutSec = timeout > 0 ? timeout * 60 : 0;
    const autoStopMin = config.idle_alert_auto_stop_min != null ? config.idle_alert_auto_stop_min : 10;
    this.alertAutoStopSec = autoStopMin > 0 ? autoStopMin * 60 : 0;
    const checkSec = config.idle_check_interval_sec != null ? config.idle_check_interval_sec : DEFAULT_IDLE_CHECK_INTERVAL_SEC;
    this.checkIntervalMs = Math.min(60, Math.max(1, checkSec)) * 1000;
    this.checkInterval = null;
    this.isIdle = false;
    this.idleStartedAt = null;
    this.alertShownAt = null;
    this.enabled = config.idle_detection !== false && this.idleTimeoutSec > 0;

    // Callbacks — set by main process
    this._onIdleDetected = null;   // (idleSeconds, idleStartedAt) => void
    this._onAutoStop = null;       // (totalIdleSeconds) => void
  }

  // Register callbacks
  onIdleDetected(callback) {
    this._onIdleDetected = callback;
  }

  onAutoStop(callback) {
    this._onAutoStop = callback;
  }

  // Update config (e.g., after fetching from server)
  updateConfig(config) {
    const timeout = config.idle_timeout != null ? config.idle_timeout : DEFAULT_IDLE_TIMEOUT_MIN;
    this.idleTimeoutSec = timeout > 0 ? timeout * 60 : 0;
    const autoStopMin = config.idle_alert_auto_stop_min != null ? config.idle_alert_auto_stop_min : 10;
    this.alertAutoStopSec = autoStopMin > 0 ? autoStopMin * 60 : 0;
    const checkSec = config.idle_check_interval_sec != null ? config.idle_check_interval_sec : DEFAULT_IDLE_CHECK_INTERVAL_SEC;
    this.checkIntervalMs = Math.min(60, Math.max(1, checkSec)) * 1000;
    this.enabled = config.idle_detection !== false && this.idleTimeoutSec > 0;
  }

  start() {
    if (!this.enabled) return;
    this.stop(); // Clear any existing interval

    this.isIdle = false;
    this.idleStartedAt = null;
    this.alertShownAt = null;

    this.checkInterval = setInterval(() => this._check(), this.checkIntervalMs);
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isIdle = false;
    this.idleStartedAt = null;
    this.alertShownAt = null;
  }

  // Called when user responds to idle alert
  resolveIdle() {
    this.isIdle = false;
    this.idleStartedAt = null;
    this.alertShownAt = null;
  }

  // Get current idle duration in seconds (for display in alert)
  getIdleDuration() {
    if (!this.idleStartedAt) return 0;
    return Math.floor((Date.now() - this.idleStartedAt) / 1000);
  }

  _check() {
    // powerMonitor.getSystemIdleTime() returns seconds since last user input
    // This is the OS-level idle time — works even without uiohook
    const systemIdleSec = powerMonitor.getSystemIdleTime();

    if (!this.isIdle && systemIdleSec >= this.idleTimeoutSec) {
      // Just became idle
      this.isIdle = true;
      // Idle actually started (idleTimeoutSec) ago based on system idle time
      this.idleStartedAt = Date.now() - (systemIdleSec * 1000);
      this.alertShownAt = Date.now();

      if (this._onIdleDetected) {
        this._onIdleDetected(systemIdleSec, this.idleStartedAt);
      }
    } else if (this.isIdle) {
      // Already idle — check if we should auto-stop
      if (systemIdleSec < 5) {
        // User came back (input detected) — but don't auto-resolve
        // The alert window handles resolution via user choice
        return;
      }

      // Check auto-stop timeout (alert has been shown too long)
      if (this.alertShownAt) {
        const alertDuration = (Date.now() - this.alertShownAt) / 1000;
        if (alertDuration >= this.alertAutoStopSec) {
          // Auto-stop timer — user has been idle way too long
          if (this._onAutoStop) {
            this._onAutoStop(this.getIdleDuration());
          }
          this.resolveIdle();
        }
      }
    }
  }
}

module.exports = IdleDetector;
