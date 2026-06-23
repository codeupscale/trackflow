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

// Pace screenshot uploads during a backlog flush. The server throttles
// screenshots/presign and screenshots/confirm at 60/min (1/sec) each, so firing
// a backlog as fast as possible trips HTTP 429. ~1.1s between screenshots keeps
// us safely under the limit (≈54/min) while still draining the backlog promptly.
const SCREENSHOT_FLUSH_INTERVAL_MS = 1100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A transient error means "retry later", NOT "this item is bad". Rate limiting
// (429), server errors (5xx), and network failures (no response) must NOT count
// toward the drop-after-5-attempts limit — otherwise a rate-limited backlog
// silently loses valid screenshots. Genuine client errors (other 4xx) are permanent.
function isTransientError(e) {
  const status = e && e.response && e.response.status;
  if (status === 429) return true;            // rate limited — slow down & retry
  if (status >= 500 && status < 600) return true; // server error — retry
  if (!status) return true;                   // network/timeout (no HTTP response) — retry
  return false;                               // permanent client error (400/404/422…)
}

class OfflineQueue {
  constructor() {
    this.db = null;
    this.retryDelay = BACKOFF_SCHEDULE[0];
    this._backoffStep = 0;
    this.flushing = false;
    this._flushTimer = null;
    this._screenshotDir = null;

    // FIX D1/D2: Resolver injected by index.js. Given a queued item's
    // { time_entry_id, idempotency_key }, returns the REAL server entry id by
    // reading the timer_sessions table (server_entry_id). Lets us replace a
    // `local-…` placeholder id with the synced server id before sending —
    // heartbeats and screenshots that carried a local id used to 422 and drop.
    // Returns null when the originating session hasn't synced its start yet.
    /** @type {((meta: {time_entry_id?: string, idempotency_key?: string}) => (string|null))|null} */
    this.resolveServerEntryId = null;

    // FIX D3: Re-anchor callback injected by index.js. Invoked when a queued
    // idle_discard/idle_reassign flushes and the server returns a NEW (post-split)
    // entry — the desktop must re-anchor its local timer to that new entry exactly
    // like the online idle path, or it stays bound to the now-closed entry and the
    // server leaves a new entry open forever (elapsed inflates / stopped timers
    // resurrect). Signature: (payload, newEntry) => void.
    /** @type {((payload: object, newEntry: object) => void)|null} */
    this.onIdleReanchor = null;

    // FIX D3: Predicate injected by index.js — returns true when a local timer
    // session is currently active. A queued idle_discard must be SKIPPED when the
    // user already stopped the timer before it flushed, otherwise replaying it
    // resurrects a running timer on the server. Defaults to "assume active" when
    // not wired so behavior is unchanged in contexts that don't set it.
    /** @type {(() => boolean)|null} */
    this.isLocalTimerActive = null;

    this.init();
  }

  // FIX D1/D2: Resolve a queued item's time_entry_id to the real server entry id.
  // - If the id is already a real server id (not `local-…`), return it as-is.
  // - If it's a `local-…` placeholder, ask the resolver for the synced server id.
  // - Return null when unresolved (start not synced yet) so the caller HOLDS the
  //   item for a later flush instead of sending an id the server will reject.
  _resolveEntryId(meta) {
    const raw = meta && meta.time_entry_id != null ? String(meta.time_entry_id) : null;
    if (raw && !raw.startsWith('local-')) return raw;
    if (typeof this.resolveServerEntryId === 'function') {
      try {
        const resolved = this.resolveServerEntryId({
          time_entry_id: raw,
          idempotency_key: meta && meta.idempotency_key,
        });
        if (resolved && !String(resolved).startsWith('local-')) return String(resolved);
      } catch (e) {
        console.warn('[OfflineQueue] resolveServerEntryId threw:', e.message);
      }
    }
    return null; // unresolved — hold for later
  }

