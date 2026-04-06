// Network Monitor -- detects online/offline transitions and triggers callbacks
// Uses Electron's net.isOnline() API which checks OS-level network state.
// On Windows, adds a ping fallback since net.isOnline() can be unreliable.
// Polls every 15 seconds and emits 'online', 'offline', and 'change' events.

const { net } = require('electron');
const { execFile } = require('child_process');

class NetworkMonitor {
  constructor() {
    this._isOnline = true; // assume online initially
    this._listeners = { online: [], offline: [], change: [] };
    this._checkInterval = null;
    this._platform = process.platform;
  }

  start() {
    // Check every 15 seconds
    this._checkInterval = setInterval(() => this._check(), 15000);
    // Initial check
    this._check();
  }

  stop() {
    if (this._checkInterval) {
      clearInterval(this._checkInterval);
      this._checkInterval = null;
    }
  }

  get isOnline() { return this._isOnline; }

  on(event, callback) {
    if (this._listeners[event]) {
      this._listeners[event].push(callback);
    }
  }

  _emit(event) {
    for (const cb of this._listeners[event] || []) {
      try { cb(this._isOnline); } catch (e) {
        console.error(`[NetworkMonitor] Listener error:`, e.message);
      }
    }
  }

  async _check() {
    try {
      let online = net.isOnline();

      // Windows fallback: net.isOnline() can report false positives on Windows.
      // Verify with a ping to a reliable DNS server.
      if (this._platform === 'win32' && online) {
        online = await this._pingCheck();
      }

      if (online !== this._isOnline) {
        this._isOnline = online;
        console.log(`[NetworkMonitor] Status changed: ${online ? 'ONLINE' : 'OFFLINE'}`);
        this._emit('change');
        this._emit(online ? 'online' : 'offline');
      }
    } catch (e) {
      console.warn('[NetworkMonitor] Check failed:', e.message);
    }
  }

  /**
   * Ping fallback for Windows where net.isOnline() can be unreliable.
   * Pings 1.1.1.1 with a 3-second timeout. Returns true if reachable.
   */
  _pingCheck() {
    return new Promise((resolve) => {
      const args = this._platform === 'win32'
        ? ['-n', '1', '-w', '3000', '1.1.1.1']
        : ['-c', '1', '-W', '3', '1.1.1.1'];

      execFile('ping', args, { timeout: 5000 }, (error) => {
        resolve(!error);
      });
    });
  }
}

module.exports = NetworkMonitor;
