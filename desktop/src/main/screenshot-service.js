// Screenshot capture service
// - Captures at org-configured interval while timer is running
// - Multi-monitor: captures all screens and composites them side-by-side
// - Cross-platform: macOS (permission check), Windows, Linux
// - Blur support via sharp
// - Stops when timer stops (no orphan screenshots)

const { desktopCapturer, Notification, screen, systemPreferences, BrowserWindow } = require('electron');
const FormData = require('form-data');

// Lazy-load sharp — may not be available on all platforms
let _sharp = null;
let _sharpChecked = false;
function getSharp() {
  if (_sharpChecked) return _sharp;
  _sharpChecked = true;
  try {
    _sharp = require('sharp');
  } catch {
    _sharp = null;
    console.warn('sharp not available — multi-monitor composite and blur disabled');
  }
  return _sharp;
}

const MAX_CONSECUTIVE_FAILURES = 5;
const FAILURE_PAUSE_MS = 5 * 60 * 1000;

class ScreenshotService {
  constructor(apiClient, config, offlineQueue, getIsAppVisible = null) {
    this.apiClient = apiClient;
    this.config = config;
    this.offlineQueue = offlineQueue;
    this.getIsAppVisible = typeof getIsAppVisible === 'function' ? getIsAppVisible : null;
    this.interval = null;
    this.initialTimeout = null;
    this.currentEntryId = null;
    this._capturing = false;
    this._consecutiveFailures = 0;
    this._pauseTimeout = null;
    this._intervalMs = 0;
    this._lastNotification = null;
  }

  start(entryId, options = {}) {
    this.stop();
    this.currentEntryId = entryId;
    this._consecutiveFailures = 0;
    const immediateCapture = options.immediateCapture === true;
    this._intervalMs = (this.config.screenshot_interval || 5) * 60 * 1000;
    const firstDelayMin = this.config.screenshot_first_capture_delay_min != null
      ? this.config.screenshot_first_capture_delay_min : 1;
    const firstDelayMs = firstDelayMin * 60 * 1000;

    if (immediateCapture || firstDelayMs === 0) {
      setImmediate(() => {
        if (!this.currentEntryId) return;
        this.capture().finally(() => {
          if (this.currentEntryId) this._startInterval();
        });
      });
    } else {
      this.initialTimeout = setTimeout(() => {
        this.initialTimeout = null;
        if (!this.currentEntryId) return;
        this.capture().finally(() => {
          if (this.currentEntryId) this._startInterval();
        });
      }, firstDelayMs);
    }
  }

  _startInterval() {
    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(() => this.capture(), this._intervalMs);
  }