  // An item can only ever resolve to a real server entry id if it carries either a
  // `local-…` placeholder (resolvable once its start syncs) or an idempotency_key.
  // An item with NEITHER — e.g. a heartbeat captured during a timer-state transition
  // when there was no entry to anchor it to (time_entry_id null/undefined) — can never
  // resolve. Holding it loops forever: it is re-read and "held" every flush cycle,
  // spamming the log and blocking the queue. Such orphans must be DROPPED, not held.
  _isUnresolvableOrphan(meta) {
    const hasIdem = !!(meta && meta.idempotency_key != null && meta.idempotency_key !== '');
    if (hasIdem) return false;
    const raw = meta && meta.time_entry_id != null ? String(meta.time_entry_id) : null;
    // In the unresolved branch a real id would already have resolved, so raw here is
    // either a `local-…` placeholder (keep — may sync later) or null (orphan).
    return raw == null;
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
      let transientStop = false; // Set when we hit rate-limit/server/network — pause & retry later
      let screenshotsUploadedThisFlush = 0; // For pacing between screenshot uploads

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
            // FIX D1: The /agent/logs replay endpoint requires a real time_entry_id.
            // A heartbeat queued during an offline start carries a `local-…` id (or
            // none) until its session syncs. Resolve it to the server entry id via
            // timer_sessions; if still unresolved, HOLD this heartbeat (don't add it
            // to the batch) so a single unresolvable id can't 422 the whole batch and
            // drop all offline activity. It flushes on a later cycle once the start syncs.
            const resolvedId = this._resolveEntryId(data);
            if (!resolvedId) {
              if (this._isUnresolvableOrphan(data)) {
                console.warn('[OfflineQueue] Dropping orphaned heartbeat — no entry id or idempotency_key to resolve (can never sync)');
                deleteIds.push(item.id);
                continue;
              }
              console.log(`[OfflineQueue] Holding heartbeat — entry not synced yet (entry=${data.time_entry_id})`);
              continue; // leave in queue; do NOT count an attempt
            }
            heartbeats.push({ ...data, time_entry_id: resolvedId });
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

            // FIX D2: A screenshot queued during an offline start carries a
            // `local-…` time_entry_id; presign 422s on it. Resolve to the synced
            // server entry id via timer_sessions. If unresolved, HOLD the item
            // (its buffer file stays on disk) until the start syncs.
            const resolvedScreenshotEntryId = this._resolveEntryId(data);
            if (!resolvedScreenshotEntryId) {
              if (this._isUnresolvableOrphan(data)) {
                console.warn('[OfflineQueue] Dropping orphaned screenshot — no entry id or idempotency_key to resolve (can never sync)');
                deleteIds.push(item.id);
                continue;
              }
              console.log(`[OfflineQueue] Holding screenshot — entry not synced yet (entry=${data.time_entry_id})`);
              continue; // leave in queue + keep file; do NOT count an attempt
            }

            const metadata = {
              time_entry_id:   resolvedScreenshotEntryId,
              captured_at:     data.captured_at,
              file_size:       buffer.length,
              idempotency_key: data.idempotency_key,
            };
            if (data.app_name)       metadata.app_name       = data.app_name;
            if (data.window_title)   metadata.window_title    = data.window_title;
            if (data.activity_score != null) metadata.activity_score = data.activity_score;
            if (data.display_index != null)  metadata.display_index  = data.display_index;
            if (data.display_count != null)  metadata.display_count  = data.display_count;

            // Pace uploads to stay under the server's 60/min presign+confirm
            // throttle. Skip the delay before the first screenshot of the flush.
            if (screenshotsUploadedThisFlush > 0) {
              await sleep(SCREENSHOT_FLUSH_INTERVAL_MS);
            }
            const { screenshot_id, upload_url, upload_headers } = await apiClient.presignScreenshot(metadata);
            await apiClient.uploadToS3(upload_url, buffer, upload_headers || {});
            await apiClient.confirmScreenshot(screenshot_id);
            screenshotsUploadedThisFlush++;
            console.log(`[OfflineQueue] Screenshot uploaded successfully (entry=${data.time_entry_id}, captured=${data.captured_at})`);
            deleteIds.push(item.id);
            // Track file for deletion after successful upload
            if (data.file_path) {
              screenshotFilesToDelete.push(data.file_path);
            }
          } else if (item.type === 'idle_discard') {
            // FIX D3: If the user STOPPED the timer before this queued idle_discard
            // flushed, replaying it would resurrect a running timer (the server
            // splits the entry and opens a NEW one). Skip/drop it when no local
            // session is active — the stop already closed everything.
            if (typeof this.isLocalTimerActive === 'function' && !this.isLocalTimerActive()) {
              console.log('[OfflineQueue] Dropping queued idle_discard — no active local timer (timer was stopped)');
              deleteIds.push(item.id);
              continue;
            }
            // FIX D3: Capture the result and re-anchor. The online idle path closes
            // the stale entry at idle_started_at and opens a new local session at
            // new_entry.started_at; the offline replay used to IGNORE new_entry,
            // leaving the desktop bound to the now-split/closed entry → server keeps
            // a new entry open forever and elapsed inflates. Drive the SAME re-anchor.
            const res = await apiClient.reportIdleTime(data);
            if (res?.new_entry && typeof this.onIdleReanchor === 'function') {
              try {
                this.onIdleReanchor(data, res.new_entry);
              } catch (cbErr) {
                console.warn('[OfflineQueue] onIdleReanchor threw:', cbErr.message);
              }
            }
            deleteIds.push(item.id);
          }
          // NOTE: timer_start and timer_stop are no longer queued here.
          // Timer sync is handled exclusively by timer_sessions table + reconcileTimerState().
          // This eliminates the dual-replay bug that caused duplicate time entries.
        } catch (e) {
          // Transient errors (429 rate-limit, 5xx, network) must NOT count toward
          // the drop limit — pause the flush and let the backoff scheduler retry the
          // whole queue later. This prevents a rate-limited backlog from silently
          // dropping valid screenshots (the 429 data-loss bug).
          if (isTransientError(e)) {
            const status = (e && e.response && e.response.status) || 'network';
            console.warn(`[OfflineQueue] Transient error (${status}) on ${item.type} — pausing flush, will retry: ${e.message}`);
            transientStop = true;
            break;
          }

          console.warn(`[OfflineQueue] Flush item failed (type=${item.type}, attempt=${item.attempts + 1}): ${e.message}`);
          // Permanent error — count the attempt
          this._stmtIncAttempt.run(item.id);

          // Remove items that have failed too many times (permanent errors only)
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

      if (transientStop) {
        // Hit rate-limit/server/network — advance backoff so the scheduled retry
        // waits longer (5→15→30→60→120s), letting the rate-limit window clear.
        this._backoffStep = Math.min(this._backoffStep + 1, BACKOFF_SCHEDULE.length - 1);
        this.retryDelay = BACKOFF_SCHEDULE[this._backoffStep];
        console.log(`[OfflineQueue] Flush paused (transient) — retrying in ${this.retryDelay / 1000}s`);
      } else {
        // Reset backoff on a clean flush
        this._backoffStep = 0;
        this.retryDelay = BACKOFF_SCHEDULE[0];
      }

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
