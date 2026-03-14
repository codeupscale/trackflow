// AGENT-03: Activity monitoring — keyboard + mouse counts only, NEVER keystrokes
// AGENT-04: Active app name tracking

const { exec } = require('child_process');
const os = require('os');

class ActivityMonitor {
  constructor(apiClient, offlineQueue) {
    this.apiClient = apiClient;
    this.offlineQueue = offlineQueue;
    this.interval = null;
    this.keyboardCount = 0;
    this.mouseCount = 0;
    this.uiohook = null;
  }

  start() {
    this.keyboardCount = 0;
    this.mouseCount = 0;

    // Try to load uiohook-napi for input monitoring
    try {
      const { UiohookKey, uIOhook } = require('uiohook-napi');
      this.uiohook = uIOhook;

      uIOhook.on('keydown', () => {
        this.keyboardCount++;
      });

      uIOhook.on('click', () => {
        this.mouseCount++;
      });

      uIOhook.on('mousemove', () => {
        this.mouseCount++;
      });

      uIOhook.start();
    } catch (e) {
      console.warn('uiohook-napi not available, using fallback counting');
    }

    // Send heartbeat every 30 seconds
    this.interval = setInterval(() => this.sendHeartbeat(), 30000);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    if (this.uiohook) {
      try {
        this.uiohook.stop();
      } catch {}
      this.uiohook = null;
    }

    this.keyboardCount = 0;
    this.mouseCount = 0;
  }

  async sendHeartbeat() {
    const data = {
      keyboard_events: this.keyboardCount,
      mouse_events: this.mouseCount,
      active_app: await this.getActiveApp(),
      active_window_title: await this.getActiveWindowTitle(),
      active_url: null, // Requires browser extension (AGENT-05)
    };

    // Reset counts
    this.keyboardCount = 0;
    this.mouseCount = 0;

    try {
      await this.apiClient.sendHeartbeat(data);
    } catch (e) {
      // Queue for later if offline
      this.offlineQueue.add('heartbeat', {
        ...data,
        logged_at: new Date().toISOString(),
      });
    }
  }

  getActiveApp() {
    return new Promise((resolve) => {
      if (os.platform() === 'darwin') {
        // macOS: Use AppleScript
        exec(
          `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`,
          (err, stdout) => {
            resolve(err ? null : stdout.trim());
          }
        );
      } else if (os.platform() === 'win32') {
        // Windows: Use PowerShell
        exec(
          'powershell -command "Get-Process | Where-Object {$_.MainWindowHandle -ne 0} | Select-Object -First 1 -ExpandProperty ProcessName"',
          (err, stdout) => {
            resolve(err ? null : stdout.trim());
          }
        );
      } else {
        // Linux: Use xdotool
        exec('xdotool getactivewindow getwindowpid | xargs ps -p -o comm=', (err, stdout) => {
          resolve(err ? null : stdout.trim());
        });
      }
    });
  }

  getActiveWindowTitle() {
    return new Promise((resolve) => {
      if (os.platform() === 'darwin') {
        exec(
          `osascript -e 'tell application "System Events" to get title of front window of (first application process whose frontmost is true)'`,
          (err, stdout) => {
            resolve(err ? null : stdout.trim());
          }
        );
      } else if (os.platform() === 'win32') {
        exec(
          'powershell -command "(Get-Process | Where-Object {$_.MainWindowHandle -ne 0} | Select-Object -First 1).MainWindowTitle"',
          (err, stdout) => {
            resolve(err ? null : stdout.trim());
          }
        );
      } else {
        exec('xdotool getactivewindow getwindowname', (err, stdout) => {
          resolve(err ? null : stdout.trim());
        });
      }
    });
  }
}

module.exports = ActivityMonitor;
