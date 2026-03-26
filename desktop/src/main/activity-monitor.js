// Activity monitoring — keyboard + mouse counts only, NEVER keystrokes
// Active app name tracking
//
// Hubstaff-calibrated activity scoring:
//   - 10-minute intervals, each split into 30s heartbeats
//   - mousemove is THROTTLED (1 count per 200ms, not per pixel)
//   - Final heartbeat sent on timer stop (no data loss)
//   - Backend maxExpected = 300 events/30s for 100% score
//
// Two modes:
//   1. uiohook-napi (if available + accessibility permission granted)
//      → Precise keyboard/mouse event counts
//      → mousemove throttled to 1 event per 200ms (Hubstaff-style)
//
//   2. powerMonitor fallback (no extra permissions needed)
//      → Uses system idle time to estimate activity
//      → Calibrated so 100% active ≈ 300 total events per 30s

const { execFile } = require('child_process');
const { powerMonitor, systemPreferences } = require('electron');
const os = require('os');

// Backend maxExpected is 300 events per 30s for 100% score.
const MAX_EXPECTED_EVENTS = 300;
const HEARTBEAT_INTERVAL_MS = 30000;

// Fallback polls 10 times per 30s (every 3s). Each active poll = 30 events (300/10).
const FALLBACK_POLL_INTERVAL_MS = 3000;
const FALLBACK_KEYBOARD_PER_ACTIVE_POLL = 12;
const FALLBACK_MOUSE_PER_ACTIVE_POLL = 18;
const IDLE_ACTIVE_THRESHOLD_SEC = 5;

// Throttle mousemove: count max 1 movement per 200ms.
// Raw mousemove fires every pixel (~500-2000/sec during movement).
// Hubstaff counts "mouse activity intervals" not raw events.
const MOUSEMOVE_THROTTLE_MS = 200;

class ActivityMonitor {
  constructor(apiClient, offlineQueue) {
    this.apiClient = apiClient;
    this.offlineQueue = offlineQueue;
    this.interval = null;
    this.keyboardCount = 0;
    this.mouseCount = 0;
    this.uiohook = null;
    this._hookStarted = false;
    this._hookAvailable = false;
    this._useIdleFallback = false;
    this._idlePollInterval = null;
    this._lastMouseMoveTime = 0;

    // Bound handlers so we can add/remove them without leaking
    this._onKeydown = () => { this.keyboardCount++; };
    this._onClick = () => { this.mouseCount++; };
    this._onMousemove = () => {
      // Throttle: only count 1 movement per 200ms
      const now = Date.now();
      if (now - this._lastMouseMoveTime >= MOUSEMOVE_THROTTLE_MS) {
        this._lastMouseMoveTime = now;
        this.mouseCount++;
      }
    };
  }

  start() {
    if (this.interval) return;

    this.keyboardCount = 0;
    this.mouseCount = 0;
    this._lastMouseMoveTime = 0;

    // Try uiohook-napi, but only if accessibility permission is available
    if (!this._hookStarted) {
      const hasPermission = this._checkAccessibilityPermission();

      if (hasPermission) {
        try {
          const { uIOhook } = require('uiohook-napi');
          this.uiohook = uIOhook;
          uIOhook.on('keydown', this._onKeydown);
          uIOhook.on('click', this._onClick);
          uIOhook.on('mousemove', this._onMousemove);
          uIOhook.start();
          this._hookStarted = true;
          this._hookAvailable = true;
          this._useIdleFallback = false;
        } catch (e) {
          console.warn('uiohook-napi not available, using idle-time fallback:', e.message);
          this._useIdleFallback = true;
        }
      } else {
        console.log('Accessibility permission not granted — using idle-time activity estimation');
        this._useIdleFallback = true;
      }
    }

    // If using fallback, poll idle time every 3 seconds to estimate activity
    if (this._useIdleFallback) {
      this._idlePollInterval = setInterval(() => this._pollIdleTime(), FALLBACK_POLL_INTERVAL_MS);
    }

    // Send heartbeat every 30 seconds
    this.interval = setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
  }

  _checkAccessibilityPermission() {
    if (process.platform !== 'darwin') return true;
    try {
      return systemPreferences.isTrustedAccessibilityClient(false);
    } catch {
      return false;
    }
  }

  _pollIdleTime() {
    try {
      const idleSec = powerMonitor.getSystemIdleTime();
      if (idleSec < IDLE_ACTIVE_THRESHOLD_SEC) {
        this.keyboardCount += FALLBACK_KEYBOARD_PER_ACTIVE_POLL;
        this.mouseCount += FALLBACK_MOUSE_PER_ACTIVE_POLL;
      }
    } catch {}
  }

