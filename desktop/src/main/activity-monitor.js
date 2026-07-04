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

// ISSUE 3 FIX: Trailing window (seconds) used to score a SCREENSHOT's activity.
// A screenshot is captured at an arbitrary moment; its activity % must reflect the
// input in the seconds *immediately preceding* the capture — not the previous fully
// completed 30s heartbeat interval, which is stale/misaligned. Using a trailing
// window that always ends at capture time keeps the two aligned:
//   - a screenshot taken during a 0-input stretch scores 0% (was showing a stale
//     nonzero % from an earlier interval)
//   - a screenshot taken during light input scores a matching low % (was showing 0%
//     because the previous completed interval happened to be empty)
// 30s matches the heartbeat granularity so the desktop hint lines up with the
// active-seconds ground truth the backend recalculates from.
const SCREENSHOT_ACTIVITY_WINDOW_SEC = 30;

class ActivityMonitor {
  constructor(apiClient, offlineQueue) {
    this.apiClient = apiClient;
    this.offlineQueue = offlineQueue;
    // Injected by index.js. Returns { time_entry_id, idempotency_key } for the
    // CURRENTLY running entry (local id + idempotency_key), or null when no timer
    // is active. A heartbeat that fails to send is queued offline; without this
    // anchor it carries no entry id and the offline-queue drops it as an
    // unresolvable orphan, losing the offline activity. With it, the queue resolves
    // it to the server entry once the start syncs and replays it.
    this.getCurrentEntryMeta = null;
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

    // ISSUE 3 FIX: Rolling trailing-window active-seconds for SCREENSHOT scoring.
    // Unlike _activeSeconds (cleared every 30s heartbeat), this persists across
    // heartbeats and is pruned to a trailing window, so a screenshot's activity %
    // reflects the seconds right before capture instead of a stale prior interval.
    this._rollingActiveSeconds = new Set();
    // unix ms when monitoring started — lets the screenshot score divide by the
    // elapsed time (not the full window) during the first <window seconds so a
    // freshly-started, fully-active session isn't under-reported.
    this._monitorStartedAt = null;

    // Stores the score from the last COMPLETED 30s interval.
    // Screenshots use this so they get a stable, interval-based score
    // instead of a partial point-in-time reading.
    this._lastCompletedIntervalScore = 0;

    /** @type {(() => void)|null} */
    this._onHeartbeatSuccess = null;

    // Bound handlers so we can add/remove them without leaking
    this._onKeydown = () => {
      this.keyboardCount++;
      this._markActiveSecond(Math.floor(Date.now() / 1000));
    };
    this._onClick = () => {
      this.mouseCount++;
      this._markActiveSecond(Math.floor(Date.now() / 1000));
    };
    this._onMousemove = () => {
      // Throttle: only count 1 movement per 200ms
      const now = Date.now();
      if (now - this._lastMouseMoveTime >= MOUSEMOVE_THROTTLE_MS) {
        this._lastMouseMoveTime = now;
        this.mouseCount++;
        this._markActiveSecond(Math.floor(now / 1000));
      }
    };
  }

  // Record a second of input into BOTH the per-heartbeat interval set and the
  // rolling trailing-window set used for screenshot scoring (ISSUE 3 FIX).
  _markActiveSecond(sec) {
    this._activeSeconds.add(sec);
    this._rollingActiveSeconds.add(sec);
  }

  start() {
    if (this.interval) return;

    this.keyboardCount = 0;
    this.mouseCount = 0;
    this._lastMouseMoveTime = 0;
    this._activeSeconds = new Set();
    this._rollingActiveSeconds = new Set();
    this._intervalStartTime = Date.now();
    this._monitorStartedAt = Date.now();
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
          this._markActiveSecond(nowSec - i);
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
   * ISSUE 3 FIX: Score for a SCREENSHOT, computed over a trailing window that
   * ENDS at the moment of capture (now). Previously this returned the last
   * COMPLETED 30s heartbeat interval score, which is off by up to a full
   * interval from the capture moment and produced the QA-reported mismatches
   * (0 input → nonzero %, and light input → 0%). Aligning the window to the
   * capture moment makes the % represent the input right before the shot.
   *
   * The window is `SCREENSHOT_ACTIVITY_WINDOW_SEC`; during warmup (monitor has
   * run for less than a full window) we divide by the elapsed time so a short,
   * fully-active session still reads high.
   */
  getScoreForScreenshot() {
    return this._computeRollingScore();
  }

  /** Prune expired entries from the rolling set and compute the trailing-window %. */
  _computeRollingScore() {
    const nowSec = Math.floor(Date.now() / 1000);
    const cutoff = nowSec - SCREENSHOT_ACTIVITY_WINDOW_SEC;
    let activeCount = 0;
    for (const ts of this._rollingActiveSeconds) {
      if (ts <= cutoff) {
        this._rollingActiveSeconds.delete(ts); // prune anything older than the window
      } else if (ts <= nowSec) {
        activeCount++;
      }
    }
    // Denominator: full window once warmed up, else the seconds actually elapsed
    // since monitoring began (avoids under-reporting a brand-new active session).
    let denom = SCREENSHOT_ACTIVITY_WINDOW_SEC;
    if (this._monitorStartedAt) {
      const elapsedSec = Math.floor((Date.now() - this._monitorStartedAt) / 1000);
      denom = Math.max(1, Math.min(SCREENSHOT_ACTIVITY_WINDOW_SEC, elapsedSec));
    }
    activeCount = Math.min(activeCount, denom);
    return Math.min(100, Math.round((activeCount / denom) * 100));
  }

  /**
   * Get the current activity score (0-100) for the in-progress interval.
   * This is a live reading that changes as input events arrive.
   */
  getCurrentScore() {
    return this._computeIntervalScore();
  }

  setOnHeartbeatSuccess(callback) {
    this._onHeartbeatSuccess = typeof callback === 'function' ? callback : null;
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
    this._rollingActiveSeconds = new Set();
    this._intervalStartTime = null;
    this._monitorStartedAt = null;
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
      this._onHeartbeatSuccess?.();
    } catch (apiErr) {
      try {
        // M7 FIX: Guard offlineQueue access — it may be null after logout
        if (this.offlineQueue) {
          // Anchor the queued heartbeat to the current entry (local id +
          // idempotency_key) so the offline-queue resolver can map it to the
          // server entry on replay. Without this it's an unanchored orphan and
          // gets dropped — losing offline-captured activity.
          const entryMeta =
            typeof this.getCurrentEntryMeta === 'function'
              ? this.getCurrentEntryMeta()
              : null;
          await this.offlineQueue.add('heartbeat', {
            ...data,
            ...(entryMeta || {}),
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
