// AGENT-06: Offline queue using better-sqlite3
// Queues heartbeats + screenshots locally when network unavailable
// Flushes on reconnect with exponential backoff
//
// SS-4: Screenshots are stored as files on disk (not base64 in SQLite).
// SQLite only stores the file path. This prevents database bloat and
// keeps SQLite fast even with hundreds of queued screenshots.

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// Max size for screenshot file storage (2MB)
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
    this._screenshotDir = null;

    this.init();
  }

  init() {
    try {
      const Database = require('better-sqlite3');
      const dbPath = path.join(app.getPath('userData'), 'offline-queue.db');
      this.db = new Database(dbPath);

      // Enable WAL mode for better concurrent read/write
      this.db.pragma('journal_mode = WAL');
      // Set busy timeout to handle SQLITE_BUSY errors from concurrent access
      this.db.pragma('busy_timeout = 5000');

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

      // Ensure screenshot directory exists
      this._screenshotDir = path.join(app.getPath('userData'), 'offline-screenshots');
      if (!fs.existsSync(this._screenshotDir)) {
        fs.mkdirSync(this._screenshotDir, { recursive: true });
      }

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
        // Get entries that will be deleted so we can clean up their screenshot files
        const toDelete = this.db.prepare(
          'SELECT id, type, data FROM queue ORDER BY id LIMIT ?'
        ).all(excess);
        this._deleteEntriesAndFiles(toDelete);
      }
      // Get old entries (>7 days) so we can clean up their files
      const oldEntries = this.db.prepare(
        `SELECT id, type, data FROM queue WHERE created_at < datetime('now', '-7 days')`
      ).all();
      this._deleteEntriesAndFiles(oldEntries);

      // Get entries with too many attempts
      const failedEntries = this.db.prepare(
        'SELECT id, type, data FROM queue WHERE attempts >= 5'
      ).all();
      this._deleteEntriesAndFiles(failedEntries);
    } catch (e) {
      console.error('Failed to prune queue:', e.message);
    }
  }

  /**
   * Delete queue entries from SQLite and clean up associated screenshot files.
   */
  _deleteEntriesAndFiles(entries) {
    if (!entries || entries.length === 0) return;
    const ids = [];
    for (const entry of entries) {
      ids.push(entry.id);
      // Clean up screenshot file if this is a screenshot entry
      if (entry.type === 'screenshot') {
        try {
          const data = JSON.parse(entry.data);
          if (data.file_path && fs.existsSync(data.file_path)) {
            fs.unlinkSync(data.file_path);
          }
        } catch {}
      }
    }
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      this.db.prepare(`DELETE FROM queue WHERE id IN (${placeholders})`).run(...ids);
    }
  }

  add(type, data) {
    if (!this.db) return;

    try {
      if (type === 'screenshot' && data.buffer) {
        // SS-4: Write screenshot buffer to file, store path in SQLite
        const buffer = Buffer.isBuffer(data.buffer) ? data.buffer : Buffer.from(data.buffer, 'base64');
        if (buffer.length > MAX_SCREENSHOT_SIZE) {
          console.warn('Screenshot too large for offline queue, skipping');
          return;
        }

        const filename = `ss_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
        const filePath = path.join(this._screenshotDir, filename);
        fs.writeFileSync(filePath, buffer);

        // Store file path (not the blob) in SQLite
        const queueData = {
          file_path: filePath,
          time_entry_id: data.time_entry_id,
          captured_at: data.captured_at,
        };
        if (data.app_name) queueData.app_name = data.app_name;
        if (data.window_title) queueData.window_title = data.window_title;
        this._stmtInsert.run(type, JSON.stringify(queueData));
        console.log(`[OfflineQueue] Screenshot saved to file: ${filename} (${Math.round(buffer.length / 1024)}KB)`);
      } else {
        this._stmtInsert.run(type, JSON.stringify(data));
      }
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
      const screenshotFilesToDelete = []; // Track files to delete after successful upload

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
            // SS-4: Read screenshot from file, not from base64 in SQLite
            let buffer;
            if (data.file_path) {
              // New file-based format
              if (!fs.existsSync(data.file_path)) {
                console.warn(`[OfflineQueue] Screenshot file missing: ${data.file_path}`);
                deleteIds.push(item.id);
                continue;
              }
              buffer = fs.readFileSync(data.file_path);
            } else if (data.buffer) {
              // Legacy base64 format (migration path)
              buffer = Buffer.from(data.buffer, 'base64');
            } else {
              deleteIds.push(item.id);
              continue;
            }

            const FormData = require('form-data');
            const formData = new FormData();
            formData.append('file', buffer, {
              filename: `screenshot_${Date.now()}.jpg`,
              contentType: 'image/jpeg',
            });
            formData.append('time_entry_id', data.time_entry_id);
            formData.append('captured_at', data.captured_at);
            if (data.app_name) formData.append('app_name', data.app_name);
            if (data.window_title) formData.append('window_title', data.window_title);

            await apiClient.uploadScreenshot(formData);
            deleteIds.push(item.id);
            // Track file for deletion after successful upload
            if (data.file_path) {
              screenshotFilesToDelete.push(data.file_path);
            }
          } else if (item.type === 'idle_discard') {
            await apiClient.reportIdleTime(data);
            deleteIds.push(item.id);
          }
        } catch (e) {
          // Update attempt count
          this._stmtIncAttempt.run(item.id);

          // Remove items that have failed too many times
          if (item.attempts >= 4) { // Will be 5 after the update above
            deleteIds.push(item.id);
            if (data.file_path && fs.existsSync(data.file_path)) {
              screenshotFilesToDelete.push(data.file_path);
            }
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

      // Delete successfully processed items from SQLite
      if (deleteIds.length > 0) {
        const placeholders = deleteIds.map(() => '?').join(',');
        this.db.prepare(`DELETE FROM queue WHERE id IN (${placeholders})`).run(...deleteIds);
      }

      // Delete screenshot files after successful upload
      for (const filePath of screenshotFilesToDelete) {
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch (e) {
          console.warn(`[OfflineQueue] Failed to delete screenshot file: ${e.message}`);
        }
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

  /**
   * Clean up orphaned screenshot files that are not referenced in the queue.
   */
  cleanupOrphanedFiles() {
    if (!this.db || !this._screenshotDir) return;
    try {
      if (!fs.existsSync(this._screenshotDir)) return;

      // Get all file paths currently referenced in the queue
      const rows = this.db.prepare(
        "SELECT data FROM queue WHERE type = 'screenshot'"
      ).all();
      const referencedFiles = new Set();
      for (const row of rows) {
        try {
          const data = JSON.parse(row.data);
          if (data.file_path) {
            referencedFiles.add(path.basename(data.file_path));
          }
        } catch {}
      }

      // Delete files not referenced in the queue
      const files = fs.readdirSync(this._screenshotDir);
      let cleaned = 0;
      for (const file of files) {
        if (!referencedFiles.has(file)) {
          try {
            fs.unlinkSync(path.join(this._screenshotDir, file));
            cleaned++;
          } catch {}
        }
      }
      if (cleaned > 0) {
        console.log(`[OfflineQueue] Cleaned up ${cleaned} orphaned screenshot file(s)`);
      }
    } catch (e) {
      console.error('[OfflineQueue] Orphan cleanup failed:', e.message);
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
