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

// Exponential backoff schedule: 5s, 15s, 30s, 60s, 120s (cap)
const BACKOFF_SCHEDULE = [5000, 15000, 30000, 60000, 120000];

class OfflineQueue {
  constructor() {
    this.db = null;
    this.retryDelay = BACKOFF_SCHEDULE[0];
    this._backoffStep = 0;
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

      // L10: Schema versioning — run migrations incrementally
      this._runMigrations();

      // Prepare commonly used statements for performance
      // L9: Insert now includes priority; select orders by priority DESC then id ASC
      this._stmtInsert = this.db.prepare('INSERT INTO queue (type, data, priority) VALUES (?, ?, ?)');
      this._stmtSelect = this.db.prepare('SELECT * FROM queue ORDER BY priority DESC, id ASC LIMIT 500');
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

  // L10: Schema version table + incremental migrations
  _runMigrations() {
    if (!this.db) return;

    // Create schema_version table if it doesn't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER NOT NULL DEFAULT 0
      )
    `);

    // Ensure exactly one row exists
    const row = this.db.prepare('SELECT version FROM schema_version').get();
    if (!row) {
      this.db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
    }
    let currentVersion = row ? row.version : 0;

    // Migration 1: Add priority column (L9)
    if (currentVersion < 1) {
      try {
        // Check if column already exists (safe for existing installs)
        const cols = this.db.pragma('table_info(queue)');
        const hasPriority = cols.some(c => c.name === 'priority');
        if (!hasPriority) {
          this.db.exec('ALTER TABLE queue ADD COLUMN priority INTEGER NOT NULL DEFAULT 0');
          // Backfill: heartbeats get priority 1, screenshots stay 0
          this.db.exec("UPDATE queue SET priority = 1 WHERE type = 'heartbeat'");
        }
        this.db.prepare('UPDATE schema_version SET version = 1').run();
        currentVersion = 1;
        console.log('[OfflineQueue] Migration 1 applied: added priority column');
      } catch (e) {
        console.error('[OfflineQueue] Migration 1 failed:', e.message);
      }
    }

    // Migration 2: Add idempotency_key column for timer start dedup
    if (currentVersion < 2) {
      try {
        const cols = this.db.pragma('table_info(queue)');
        const hasIdempotencyKey = cols.some(c => c.name === 'idempotency_key');
        if (!hasIdempotencyKey) {
          this.db.exec('ALTER TABLE queue ADD COLUMN idempotency_key TEXT');
        }
        this.db.prepare('UPDATE schema_version SET version = 2').run();
        currentVersion = 2;
        console.log('[OfflineQueue] Migration 2 applied: added idempotency_key column');
      } catch (e) {
        console.error('[OfflineQueue] Migration 2 failed:', e.message);
      }
    }

    // Future migrations go here as: if (currentVersion < 3) { ... }
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

  // M2 FIX: async add — uses fs.promises for screenshot file writes
  // L9: priority derived from type — heartbeats=1 (flush first), screenshots=0
  async add(type, data) {
    if (!this.db) return;
    const priority = type === 'heartbeat' ? 1 : 0;

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
        await fs.promises.writeFile(filePath, buffer);

        // Store file path (not the blob) in SQLite
        const queueData = {
          file_path: filePath,
          time_entry_id: data.time_entry_id,
          captured_at: data.captured_at,
        };
        if (data.app_name) queueData.app_name = data.app_name;
        if (data.window_title) queueData.window_title = data.window_title;
        this._stmtInsert.run(type, JSON.stringify(queueData), priority);
        console.log(`[OfflineQueue] Screenshot saved to file: ${filename} (${Math.round(buffer.length / 1024)}KB)`);
      } else {
        this._stmtInsert.run(type, JSON.stringify(data), priority);
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
        console.log('[OfflineQueue] Flush — queue empty, nothing to sync');
        this.flushing = false;
        this._backoffStep = 0;
        this.retryDelay = BACKOFF_SCHEDULE[0];
        return;
      }

      const typeCounts = {};
      for (const item of items) { typeCounts[item.type] = (typeCounts[item.type] || 0) + 1; }
      console.log(`[OfflineQueue] Flush starting — ${items.length} items:`, typeCounts);

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
              // M2 FIX: Use async file read
              try {
                buffer = await fs.promises.readFile(data.file_path);
              } catch (readErr) {
                console.warn(`[OfflineQueue] Screenshot file missing or unreadable: ${data.file_path}`);
                deleteIds.push(item.id);
                continue;
              }
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
            console.log(`[OfflineQueue] Screenshot uploaded successfully (entry=${data.time_entry_id}, captured=${data.captured_at})`);
            deleteIds.push(item.id);
            // Track file for deletion after successful upload
            if (data.file_path) {
              screenshotFilesToDelete.push(data.file_path);
            }
          } else if (item.type === 'idle_discard') {
            await apiClient.reportIdleTime(data);
            deleteIds.push(item.id);
          } else if (item.type === 'timer_start') {
            // Offline timer start — push to server with idempotency key
            try {
              await apiClient.startTimer(data.project_id || null, data.idempotency_key || null);
              deleteIds.push(item.id);
            } catch (startErr) {
              // 200/201 = success (idempotency hit or new entry)
              // 409 = timer already running — also success for our purpose
              if (startErr.response?.status === 409) {
                deleteIds.push(item.id);
              } else {
                throw startErr;
              }
            }
          } else if (item.type === 'timer_stop') {
            // CONNECTIVITY FIX: Retry stopping timer with offline timestamps
            try {
              const stopPayload = {};
              if (data.started_at) stopPayload.started_at = data.started_at;
              if (data.ended_at) stopPayload.ended_at = data.ended_at;
              await apiClient.stopTimer(stopPayload);
              deleteIds.push(item.id);
            } catch (stopErr) {
              // If 404 (no timer running), the timer was already stopped — success
              if (stopErr.response?.status === 404) {
                deleteIds.push(item.id);
              } else {
                throw stopErr; // Let outer catch handle retry logic
              }
            }
          }
        } catch (e) {
          console.warn(`[OfflineQueue] Flush item failed (type=${item.type}, attempt=${item.attempts + 1}): ${e.message}`);
          // Update attempt count
          this._stmtIncAttempt.run(item.id);

          // Remove items that have failed too many times
          if (item.attempts >= 4) { // Will be 5 after the update above
            console.warn(`[OfflineQueue] Dropping item after 5 failed attempts (type=${item.type}, id=${item.id})`);
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
        console.log(`[OfflineQueue] Flush complete — ${deleteIds.length} items processed, ${screenshotFilesToDelete.length} screenshots uploaded`);
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

      // Reset backoff on success
      this._backoffStep = 0;
      this.retryDelay = BACKOFF_SCHEDULE[0];

      // L7: Clean up orphaned screenshot files after successful flush
      this.cleanupOrphanedFiles();
    } catch (e) {
      console.error('Queue flush failed:', e.message);
      // Exponential backoff: step through schedule 5s → 15s → 30s → 60s → 120s (cap)
      this._backoffStep = Math.min(this._backoffStep + 1, BACKOFF_SCHEDULE.length - 1);
      this.retryDelay = BACKOFF_SCHEDULE[this._backoffStep];
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
