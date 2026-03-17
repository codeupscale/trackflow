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

const IDLE_CHECK_INTERVAL_MS = 10000; // Check every 10 seconds
const DEFAULT_IDLE_TIMEOUT_MIN = 5;   // Default idle threshold
const ALERT_AUTO_STOP_MIN = 10;       // Auto-stop if alert not dismissed

class IdleDetector {
  constructor(config = {}) {
    this.idleTimeoutSec = (config.idle_timeout || DEFAULT_IDLE_TIMEOUT_MIN) * 60;
    this.alertAutoStopSec = ALERT_AUTO_STOP_MIN * 60;
    this.checkInterval = null;
    this.isIdle = false;
    this.idleStartedAt = null;
    this.alertShownAt = null;
    this.enabled = config.idle_detection !== false; // Enabled by default

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
    if (config.idle_timeout) {
      this.idleTimeoutSec = config.idle_timeout * 60;
    }
    this.enabled = config.idle_detection !== false;
  }

  start() {
    if (!this.enabled) return;
    this.stop(); // Clear any existing interval

    this.isIdle = false;
    this.idleStartedAt = null;
    this.alertShownAt = null;

    this.checkInterval = setInterval(() => this._check(), IDLE_CHECK_INTERVAL_MS);
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
