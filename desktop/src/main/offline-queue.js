// AGENT-06: Offline queue using better-sqlite3
// Queues heartbeats + screenshots locally when network unavailable
// Flushes on reconnect with exponential backoff

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// Max size for screenshot storage in queue (2MB) — prevent DB bloat
const MAX_SCREENSHOT_SIZE = 2 * 1024 * 1024;
// Max total queue size before pruning old entries
const MAX_QUEUE_ENTRIES = 1000;

class OfflineQueue {
  constructor() {
    this.db = null;
    this.retryDelay = 5000; // Start with 5s
    this.maxRetryDelay = 300000; // Max 5 min
    this.flushing = false;
    this._flushTimer = null;

    this.init();
  }

  init() {
    try {
      const Database = require('better-sqlite3');
      const dbPath = path.join(app.getPath('userData'), 'offline-queue.db');
      this.db = new Database(dbPath);

      // Enable WAL mode for better concurrent read/write
      this.db.pragma('journal_mode = WAL');

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          attempts INTEGER NOT NULL DEFAULT 0
        )
      `);

      // Prepare commonly used statements for performance
      this._stmtInsert = this.db.prepare('INSERT INTO queue (type, data) VALUES (?, ?)');
      this._stmtSelect = this.db.prepare('SELECT * FROM queue ORDER BY id LIMIT 500');
      this._stmtCount = this.db.prepare('SELECT COUNT(*) as count FROM queue');
      this._stmtIncAttempt = this.db.prepare('UPDATE queue SET attempts = attempts + 1 WHERE id = ?');

      // Prune old entries on startup to prevent unbounded growth
      this._pruneOldEntries();
    } catch (e) {
      console.error('Failed to initialize offline queue:', e.message);
    }
  }

  _pruneOldEntries() {
    if (!this.db) return;
    try {
      const count = this._stmtCount.get().count;
      if (count > MAX_QUEUE_ENTRIES) {
        const excess = count - MAX_QUEUE_ENTRIES;
        this.db.prepare(`DELETE FROM queue WHERE id IN (SELECT id FROM queue ORDER BY id LIMIT ?)`).run(excess);
      }
      // Delete entries older than 7 days
      this.db.prepare(`DELETE FROM queue WHERE created_at < datetime('now', '-7 days')`).run();
      // Delete entries with too many attempts
      this.db.prepare(`DELETE FROM queue WHERE attempts >= 5`).run();
    } catch (e) {
      console.error('Failed to prune queue:', e.message);
    }
  }

  add(type, data) {
    if (!this.db) return;

    try {
      // Limit screenshot size to prevent SQLite bloat
      if (type === 'screenshot' && data.buffer) {
        const bufferSize = Buffer.byteLength(data.buffer, 'base64');
        if (bufferSize > MAX_SCREENSHOT_SIZE) {
          console.warn('Screenshot too large for offline queue, skipping');
          return;
        }
      }

      this._stmtInsert.run(type, JSON.stringify(data));
    } catch (e) {
      console.error('Failed to queue item:', e.message);
    }
  }

  async flush(apiClient) {
    if (!this.db || this.flushing) return;
    this.flushing = true;

    // Clear any pending retry timer
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }

    try {
      const items = this._stmtSelect.all();

      if (items.length === 0) {
        this.flushing = false;
        this.retryDelay = 5000;
        return;
      }

      const heartbeats = [];
      const heartbeatIds = [];  // Track separately — only delete after successful bulk upload
      const deleteIds = [];

      for (const item of items) {
        let data;
        try {
          data = JSON.parse(item.data);
        } catch {
          deleteIds.push(item.id); // Corrupt entry — remove
          continue;
        }

        try {
          if (item.type === 'heartbeat') {
            heartbeats.push(data);
            heartbeatIds.push(item.id);
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
          this._stmtIncAttempt.run(item.id);

          // Remove items that have failed too many times
          if (item.attempts >= 4) { // Will be 5 after the update above
            deleteIds.push(item.id);
          }
        }
      }

      // Bulk upload heartbeats — only delete from queue on success
      if (heartbeats.length > 0) {
        try {
          await apiClient.bulkUploadLogs(heartbeats);
          // Success — mark heartbeats for deletion
          deleteIds.push(...heartbeatIds);
        } catch {
          // Failed — heartbeats stay in queue for retry next flush
          for (const hid of heartbeatIds) {
            this._stmtIncAttempt.run(hid);
          }
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
    try {
      const remaining = this._stmtCount.get();
      if (remaining.count > 0) {
        this._flushTimer = setTimeout(() => this.flush(apiClient), this.retryDelay);
      }
    } catch {}
  }

  getQueueSize() {
    if (!this.db) return 0;
    try {
      return this._stmtCount.get().count;
    } catch {
      return 0;
    }
  }

  close() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    if (this.db) {
      try {
        this.db.close();
      } catch {}
      this.db = null;
    }
  }
}

module.exports = OfflineQueue;
