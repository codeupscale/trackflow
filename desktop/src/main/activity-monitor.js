// AGENT-03: Activity monitoring — keyboard + mouse counts only, NEVER keystrokes
// AGENT-04: Active app name tracking
//
// Two modes:
//   1. uiohook-napi (if available + accessibility permission granted)
//      → Precise keyboard/mouse event counts
//      → Requires macOS Accessibility permission
//
//   2. powerMonitor fallback (no extra permissions needed)
//      → Uses system idle time to estimate activity
//      → If system was idle < 5s during a 30s heartbeat, user was active
//      → Less granular but works everywhere without prompts

const { execFile } = require('child_process');
const { powerMonitor, systemPreferences } = require('electron');
const os = require('os');

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
    // Bound handlers so we can add/remove them without leaking
    this._onKeydown = () => { this.keyboardCount++; };
    this._onClick = () => { this.mouseCount++; };
    this._onMousemove = () => { this.mouseCount++; };
    // powerMonitor fallback state
    this._lastIdleCheck = 0;
    this._activeSeconds = 0;
  }

  start() {
    if (this.interval) return;

    this.keyboardCount = 0;
    this.mouseCount = 0;
    this._activeSeconds = 0;
    this._lastIdleCheck = Date.now();

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
          console.warn('uiohook-napi not available, using idle-time fallback');
          this._useIdleFallback = true;
        }
      } else {
        // No accessibility permission — use fallback without prompting
        console.log('Accessibility permission not granted — using idle-time activity estimation');
        this._useIdleFallback = true;
      }
    }

    // If using fallback, poll idle time every 5 seconds to estimate activity
    if (this._useIdleFallback) {
      this._idlePollInterval = setInterval(() => this._pollIdleTime(), 5000);
    }

    // Send heartbeat every 30 seconds
    this.interval = setInterval(() => this.sendHeartbeat(), 30000);
  }

  _checkAccessibilityPermission() {
    if (process.platform !== 'darwin') return true;
    // On macOS, check if accessibility is trusted WITHOUT prompting
    // systemPreferences.isTrustedAccessibilityClient(false) = check only, don't prompt
    try {
      return systemPreferences.isTrustedAccessibilityClient(false);
    } catch {
      return false;
    }
  }

  // powerMonitor-based activity estimation:
  // System idle time < 5 seconds = user is active right now
  _pollIdleTime() {
    try {
      const idleSec = powerMonitor.getSystemIdleTime();
      if (idleSec < 5) {
        // User was active in the last 5 seconds
        const now = Date.now();
        const elapsed = (now - this._lastIdleCheck) / 1000;
        this._activeSeconds += Math.min(elapsed, 5);
        // Estimate: each active 5s poll ≈ ~3 keyboard + ~5 mouse events
        this.keyboardCount += 3;
        this.mouseCount += 5;
      }
      this._lastIdleCheck = Date.now();
    } catch {}
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
    this._activeSeconds = 0;
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
    this._activeSeconds = 0;

    try {
      await this.apiClient.sendHeartbeat(data);
    } catch (e) {
      this.offlineQueue.add('heartbeat', {
        ...data,
        logged_at: new Date().toISOString(),
      });
    }
  }

  // Spawn a child process with timeout + cleanup to avoid orphans
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

    // Linux: Try xdotool → ps to get process name from PID
    return new Promise((resolve) => {
      let resolved = false;
      const done = (val) => { if (!resolved) { resolved = true; resolve(val); } };
      const timer = setTimeout(() => done(null), 3000);

      const child = execFile('xdotool', ['getactivewindow', 'getwindowpid'], { timeout: 2500 }, (err, stdout) => {
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

    // Linux
    return this._execWithTimeout('xdotool', ['getactivewindow', 'getwindowname']);
  }
}

module.exports = ActivityMonitor;
