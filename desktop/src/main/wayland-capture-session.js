/**
 * Linux Wayland persistent screen capture session.
 *
 * On Wayland, each desktopCapturer.getSources() call opens a new xdg-desktop-portal
 * ScreenCast session, so the "Share your screen" dialog reappears every capture.
 * Electron does not persist PipeWire restore tokens across getSources() calls.
 *
 * Fix: call getSources() ONCE per timer session, start a getUserMedia desktop stream
 * in a hidden window, and grab JPEG frames from that stream for every screenshot.
 * macOS and Windows are unaffected — ScreenshotService uses this only on Wayland.
 */
const path = require('path');
const { BrowserWindow, desktopCapturer } = require('electron');
const { isWaylandSession } = require('./linux-platform');

const CAPTURE_WIDTH = 1920;
const CAPTURE_HEIGHT = 1080;
const GET_SOURCES_TIMEOUT_MS = 15000;
const GRAB_FRAME_TIMEOUT_MS = 10000;

function shouldUseWaylandPersistentCapture(env = process.env) {
  return process.platform === 'linux' && isWaylandSession(env);
}

/**
 * Race `promise` against a timeout, ALWAYS clearing the timer.
 *
 * A bare `Promise.race([work, new Promise(r => setTimeout(...))])` abandons the timer
 * whenever the work wins — the timeout keeps the event loop alive for its full duration
 * holding a closure, on EVERY call. On Wayland that is one dangling 10s timer per frame
 * grab (three per interval window), plus a 15s one per session open.
 *
 * Under Jest the same leak is what force-exits a worker ("A worker process has failed to
 * exit gracefully"), and a force-exited worker reports whatever suite it was running as
 * FAILED — which is how `projects-cache.test.js`, a file with no timers, no async and no
 * clock, failed intermittently under load while passing every time in isolation.
 */
function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  });
}

class WaylandCaptureSession {
  constructor() {
    this._win = null;
    this._openPromise = null;
    this._sourceId = null;
  }

  get isOpen() {
    return Boolean(this._win && !this._win.isDestroyed());
  }

  /**
   * One portal interaction: enumerate sources once, then start a persistent stream.
   */
  async open() {
    if (this._openPromise) return this._openPromise;
    this._openPromise = this._doOpen();
    return this._openPromise;
  }

  async _doOpen() {
    console.log('[SS][Wayland] Opening persistent capture session (single portal prompt)');

    const sources = await withTimeout(
      desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false,
      }),
      GET_SOURCES_TIMEOUT_MS,
      'desktopCapturer.getSources() timed out',
    );

    const screenSource = sources.find((s) => s.id.startsWith('screen:'));
    if (!screenSource) {
      throw new Error('No screen source returned from desktopCapturer');
    }

    this._sourceId = screenSource.id;
    console.log(`[SS][Wayland] Selected source: ${screenSource.name} (${screenSource.id})`);

    this._win = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        contextIsolation: false,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });

    this._win.on('closed', () => {
      this._win = null;
    });

    await this._win.loadFile(
      path.join(__dirname, '..', 'renderer', 'wayland-capture.html'),
    );

    const started = await this._runInCapturePage(
      `window.__waylandCaptureStart(${JSON.stringify(screenSource.id)}, ${CAPTURE_WIDTH}, ${CAPTURE_HEIGHT})`,
      GRAB_FRAME_TIMEOUT_MS,
    );

    if (!started || !started.ok) {
      throw new Error(started?.error || 'Failed to start Wayland capture stream');
    }

    console.log(
      `[SS][Wayland] Stream ready (${started.width}x${started.height}) — reusing for all captures this session`,
    );
    return started;
  }

  /**
   * Grab one JPEG frame from the live stream (no new portal prompt).
   */
  async captureJpeg() {
    if (!this.isOpen) {
      await this.open();
    }
    if (!this.isOpen) {
      throw new Error('Wayland capture session is not open');
    }

    const result = await this._runInCapturePage(
      'window.__waylandCaptureGrab()',
      GRAB_FRAME_TIMEOUT_MS,
    );

    if (!result || !result.ok || !result.data) {
      throw new Error(result?.error || 'Wayland frame grab returned empty data');
    }

    return Buffer.from(result.data, 'base64');
  }

  async close() {
    this._openPromise = null;
    this._sourceId = null;

    if (this._win && !this._win.isDestroyed()) {
      try {
        await this._runInCapturePage('window.__waylandCaptureStop()', 3000);
      } catch (e) {
        console.warn('[SS][Wayland] Stop stream failed:', e.message);
      }
      try {
        this._win.destroy();
      } catch {}
    }
    this._win = null;
    console.log('[SS][Wayland] Capture session closed');
  }

  async _runInCapturePage(expression, timeoutMs) {
    if (!this._win || this._win.isDestroyed()) {
      throw new Error('Capture window is not available');
    }

    return withTimeout(
      this._win.webContents.executeJavaScript(expression, true),
      timeoutMs,
      'Capture page script timed out',
    );
  }
}

module.exports = {
  WaylandCaptureSession,
  shouldUseWaylandPersistentCapture,
};
