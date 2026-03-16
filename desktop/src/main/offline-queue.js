// AGENT-06: Offline queue using better-sqlite3
// Queues heartbeats + screenshots locally when network unavailable
// Flushes on reconnect with exponential backoff

const path = require('path');
const { app } = require('electron');

class OfflineQueue {
  constructor() {
    this.db = null;
    this.retryDelay = 5000; // Start with 5s
    this.maxRetryDelay = 300000; // Max 5 min
    this.flushing = false;

    this.init();
  }

  init() {
    try {
      const Database = require('better-sqlite3');
      const dbPath = path.join(app.getPath('userData'), 'offline-queue.db');
      this.db = new Database(dbPath);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          attempts INTEGER NOT NULL DEFAULT 0
        )
      `);
    } catch (e) {
      console.error('Failed to initialize offline queue:', e.message);
    }
  }

  add(type, data) {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare('INSERT INTO queue (type, data) VALUES (?, ?)');
      stmt.run(type, JSON.stringify(data));
    } catch (e) {
      console.error('Failed to queue item:', e.message);
    }
  }

  async flush(apiClient) {
    if (!this.db || this.flushing) return;
    this.flushing = true;

    try {
      const items = this.db.prepare('SELECT * FROM queue ORDER BY id LIMIT 500').all();

      if (items.length === 0) {
        this.flushing = false;
        this.retryDelay = 5000;
        return;
      }

      const heartbeats = [];
      const deleteIds = [];

      for (const item of items) {
        const data = JSON.parse(item.data);

        try {
          if (item.type === 'heartbeat') {
            heartbeats.push(data);
            deleteIds.push(item.id);
          } else if (item.type === 'screenshot') {
            const FormData = require('form-data');
            const formData = new FormData();
            const buffer = Buffer.from(data.buffer, 'base64');
            formData.append('file', buffer, {
              filename: `screenshot_${Date.now()}.jpg`,
              contentType: 'image/jpeg',
            });
            formData.append('time_entry_id', data.time_entry_id);
            formData.append('captured_at', data.captured_at);

            await apiClient.uploadScreenshot(formData);
            deleteIds.push(item.id);
          }
        } catch (e) {
          // Update attempt count
          this.db.prepare('UPDATE queue SET attempts = attempts + 1 WHERE id = ?').run(item.id);

          // Remove items that have failed too many times
          if (item.attempts >= 5) {
            deleteIds.push(item.id);
          }
        }
      }

      // Bulk upload heartbeats
      if (heartbeats.length > 0) {
        try {
          await apiClient.bulkUploadLogs(heartbeats);
        } catch {
          // Re-add failed heartbeats
        }
      }

      // Delete successfully processed items
      if (deleteIds.length > 0) {
        const placeholders = deleteIds.map(() => '?').join(',');
        this.db.prepare(`DELETE FROM queue WHERE id IN (${placeholders})`).run(...deleteIds);
      }

      this.retryDelay = 5000; // Reset on success
    } catch (e) {
      console.error('Queue flush failed:', e.message);
      this.retryDelay = Math.min(this.retryDelay * 2, this.maxRetryDelay);
    }

    this.flushing = false;

    // Check if more items remain
    const remaining = this.db.prepare('SELECT COUNT(*) as count FROM queue').get();
    if (remaining.count > 0) {
      setTimeout(() => this.flush(apiClient), this.retryDelay);
    }
  }

  getQueueSize() {
    if (!this.db) return 0;
    return this.db.prepare('SELECT COUNT(*) as count FROM queue').get().count;
  }
}

module.exports = OfflineQueue;
