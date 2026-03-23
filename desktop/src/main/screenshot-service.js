// AGENT-02: Screenshot capture at org-configured interval
// AGENT-09: Blur support via sharp
// Multi-monitor: composite all screens at native resolution
// Cross-platform: macOS (permission check), Windows, Linux

const { desktopCapturer, Notification, screen, systemPreferences } = require('electron');
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

// Max consecutive failures before pausing captures (avoids CPU waste when permission denied)
const MAX_CONSECUTIVE_FAILURES = 5;
// Pause duration after max failures (5 minutes) before retrying
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
    this._cachedSourceId = null;
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
      // Capture immediately, then start interval regardless of capture result
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
    this._cachedSourceId = null;
    this._capturing = false;
    this._closeNotification();
  }

  // ── macOS Screen Recording Permission Check ─────────────────────────────

  _hasScreenPermission() {
    if (process.platform !== 'darwin') return true; // Windows/Linux don't require explicit permission
    // systemPreferences.getMediaAccessStatus('screen') available since Electron 11
    try {
      const status = systemPreferences.getMediaAccessStatus('screen');
      return status === 'granted';
    } catch {
      // Older Electron or API unavailable — assume granted
      return true;
    }
  }

  // ── Native Resolution for Each Display ──────────────────────────────────

  _getCaptureSizeForDisplay(display) {
    // Use the display's actual pixel size (accounts for HiDPI/Retina)
    // scaleFactor: 2 on Retina means 1440x900 logical = 2880x1800 physical
    // We cap at the physical resolution for quality but limit to 3840 to prevent huge files
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

  // ── Core Capture Logic ──────────────────────────────────────────────────

  async capture() {
    if (!this.currentEntryId) return;
    if (this._capturing) return;
    this._capturing = true;

    // Skip if capture_only_when_visible is enabled and popup is not visible
    // NOTE: This flag means "only capture when the TrackFlow popup is open" —
    // it's an org privacy setting, NOT the default behavior.
    if (this.config.capture_only_when_visible === true) {
      if (this.getIsAppVisible && !this.getIsAppVisible()) {
        this._capturing = false;
        return;
      }
    }

    // macOS: Check screen recording permission before attempting capture
    if (!this._hasScreenPermission()) {
      this._capturing = false;
      this._handleCaptureFailure('Screen recording permission not granted on macOS');
      return;
    }

    try {
      // Use native display resolution instead of fixed 1920x1080
      const captureSize = this._getPrimaryDisplaySize();

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: captureSize,
      });

      if (!sources || sources.length === 0) {
        this._capturing = false;
        this._handleCaptureFailure('No screen sources available');
        return;
      }

      const multiMonitor = this.config.capture_multi_monitor === true && sources.length > 1;
      let buffer;

      if (multiMonitor) {
        buffer = await this._captureMultiMonitor(sources);
      } else {
        buffer = this._captureSingleMonitor(sources);
      }

      if (!buffer) {
        this._capturing = false;
        this._handleCaptureFailure('Capture returned empty buffer');
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
        this._consecutiveFailures = 0; // Reset on success
      }
    } catch (e) {
      this._cachedSourceId = null;
      this._handleCaptureFailure(e.message);
    } finally {
      this._capturing = false;
    }
  }

  // ── Single Monitor Capture ──────────────────────────────────────────────

  _captureSingleMonitor(sources) {
    const source = this._cachedSourceId
      ? sources.find(s => s.id === this._cachedSourceId) || sources[0]
      : sources[0];
    this._cachedSourceId = source.id;
    const image = source.thumbnail;
    if (!image || image.isEmpty()) return null;
    return image.toJPEG(80);
  }

  // ── Multi-Monitor Capture ───────────────────────────────────────────────

  async _captureMultiMonitor(sources) {
    const sharpLib = getSharp();

    if (!sharpLib) {
      // Fallback: capture only primary screen when sharp unavailable
      return this._captureSingleMonitor(sources);
    }

    // Sort sources by physical left-to-right position using screen.getAllDisplays()
    let sorted;
    try {
      const displays = screen.getAllDisplays().sort((a, b) => a.bounds.x - b.bounds.x);
      const displayOrder = new Map(displays.map((d, i) => [String(d.id), i]));
      sorted = [...sources].sort((a, b) => {
        const orderA = displayOrder.get(a.display_id) ?? 999;
        const orderB = displayOrder.get(b.display_id) ?? 999;
        return orderA - orderB;
      });
    } catch {
      sorted = [...sources];
    }

    // Get valid thumbnails as PNG buffers (NOT JPEG — avoid double compression)
    const pngImages = [];
    for (const s of sorted) {
      if (s.thumbnail && !s.thumbnail.isEmpty()) {
        pngImages.push(s.thumbnail.toPNG());
      }
    }

    if (pngImages.length === 0) return null;
    if (pngImages.length === 1) {
      // Single valid source — encode to JPEG once
      return sharpLib(pngImages[0]).jpeg({ quality: 80 }).toBuffer();
    }

    // Composite all screens left-to-right
    // First, get dimensions of each image
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

    // Create canvas and composite — single JPEG encode at the end
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

  // ── Blur ────────────────────────────────────────────────────────────────

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

  // ── Failure Tracking ────────────────────────────────────────────────────

  _handleCaptureFailure(reason) {
    this._consecutiveFailures++;
    console.error(`Screenshot capture failed (${this._consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`, reason);

    if (this._consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.warn(`Screenshot capture paused after ${MAX_CONSECUTIVE_FAILURES} consecutive failures. Retrying in 5 minutes.`);
      // Pause the interval to stop wasting CPU
      if (this.interval) {
        clearInterval(this.interval);
        this.interval = null;
      }
      // Retry after pause
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

  // ── Notification (cross-platform safe) ──────────────────────────────────

  _showNotification() {
    try {
      if (!Notification.isSupported()) return;

      // Close previous notification before showing new one
      this._closeNotification();

      const notification = new Notification({
        title: 'TrackFlow',
        body: 'Screenshot captured',
        silent: true,
        timeoutType: 'default',
      });
      notification.show();
      this._lastNotification = notification;

      // Auto-close after 3 seconds — use weak reference pattern to avoid leak
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

  // ── Upload ──────────────────────────────────────────────────────────────

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
      // Only queue if buffer is reasonable size (< 500KB as base64 ≈ 375KB raw JPEG)
      // Prevents SQLite bloat from huge multi-monitor composites
      const base64 = buffer.toString('base64');
      if (base64.length < 500 * 1024) {
        this.offlineQueue.add('screenshot', {
          buffer: base64,
          time_entry_id: String(this.currentEntryId),
          captured_at: new Date().toISOString(),
        });
      } else {
        console.warn('Screenshot too large for offline queue, discarding');
      }
    }
  }
}

module.exports = ScreenshotService;
