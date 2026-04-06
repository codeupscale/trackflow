// Activity monitoring — keyboard + mouse counts only, NEVER keystrokes
// Active app name tracking
//
// Hubstaff-standard activity scoring (active-seconds model):
//   - 10-minute intervals, each split into 30s heartbeats
//   - mousemove is THROTTLED (1 count per 200ms, not per pixel)
//   - Activity score = % of seconds that had ANY input in the interval
//   - Final heartbeat sent on timer stop (no data loss)
//   - Backend receives active_seconds for ground-truth scoring
//
// Two modes:
//   1. uiohook-napi (if available + accessibility permission granted)
//      -> Precise keyboard/mouse event counts + active-seconds tracking
//      -> mousemove throttled to 1 event per 200ms (Hubstaff-style)
//
//   2. powerMonitor fallback (no extra permissions needed)
//      -> Uses system idle time to estimate activity
//      -> Calibrated so 100% active ~ 300 total events per 30s
//      -> Active-seconds estimated from idle time polls

const { execFile } = require('child_process');
const { powerMonitor, systemPreferences } = require('electron');
const os = require('os');

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

    // Active-seconds tracking (Hubstaff model)
    // A Set of unix-second timestamps where ANY input occurred
    this._activeSeconds = new Set();
    this._intervalStartTime = null; // unix ms when current interval started

    // Stores the score from the last COMPLETED 30s interval.
    // Screenshots use this so they get a stable, interval-based score
    // instead of a partial point-in-time reading.
    this._lastCompletedIntervalScore = 0;

    // Bound handlers so we can add/remove them without leaking
    this._onKeydown = () => {
      this.keyboardCount++;
      this._activeSeconds.add(Math.floor(Date.now() / 1000));
    };
    this._onClick = () => {
      this.mouseCount++;
      this._activeSeconds.add(Math.floor(Date.now() / 1000));
    };
    this._onMousemove = () => {
      // Throttle: only count 1 movement per 200ms
      const now = Date.now();
      if (now - this._lastMouseMoveTime >= MOUSEMOVE_THROTTLE_MS) {
        this._lastMouseMoveTime = now;
        this.mouseCount++;
        this._activeSeconds.add(Math.floor(now / 1000));
      }
    };
  }

  start() {
    if (this.interval) return;

    this.keyboardCount = 0;
    this.mouseCount = 0;
    this._lastMouseMoveTime = 0;
    this._activeSeconds = new Set();
    this._intervalStartTime = Date.now();
    this._lastCompletedIntervalScore = 0;

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
        // In fallback mode, estimate active seconds:
        // Each poll covers 3 seconds. If user was active (idle < 5s),
        // mark all 3 seconds as active.
        const nowSec = Math.floor(Date.now() / 1000);
        for (let i = 0; i < 3; i++) {
          this._activeSeconds.add(nowSec - i);
        }
      }
    } catch {}
  }

  /**
   * Compute active-seconds score for the current (possibly partial) interval.
   * Returns 0-100 representing percentage of seconds with input.
   */
  _computeIntervalScore() {
    if (!this._intervalStartTime) return 0;
    const elapsedMs = Date.now() - this._intervalStartTime;
    const totalSeconds = Math.max(1, Math.floor(elapsedMs / 1000));
    // Guard: only count timestamps that fall within the current interval
    const intervalStartSeconds = Math.floor(this._intervalStartTime / 1000);
    let activeCount = 0;
    for (const ts of this._activeSeconds) {
      if (ts >= intervalStartSeconds) activeCount++;
    }
    // Clamp activeCount to totalSeconds to prevent score > 100%
    activeCount = Math.min(activeCount, totalSeconds);
    return Math.min(100, Math.round((activeCount / totalSeconds) * 100));
  }

  /**
   * Get the score for the last COMPLETED heartbeat interval.
   * Used by screenshot-service so screenshots get stable, interval-based
   * scores instead of partial point-in-time readings.
   *
   * This is the Hubstaff approach: all screenshots within the same interval
   * show the same consistent activity score.
   */
  getScoreForScreenshot() {
    return this._lastCompletedIntervalScore;
  }

  /**
   * Get the current activity score (0-100) for the in-progress interval.
   * This is a live reading that changes as input events arrive.
   */
  getCurrentScore() {
    return this._computeIntervalScore();
  }

  // Send final heartbeat before stopping — prevents losing the last 0-29s of data
  async sendFinalHeartbeat() {
    if (this.keyboardCount === 0 && this.mouseCount === 0 && this._activeSeconds.size === 0) return;
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
    this._activeSeconds = new Set();
    this._intervalStartTime = null;
    this._lastCompletedIntervalScore = 0;
  }

  async sendHeartbeat() {
    // Compute active-seconds score for the interval that just completed
    const activeSecondsCount = this._activeSeconds.size;
    const intervalScore = this._computeIntervalScore();

    // Store as the last completed interval score (for screenshot-service)
    this._lastCompletedIntervalScore = intervalScore;

    // M1 FIX: Snapshot counters, reset immediately (avoid double-counting on retry),
    // then attempt API/queue. If BOTH fail, restore snapshot values.
    const snapshot = {
      keyboard: this.keyboardCount,
      mouse: this.mouseCount,
      activeSeconds: [...this._activeSeconds],
    };

    // Reset counters for next interval immediately
    this.keyboardCount = 0;
    this.mouseCount = 0;
    this._activeSeconds = new Set();
    this._intervalStartTime = Date.now();

    const data = {
      keyboard_events: snapshot.keyboard,
      mouse_events: snapshot.mouse,
      active_seconds: activeSecondsCount,
      active_app: await this.getActiveApp(),
      active_window_title: await this.getActiveWindowTitle(),
      active_url: null,
    };

    try {
      await this.apiClient.sendHeartbeat(data);
    } catch (apiErr) {
      try {
        // M7 FIX: Guard offlineQueue access — it may be null after logout
        if (this.offlineQueue) {
          await this.offlineQueue.add('heartbeat', {
            ...data,
            logged_at: new Date().toISOString(),
          });
        } else {
          throw new Error('offlineQueue is null');
        }
      } catch (queueErr) {
        // M1 FIX: Last resort — restore counters so next tick can retry
        this.keyboardCount += snapshot.keyboard;
        this.mouseCount += snapshot.mouse;
        snapshot.activeSeconds.forEach(s => this._activeSeconds.add(s));
        console.error('[Heartbeat] both API and queue failed -- data restored for retry');
      }
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

  async getActiveApp() {
    if (os.platform() === 'darwin') {
      return this._execWithTimeout('osascript', [
        '-e', 'tell application "System Events" to get name of first application process whose frontmost is true',
      ]);
    }
    if (os.platform() === 'win32') {
      // M3 FIX: Use GetForegroundWindow P/Invoke instead of Get-Process
      const result = await this._getActiveWindowWindows();
      return result ? result.processName : null;
    }
    // L6 FIX: Detect Wayland via WAYLAND_DISPLAY env var
    if (os.platform() === 'linux') {
      return this._getActiveAppLinux();
    }
    return null;
  }

  async getActiveWindowTitle() {
    if (os.platform() === 'darwin') {
      return this._execWithTimeout('osascript', [
        '-e', 'tell application "System Events" to get title of front window of (first application process whose frontmost is true)',
      ]);
    }
    if (os.platform() === 'win32') {
      // M3 FIX: Use GetForegroundWindow P/Invoke
      const result = await this._getActiveWindowWindows();
      return result ? result.windowTitle : null;
    }
    // L6 FIX: Wayland-aware
    if (os.platform() === 'linux') {
      return this._getActiveWindowTitleLinux();
    }
    return null;
  }

  // M3 FIX: Windows — use Win32 GetForegroundWindow + GetWindowText via P/Invoke
  async _getActiveWindowWindows() {
    const ps = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;using System.Text;public class Win32{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);}';$hwnd=[Win32]::GetForegroundWindow();$pid=0;[Win32]::GetWindowThreadProcessId($hwnd,[ref]$pid)|Out-Null;$p=Get-Process -Id $pid -EA SilentlyContinue;$t=New-Object System.Text.StringBuilder 256;[Win32]::GetWindowText($hwnd,$t,256)|Out-Null;"$($p.Name)|$($t.ToString())"`;
    const result = await this._execWithTimeout('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', ps,
    ]);
    if (!result) return null;
    const parts = result.split('|');
    return {
      processName: parts[0] || null,
      windowTitle: parts.slice(1).join('|') || null,
    };
  }

  // L6 FIX: Linux — detect Wayland via WAYLAND_DISPLAY env var
  async _getActiveAppLinux() {
    if (process.env.WAYLAND_DISPLAY) {
      return this._getActiveAppWayland();
    }
    return this._getActiveAppX11();
  }

  async _getActiveWindowTitleLinux() {
    if (process.env.WAYLAND_DISPLAY) {
      // Wayland: window title is harder to get; return null gracefully
      return null;
    }
    return this._execWithTimeout('xdotool', ['getactivewindow', 'getwindowname']);
  }

  async _getActiveAppX11() {
    return new Promise((resolve) => {
      let resolved = false;
      let outerTimer = null;
      const done = (val) => {
        if (!resolved) {
          resolved = true;
          if (outerTimer) { clearTimeout(outerTimer); outerTimer = null; }
          resolve(val);
        }
      };
      outerTimer = setTimeout(() => done(null), 3000);
      execFile('xdotool', ['getactivewindow', 'getwindowpid'], { timeout: 2500 }, (err, stdout) => {
        if (err) { done(null); return; }
        const pid = (stdout || '').trim();
        if (!pid) { done(null); return; }
        execFile('ps', ['-p', pid, '-o', 'comm='], { timeout: 2000 }, (err2, stdout2) => {
          done(err2 ? null : (stdout2 || '').trim());
        });
      });
    });
  }

  // L6 FIX: Wayland fallback — try ydotool or wlrctl, log warning once if unavailable
  _waylandWarningLogged = false;
  async _getActiveAppWayland() {
    // Try ydotool first (if available)
    const result = await this._execWithTimeout('ydotool', ['getactivewindow']);
    if (result) return result;

    // Try wlrctl as fallback
    const result2 = await this._execWithTimeout('wlrctl', ['toplevel', 'find', 'focused']);
    if (result2) return result2;

    if (!this._waylandWarningLogged) {
      this._waylandWarningLogged = true;
      console.warn('[ActivityMonitor] Wayland detected but ydotool/wlrctl not available -- active window detection disabled');
    }
    return null;
  }
}

module.exports = ActivityMonitor;
