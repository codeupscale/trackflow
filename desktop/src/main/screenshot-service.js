// AGENT-02: Screenshot capture at org-configured interval
// AGENT-09: Blur support via sharp

const { desktopCapturer } = require('electron');
const FormData = require('form-data');

class ScreenshotService {
  constructor(apiClient, config, offlineQueue) {
    this.apiClient = apiClient;
    this.config = config;
    this.offlineQueue = offlineQueue;
    this.interval = null;
    this.currentEntryId = null;
  }

  start(entryId) {
    this.currentEntryId = entryId;
    const intervalMs = (this.config.screenshot_interval || 5) * 60 * 1000;

    // Take first screenshot after 1 minute
    setTimeout(() => this.capture(), 60000);

    // Then capture at configured interval
    this.interval = setInterval(() => this.capture(), intervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.currentEntryId = null;
  }

  async capture() {
    if (!this.currentEntryId) return;

    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 },
      });

      for (const source of sources) {
        const image = source.thumbnail;
        let buffer = image.toJPEG(80);

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

        await this.upload(buffer);
      }
    } catch (e) {
      console.error('Screenshot capture failed:', e.message);
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
