// AGENT-02: Screenshot capture at org-configured interval
// AGENT-09: Blur support via sharp
// Multi-monitor: composite all screens; optional capture_only_when_visible to reduce permission prompts

const { desktopCapturer, Notification } = require('electron');
const FormData = require('form-data');

class ScreenshotService {
  constructor(apiClient, config, offlineQueue, getIsAppVisible = null) {
    this.apiClient = apiClient;
    this.config = config;
    this.offlineQueue = offlineQueue;
    this.getIsAppVisible = typeof getIsAppVisible === 'function' ? getIsAppVisible : null;
    this.interval = null;
    this.initialTimeout = null;
    this.currentEntryId = null;
    this._cachedSourceId = null; // Reuse same source when possible to reduce permission prompts
  }

  start(entryId) {
    this.stop(); // Clear any previous timers
    this.currentEntryId = entryId;
    const intervalMs = (this.config.screenshot_interval || 5) * 60 * 1000;

    // Take first screenshot after 1 minute
    this.initialTimeout = setTimeout(() => {
      this.capture();
      this.initialTimeout = null;
    }, 60000);

    // Then capture at configured interval
    this.interval = setInterval(() => this.capture(), intervalMs);
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
    this.currentEntryId = null;
    this._cachedSourceId = null;
  }

  async capture() {
    if (!this.currentEntryId) return;

    // Skip capture when app is in background (reduces permission re-prompts on Linux when reopening)
    const captureOnlyWhenVisible = this.config.capture_only_when_visible !== false;
    if (captureOnlyWhenVisible && this.getIsAppVisible && !this.getIsAppVisible()) {
      return;
    }

    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 },
      });

      if (!sources || sources.length === 0) {
        console.warn('No screen sources available for screenshot');
        return;
      }

      // Multi-monitor: capture all screens and composite left-to-right; else primary only
      const multiMonitor = this.config.capture_multi_monitor === true && sources.length > 1;
      let buffer;

      if (multiMonitor) {
        const sharp = require('sharp');
        const sorted = [...sources].sort((a, b) => {
          const idA = parseInt(a.display_id, 10) || 0;
          const idB = parseInt(b.display_id, 10) || 0;
          return idA - idB;
        });
        const images = sorted.filter(s => s.thumbnail && !s.thumbnail.isEmpty()).map(s => s.thumbnail.toJPEG(80));
        if (images.length === 0) return;
        if (images.length === 1) {
          buffer = Buffer.from(images[0]);
        } else {
          const meta = await sharp(images[0]).metadata();
          let width = meta.width || 1920;
          let height = meta.height || 1080;
          const composites = [];
          let x = 0;
          for (let i = 0; i < images.length; i++) {
            const m = await sharp(images[i]).metadata();
            const w = m.width || 1920;
            const h = m.height || 1080;
            height = Math.max(height, h);
            composites.push({ input: images[i], left: x, top: 0 });
            x += w;
          }
          width = x;
          buffer = await sharp({
            create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } },
          })
            .composite(composites)
            .jpeg({ quality: 80 })
            .toBuffer();
        }
      } else {
        const source = this._cachedSourceId
          ? sources.find(s => s.id === this._cachedSourceId) || sources[0]
          : sources[0];
        this._cachedSourceId = source.id;
        const image = source.thumbnail;
        if (image.isEmpty()) return;
        buffer = image.toJPEG(80);
      }

      // AGENT-09: Blur if configured
      if (this.config.blur_screenshots) {
        try {
          const sharp = require('sharp');
          buffer = await sharp(buffer)
            .blur(15)
            .jpeg({ quality: 80 })
            .toBuffer();
        } catch (e) {
          console.warn('Sharp not available for blurring:', e.message);
        }
      }

      // Re-check entryId in case timer was stopped during capture
      if (this.currentEntryId) {
        await this.upload(buffer);
        this.showScreenshotNotification();
      }
    } catch (e) {
      this._cachedSourceId = null;
      console.error('Screenshot capture failed:', e.message);
    }
  }

  showScreenshotNotification() {
    try {
      if (Notification.isSupported()) {
        const notification = new Notification({
          title: 'TrackFlow',
          body: 'Screenshot captured',
          silent: true,
          timeoutType: 'default',
        });
        notification.show();
        // Auto-close after 3 seconds (like Hubstaff)
        setTimeout(() => notification.close(), 3000);
      }
    } catch (e) {
      console.warn('Could not show screenshot notification:', e.message);
    }
  }

  async upload(buffer) {
    const formData = new FormData();
    formData.append('file', buffer, {
      filename: `screenshot_${Date.now()}.jpg`,
      contentType: 'image/jpeg',
    });
    formData.append('time_entry_id', this.currentEntryId);
    formData.append('captured_at', new Date().toISOString());

    try {
      await this.apiClient.uploadScreenshot(formData);
    } catch (e) {
      console.error('Screenshot upload failed:', e.message);
      // AGENT-06: Queue if offline
      this.offlineQueue.add('screenshot', {
        buffer: buffer.toString('base64'),
        time_entry_id: this.currentEntryId,
        captured_at: new Date().toISOString(),
      });
    }
  }
}

module.exports = ScreenshotService;