  // Send final heartbeat before stopping — prevents losing the last 0-29s of data
  async sendFinalHeartbeat() {
    if (this.keyboardCount === 0 && this.mouseCount === 0) return;
    try {
      await this.sendHeartbeat();
    } catch {
      // Best effort — don't block timer stop
    }
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    if (this._idlePollInterval) {
      clearInterval(this._idlePollInterval);
      this._idlePollInterval = null;
    }

    if (this.uiohook && this._hookStarted) {
      try {
        this.uiohook.removeListener('keydown', this._onKeydown);
        this.uiohook.removeListener('click', this._onClick);
        this.uiohook.removeListener('mousemove', this._onMousemove);
        this.uiohook.stop();
      } catch {}
      this._hookStarted = false;
    }

    this.keyboardCount = 0;
    this.mouseCount = 0;
    this._lastMouseMoveTime = 0;
  }

  async sendHeartbeat() {
    const data = {
      keyboard_events: this.keyboardCount,
      mouse_events: this.mouseCount,
      active_app: await this.getActiveApp(),
      active_window_title: await this.getActiveWindowTitle(),
      active_url: null,
    };

    this.keyboardCount = 0;
    this.mouseCount = 0;

    try {
      await this.apiClient.sendHeartbeat(data);
    } catch (e) {
      this.offlineQueue.add('heartbeat', {
        ...data,
        logged_at: new Date().toISOString(),
      });
    }
  }

  _execWithTimeout(cmd, args, timeoutMs = 3000) {
    return new Promise((resolve) => {
      let child = null;
      let resolved = false;
      const done = (val) => {
        if (!resolved) { resolved = true; resolve(val); }
      };
      const timer = setTimeout(() => {
        done(null);
        try { child?.kill(); } catch {}
      }, timeoutMs);

      child = execFile(cmd, args, { timeout: timeoutMs }, (err, stdout) => {
        clearTimeout(timer);
        done(err ? null : (stdout || '').trim());
      });
    });
  }

  /**
   * Get the current activity score (0-100) based on events accumulated
   * since the last heartbeat. Called by screenshot-service to attach
   * a point-in-time activity % to each screenshot — matching Hubstaff's approach.
   *
   * Does NOT reset counters (heartbeat does that).
   */
  getCurrentScore() {
    const total = this.keyboardCount + this.mouseCount;
    return Math.min(100, Math.round((total / MAX_EXPECTED_EVENTS) * 100));
  }

  async getActiveApp() {
    if (os.platform() === 'darwin') {
      return this._execWithTimeout('osascript', [
        '-e', 'tell application "System Events" to get name of first application process whose frontmost is true',
      ]);
    }
    if (os.platform() === 'win32') {
      return this._execWithTimeout('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        '(Get-Process | Where-Object {$_.MainWindowHandle -ne 0 -and $_.MainWindowTitle} | Select-Object -First 1).ProcessName',
      ]);
    }
    return new Promise((resolve) => {
      let resolved = false;
      const done = (val) => { if (!resolved) { resolved = true; resolve(val); } };
      const timer = setTimeout(() => done(null), 3000);
      execFile('xdotool', ['getactivewindow', 'getwindowpid'], { timeout: 2500 }, (err, stdout) => {
        if (err) { clearTimeout(timer); done(null); return; }
        const pid = (stdout || '').trim();
        if (!pid) { clearTimeout(timer); done(null); return; }
        execFile('ps', ['-p', pid, '-o', 'comm='], { timeout: 2000 }, (err2, stdout2) => {
          clearTimeout(timer);
          done(err2 ? null : (stdout2 || '').trim());
        });
      });
    });
  }

  async getActiveWindowTitle() {
    if (os.platform() === 'darwin') {
      return this._execWithTimeout('osascript', [
        '-e', 'tell application "System Events" to get title of front window of (first application process whose frontmost is true)',
      ]);
    }
    if (os.platform() === 'win32') {
      return this._execWithTimeout('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        '(Get-Process | Where-Object {$_.MainWindowHandle -ne 0 -and $_.MainWindowTitle} | Select-Object -First 1).MainWindowTitle',
      ]);
    }
    return this._execWithTimeout('xdotool', ['getactivewindow', 'getwindowname']);
  }
}

module.exports = ActivityMonitor;