  stop() {
    if (this.initialTimeout) {
      clearTimeout(this.initialTimeout);
      this.initialTimeout = null;
    }
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this._pauseTimeout) {
      clearTimeout(this._pauseTimeout);
      this._pauseTimeout = null;
    }
    this.currentEntryId = null;
    this._capturing = false;
    this._closeNotification();
  }

  // ── macOS Screen Recording Permission ─────────────────────────────

  _hasScreenPermission() {
    if (process.platform !== 'darwin') return true;
    try {
      const status = systemPreferences.getMediaAccessStatus('screen');
      // 'granted' = full access, 'not-determined' = never prompted yet (still can capture)
      // Only 'denied' or 'restricted' should block capture
      return status !== 'denied' && status !== 'restricted';
    } catch {
      return true;
    }
  }

  // ── Capture Size ──────────────────────────────────────────────────

  _getCaptureSizeForDisplay(display) {
    const maxWidth = 3840;
    const maxHeight = 2160;
    const physicalWidth = Math.round(display.size.width * display.scaleFactor);
    const physicalHeight = Math.round(display.size.height * display.scaleFactor);
    return {
      width: Math.min(physicalWidth, maxWidth),
      height: Math.min(physicalHeight, maxHeight),
    };
  }

  _getPrimaryDisplaySize() {
    try {
      const primary = screen.getPrimaryDisplay();
      return this._getCaptureSizeForDisplay(primary);
    } catch {
      return { width: 1920, height: 1080 };
    }
  }

  // ── Core Capture — uses desktopCapturer correctly ─────────────────

  async capture() {
    if (!this.currentEntryId) return;
    if (this._capturing) return;
    this._capturing = true;

    // Skip if capture_only_when_visible is enabled and popup is not visible
    if (this.config.capture_only_when_visible === true) {
      if (this.getIsAppVisible && !this.getIsAppVisible()) {
        this._capturing = false;
        return;
      }
    }

    // macOS: Check screen recording permission
    if (!this._hasScreenPermission()) {
      this._capturing = false;
      this._handleCaptureFailure('Screen recording permission denied on macOS');
      return;
    }

    try {
      const captureSize = this._getPrimaryDisplaySize();

      // desktopCapturer.getSources works from main process in Electron 28
      // but requires proper thumbnail size matching the display
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: captureSize,
      });

      if (!sources || sources.length === 0) {
        this._capturing = false;
        this._handleCaptureFailure('No screen sources available — check screen recording permission');
        return;
      }

      const multiMonitor = this.config.capture_multi_monitor === true && sources.length > 1;
      let buffer;

      if (multiMonitor) {
        buffer = await this._captureMultiMonitor(sources);
      } else {
        buffer = this._captureSingleMonitor(sources);
      }

      if (!buffer || buffer.length === 0) {
        this._capturing = false;
        this._handleCaptureFailure('Capture returned empty buffer — screen may be locked or permission missing');
        return;
      }

      // Blur if configured
      if (this.config.blur_screenshots) {
        buffer = await this._applyBlur(buffer);
      }

      // Re-check entryId in case timer was stopped during capture
      if (this.currentEntryId) {
        await this.upload(buffer);
        this._showNotification();
        this._consecutiveFailures = 0;
      }
    } catch (e) {
      this._handleCaptureFailure(e.message);
    } finally {
      this._capturing = false;
    }
  }

  // ── Single Monitor ────────────────────────────────────────────────

  _captureSingleMonitor(sources) {
    // Pick "Entire Screen" or the first source (index 0 is usually the primary)
    const source = sources.find(s => s.name === 'Entire Screen') || sources[0];
    if (!source) return null;
    const image = source.thumbnail;
    if (!image || image.isEmpty()) return null;
    return image.toJPEG(80);
  }

  // ── Multi-Monitor ─────────────────────────────────────────────────

  async _captureMultiMonitor(sources) {
    const sharpLib = getSharp();

    if (!sharpLib) {
      return this._captureSingleMonitor(sources);
    }

    // Get all valid thumbnails as PNG buffers
    const pngImages = [];
    for (const s of sources) {
      if (s.thumbnail && !s.thumbnail.isEmpty()) {
        pngImages.push(s.thumbnail.toPNG());
      }
    }

    if (pngImages.length === 0) return null;
    if (pngImages.length === 1) {
      return sharpLib(pngImages[0]).jpeg({ quality: 80 }).toBuffer();
    }

    // Sort by display position (left-to-right) using bounds.x
    // Since desktopCapturer doesn't reliably map to display IDs,
    // we sort sources by their index and trust the OS ordering (usually left-to-right).
    // On macOS, sources are already ordered by display arrangement.

    // Get dimensions
    const metas = [];
    for (const img of pngImages) {
      metas.push(await sharpLib(img).metadata());
    }

    let totalWidth = 0;
    let maxHeight = 0;
    const composites = [];

    for (let i = 0; i < pngImages.length; i++) {
      const w = metas[i].width || 1920;
      const h = metas[i].height || 1080;
      maxHeight = Math.max(maxHeight, h);
      composites.push({ input: pngImages[i], left: totalWidth, top: 0 });
      totalWidth += w;
    }

    return sharpLib({
      create: {
        width: totalWidth,
        height: maxHeight,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .composite(composites)
      .jpeg({ quality: 80 })
      .toBuffer();
  }

  // ── Blur ──────────────────────────────────────────────────────────

  async _applyBlur(buffer) {
    const sharpLib = getSharp();
    if (!sharpLib) return buffer;
    try {
      return await sharpLib(buffer).blur(15).jpeg({ quality: 80 }).toBuffer();
    } catch (e) {
      console.warn('Blur failed:', e.message);
      return buffer;
    }
  }

  // ── Failure Tracking ──────────────────────────────────────────────

  _handleCaptureFailure(reason) {
    this._consecutiveFailures++;
    console.error(`Screenshot capture failed (${this._consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`, reason);

    if (this._consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.warn(`Screenshot capture paused after ${MAX_CONSECUTIVE_FAILURES} failures. Retrying in 5 minutes.`);
      if (this.interval) {
        clearInterval(this.interval);
        this.interval = null;
      }
      this._pauseTimeout = setTimeout(() => {
        this._pauseTimeout = null;
        this._consecutiveFailures = 0;
        if (this.currentEntryId) {
          console.log('Screenshot capture resumed after pause');
          this._startInterval();
        }
      }, FAILURE_PAUSE_MS);
    }
  }

  // ── Notification ──────────────────────────────────────────────────

  _showNotification() {
    try {
      if (!Notification.isSupported()) return;
      this._closeNotification();

      const notification = new Notification({
        title: 'TrackFlow',
        body: 'Screenshot captured',
        silent: true,
        timeoutType: 'default',
      });
      notification.show();
      this._lastNotification = notification;

      const ref = notification;
      setTimeout(() => {
        try { ref.close(); } catch {}
        if (this._lastNotification === ref) this._lastNotification = null;
      }, 3000);
    } catch (e) {
      console.warn('Could not show screenshot notification:', e.message);
    }
  }

  _closeNotification() {
    if (this._lastNotification) {
      try { this._lastNotification.close(); } catch {}
      this._lastNotification = null;
    }
  }

  // ── Upload ────────────────────────────────────────────────────────

  async upload(buffer) {
    const formData = new FormData();
    formData.append('file', buffer, {
      filename: `screenshot_${Date.now()}.jpg`,
      contentType: 'image/jpeg',
    });
    formData.append('time_entry_id', String(this.currentEntryId));
    formData.append('captured_at', new Date().toISOString());

    try {
      await this.apiClient.uploadScreenshot(formData);
    } catch (e) {
      console.error('Screenshot upload failed:', e.message);
      // Queue for offline sync — but only if buffer is small enough
      // to avoid SQLite bloat (500KB base64 ≈ 375KB raw JPEG)
      if (buffer.length < 375 * 1024) {
        this.offlineQueue.add('screenshot', {
          buffer: buffer.toString('base64'),
          time_entry_id: String(this.currentEntryId),
          captured_at: new Date().toISOString(),
        });
      } else {
        console.warn(`Screenshot too large for offline queue (${Math.round(buffer.length / 1024)}KB), skipping`);
      }
    }
  }
}

module.exports = ScreenshotService;
