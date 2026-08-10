// SQLite persistence for local-first work sessions.
//
// This is the SOURCE OF TRUTH for tracked time. The timer writes here and returns; no
// network call is involved in starting, stopping, switching projects, or resolving an
// idle prompt. SessionSyncWorker later pushes rows to the server and marks them
// confirmed; nothing is ever deleted until the server has acknowledged it.
//
// DESIGN: this layer stays deliberately thin. better-sqlite3 is compiled against
// Electron's ABI and cannot be loaded by Jest, so any decision expressed as SQL is
// untestable in CI. All non-trivial rules live in session-rules.js (pure, fully tested)
// and this file only issues the statements they imply.
//
// The table is `timer_sessions`, evolved in place rather than replaced: it already
// carried `idempotency_key TEXT NOT NULL UNIQUE`, populated with crypto.randomUUID() —
// exactly the client-generated uuid the server upserts on. No new identifier was needed.

const crypto = require('crypto');
const rules = require('./session-rules');

/** Rows confirmed longer ago than this may be purged. */
const PURGE_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/** Sessions shorter than this are tracking noise (a mis-click, an idle-split artifact). */
const MIN_SESSION_SECONDS = 2;

class WorkSessionStore {
    /**
     * @param {object} db  An open better-sqlite3 handle. Injected so the caller owns the
     *                     connection (it is shared with the offline queue's database).
     */
    constructor(db) {
        this.db = db;
        this.userId = null;
        if (db) this._migrate();
    }

    /** Scope every read to the signed-in user; set once the token is validated. */
    setUserId(userId) {
        this.userId = userId || null;
    }

    // ── Schema ──────────────────────────────────────────────────────────────

    _migrate() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS timer_sessions (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        project_id TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        duration_seconds INTEGER,
        synced_start INTEGER NOT NULL DEFAULT 0,
        synced_stop INTEGER NOT NULL DEFAULT 0,
        server_entry_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY, value TEXT);
    `);

        // Additive columns. Each is attempted independently and its "duplicate column"
        // error swallowed — the same tolerant pattern the table's user_id column already
        // used, and the only way to migrate SQLite without a version ratchet.
        const columns = [
            'user_id TEXT',
            'task_id TEXT',
            'revision INTEGER NOT NULL DEFAULT 1',
            'synced_revision INTEGER',
            'server_duration_seconds INTEGER',
            'confirmed_at TEXT',
            'attempts INTEGER NOT NULL DEFAULT 0',
            'last_error TEXT',
        ];
        for (const col of columns) {
            try {
                this.db.exec(`ALTER TABLE timer_sessions ADD COLUMN ${col}`);
            } catch {
                // Already present — expected on every launch after the first.
            }
        }

        try {
            this.db.exec(
                'CREATE INDEX IF NOT EXISTS idx_ts_dirty ON timer_sessions(user_id, synced_revision, revision)',
            );
        } catch (e) {
            console.warn('[WorkSessionStore] index create failed:', e.message);
        }

        this._backfillRevisions();
    }

    /**
     * One-shot translation from the old synced_start/synced_stop flags to the revision
     * model. A row that was fully synced under the old scheme is marked confirmed;
     * EVERYTHING ELSE is left dirty so it gets pushed on the first sync after upgrade.
     *
     * That asymmetry is intentional: treating an ambiguous legacy row as clean would
     * silently discard time, while treating it as dirty costs at worst one idempotent
     * re-push that the server dedupes on the uuid.
     */
    _backfillRevisions() {
        if (this.getMeta('schema_backfill_done') === '1') return;
        try {
            this.db
                .prepare(
                    `UPDATE timer_sessions
                        SET synced_revision = revision,
                            confirmed_at = COALESCE(confirmed_at, created_at)
                      WHERE synced_start = 1
                        AND synced_stop = 1
                        AND ended_at IS NOT NULL
                        AND server_entry_id IS NOT NULL
                        AND synced_revision IS NULL`,
                )
                .run();
            this.setMeta('schema_backfill_done', '1');
            console.log('[WorkSessionStore] Legacy sync flags translated to revisions');
        } catch (e) {
            console.error('[WorkSessionStore] Backfill failed:', e.message);
        }
    }

    // ── Meta ────────────────────────────────────────────────────────────────

    getMeta(key) {
        try {
            const row = this.db.prepare('SELECT value FROM sync_meta WHERE key = ?').get(key);
            return row ? row.value : null;
        } catch {
            return null;
        }
    }

    setMeta(key, value) {
        try {
            this.db
                .prepare('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)')
                .run(key, String(value));
        } catch (e) {
            console.warn('[WorkSessionStore] setMeta failed:', e.message);
        }
    }

    // ── Scoping ─────────────────────────────────────────────────────────────

    /**
     * Rows are visible to the user that recorded them. Legacy rows (user_id NULL)
     * predate ownership tagging and can only have come from this install's own earlier
     * session, so they stay visible rather than being stranded.
     */
    _ownClause(prefix = 'AND') {
        if (!this.userId) return { sql: '', params: [] };
        return { sql: ` ${prefix} (user_id IS NULL OR user_id = ?)`, params: [this.userId] };
    }

    // ── Writes ──────────────────────────────────────────────────────────────

    /**
     * Open a new live session. Returns the row.
     *
     * The uuid generated here is the identity the server will upsert on, for the whole
     * life of this session — it is never regenerated, so a retry can never duplicate.
     */
    open({ projectId = null, taskId = null, startedAt = null } = {}) {
        const uuid = crypto.randomUUID();
        const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const started = startedAt || new Date().toISOString();

        this.db
            .prepare(
                `INSERT INTO timer_sessions
                   (id, idempotency_key, project_id, task_id, started_at, user_id, revision)
                 VALUES (?, ?, ?, ?, ?, ?, 1)`,
            )
            .run(id, uuid, projectId, taskId, started, this.userId);

        return this.getById(id);
    }

    /**
     * Close a session at `endedAt`. Bumps the revision, so the next sync carries it.
     *
     * `endedAt` may be EARLIER than a previously recorded end — that is precisely what an
     * idle discard does. The client is authoritative; the server accepts the newer
     * revision and shortens the entry.
     */
    close(id, endedAt = null) {
        const row = this.getById(id);
        if (!row) return null;

        const ended = endedAt || new Date().toISOString();
        const startMs = Date.parse(row.started_at);
        const endMs = Date.parse(ended);
        const duration = Math.max(0, Math.floor((endMs - startMs) / 1000));

        this.db
            .prepare(
                `UPDATE timer_sessions
                    SET ended_at = ?, duration_seconds = ?, revision = revision + 1
                  WHERE id = ?`,
            )
            .run(ended, duration, id);

        return this.getById(id);
    }

    /** Re-point a session at another project. Bumps the revision. */
    setProject(id, projectId) {
        this.db
            .prepare('UPDATE timer_sessions SET project_id = ?, revision = revision + 1 WHERE id = ?')
            .run(projectId, id);
        return this.getById(id);
    }

    /**
     * Close the live session and open a fresh one at the same instant, atomically.
     *
     * Used by the project switch, the idle discard, and the midnight split. Doing both
     * halves in one transaction is what guarantees the timeline stays contiguous: there
     * is no window in which the user has two open sessions, or none.
     */
    /**
     * Close a session and open its successor, in one transaction.
     *
     * `reopenAtIso` defaults to `atIso` — contiguous, which is what a project switch
     * and the midnight split need: no instant may belong to no session.
     *
     * An IDLE discard is the opposite: it MUST pass a later `reopenAtIso` (the moment
     * the user answered the prompt) so the idle span between the two rows belongs to
     * NOBODY. Without it the gap is not discarded at all — it is merely moved into the
     * new row and still billed. That is exactly what shipped: verified on a real
     * session where the successor opened at idle-start and swallowed 13 idle minutes.
     * See bugs/desktop-idle-continue-still-bills-the-idle-gap.md.
     */
    closeAndReopen(id, atIso, { projectId, taskId = null, reopenAtIso = null } = {}) {
        const startedAt = reopenAtIso || atIso;
        if (Date.parse(startedAt) < Date.parse(atIso)) {
            throw new Error(
                'closeAndReopen: reopenAtIso must be at or after the close instant',
            );
        }
        const run = this.db.transaction(() => {
            this.close(id, atIso);
            return this.open({ projectId, taskId, startedAt });
        });
        return run();
    }

    /**
     * Discard a session that is too short to be real work (a mis-click, or the residue
     * of an idle split landing on the same second). Only ever applied to rows the server
     * has never seen — anything already uploaded is the server's to keep.
     */
    dropIfTrivial(id) {
        const row = this.getById(id);
        if (!row || row.ended_at == null) return false;
        if (row.server_entry_id) return false;
        if ((row.duration_seconds ?? 0) >= MIN_SESSION_SECONDS) return false;

        this.db.prepare('DELETE FROM timer_sessions WHERE id = ?').run(id);
        return true;
    }

    // ── Midnight split ──────────────────────────────────────────────────────

    /**
     * Split the live session at every local-midnight boundary it has crossed, so no
     * entry ever spans two calendar days and daily reports, attendance rollups and
     * payroll stay exact.
     *
     * Loops over ALL crossed boundaries, so a machine that slept from Friday to Monday
     * produces one row per day instead of a single impossible row.
     *
     * @returns {{live: object|null, splits: number}} the (possibly new) live row.
     */
    splitLiveAtMidnight(timeZone, nowMs = Date.now()) {
        const live = this.getLive();
        if (!live) return { live: null, splits: 0 };

        const startedMs = Date.parse(live.started_at);
        const boundaries = rules.midnightBoundaries(startedMs, nowMs, timeZone);
        if (boundaries.length === 0) return { live, splits: 0 };

        let current = live;
        for (const boundary of boundaries) {
            const atIso = new Date(boundary).toISOString();
            current = this.closeAndReopen(current.id, atIso, {
                projectId: current.project_id,
                taskId: current.task_id,
            });
        }

        console.log(
            `[WorkSessionStore] Split live session across ${boundaries.length} midnight boundary(ies) in ${timeZone}`,
        );
        return { live: current, splits: boundaries.length };
    }

    // ── Reads ───────────────────────────────────────────────────────────────

    getById(id) {
        try {
            return this.db.prepare('SELECT * FROM timer_sessions WHERE id = ?').get(id) || null;
        } catch (e) {
            console.error('[WorkSessionStore] getById failed:', e.message);
            return null;
        }
    }

    /** The single open session for the signed-in user, if any. */
    getLive() {
        try {
            const own = this._ownClause();
            return (
                this.db
                    .prepare(
                        'SELECT * FROM timer_sessions WHERE ended_at IS NULL' +
                            own.sql +
                            ' ORDER BY created_at DESC LIMIT 1',
                    )
                    .get(...own.params) || null
            );
        } catch (e) {
            console.error('[WorkSessionStore] getLive failed:', e.message);
            return null;
        }
    }

    /**
     * Rows the server has not acknowledged at their current revision, oldest first.
     *
     * The LIVE session is always included even when clean: re-sending it is how the
     * server learns the agent is still alive (it refreshes client_synced_at), which is
     * what stops CleanupStaleEntries and the login-time stale-close from force-closing a
     * perfectly healthy session.
     *
     * `attempts ASC` before `started_at ASC` is anti-STARVATION, not a preference. A row
     * the server refuses permanently (a clock outside `timer.max_past_skew`, a uuid owned
     * by another user) stays dirty forever by design — we never delete tracked time over a
     * rejection. Ordered by age alone, 100+ such rows would sit at the head of every batch
     * for the rest of the install's life and newer sessions would never be reached. A
     * failing row drifts to the back instead, and `markConfirmed` resets `attempts` to 0
     * so a row that recovers returns to its chronological place.
     */
    getDirty(limit = 100) {
        try {
            const own = this._ownClause();
            const rows = this.db
                .prepare(
                    `SELECT * FROM timer_sessions
                      WHERE (synced_revision IS NULL OR synced_revision <> revision
                             OR ended_at IS NULL)` +
                        own.sql +
                        ' ORDER BY attempts ASC, started_at ASC LIMIT ?',
                )
                .all(...own.params, limit);
            // A batch carrying two open sessions is 422'd in full by the server, which
            // would stall EVERY upload behind one corrupt row. See the rule for why the
            // dropped rows are safe to hold back.
            return rules.limitToOneOpenSession(rows || []);
        } catch (e) {
            console.error('[WorkSessionStore] getDirty failed:', e.message);
            return [];
        }
    }

    /** All rows for the signed-in user (used for local today-totals). */
    getAll() {
        try {
            const own = this._ownClause('WHERE');
            return (
                this.db
                    .prepare('SELECT * FROM timer_sessions' + (own.sql || '') + ' ORDER BY started_at ASC')
                    .all(...own.params) || []
            );
        } catch (e) {
            console.error('[WorkSessionStore] getAll failed:', e.message);
            return [];
        }
    }

    countDirty() {
        try {
            const own = this._ownClause();
            const row = this.db
                .prepare(
                    'SELECT COUNT(*) AS n FROM timer_sessions WHERE (synced_revision IS NULL OR synced_revision <> revision)' +
                        own.sql,
                )
                .get(...own.params);
            return row ? Number(row.n) : 0;
        } catch {
            return 0;
        }
    }

    // ── Sync bookkeeping ────────────────────────────────────────────────────

    /**
     * Record a server acknowledgement.
     *
     * `sentRevision` is the revision captured when the request was BUILT, not the row's
     * current revision. If the user stopped the timer while the request was in flight,
     * writing the current revision here would mark unsynced work as confirmed — and the
     * 05:00 purge would then delete it.
     */
    markConfirmed(id, sentRevision, serverEntryId, serverDurationSeconds = null) {
        try {
            this.db
                .prepare(
                    `UPDATE timer_sessions
                        SET synced_revision = ?,
                            server_entry_id = ?,
                            server_duration_seconds = ?,
                            confirmed_at = ?,
                            attempts = 0,
                            last_error = NULL
                      WHERE id = ?`,
                )
                .run(sentRevision, serverEntryId, serverDurationSeconds, new Date().toISOString(), id);
        } catch (e) {
            console.error('[WorkSessionStore] markConfirmed failed:', e.message);
        }
    }

    /** Record a failed push. The row stays dirty and is retried. */
    markFailed(id, message) {
        try {
            this.db
                .prepare('UPDATE timer_sessions SET attempts = attempts + 1, last_error = ? WHERE id = ?')
                .run(String(message || '').slice(0, 500), id);
        } catch (e) {
            console.warn('[WorkSessionStore] markFailed failed:', e.message);
        }
    }

    /** Resolve a local session id to the server entry id, once known. */
    getServerEntryId(id) {
        const row = this.getById(id);
        return row ? row.server_entry_id : null;
    }

    // ── Purge ───────────────────────────────────────────────────────────────

    /**
     * Delete local rows the server has durably confirmed.
     *
     * Every clause is a safety property, not an optimisation: live rows, dirty rows,
     * rows with no server id and rows with no confirmation stamp are all structurally
     * unreachable by this statement. The age grace means a row is never deleted in the
     * same breath as its acknowledgement.
     */
    purgeConfirmed(nowMs = Date.now(), minAgeMs = PURGE_MIN_AGE_MS) {
        try {
            const cutoff = new Date(nowMs - minAgeMs).toISOString();
            const result = this.db
                .prepare(
                    `DELETE FROM timer_sessions
                      WHERE ended_at IS NOT NULL
                        AND server_entry_id IS NOT NULL
                        AND confirmed_at IS NOT NULL
                        AND synced_revision = revision
                        AND confirmed_at < ?`,
                )
                .run(cutoff);
            return result.changes || 0;
        } catch (e) {
            console.error('[WorkSessionStore] purge failed:', e.message);
            return 0;
        }
    }

    /**
     * Sign-out cleanup. Keeps EVERY unconfirmed row belonging to the signed-in user so
     * nothing tracked offline is lost, and removes other accounts' rows plus this user's
     * already-confirmed ones.
     *
     * A kept row is always closed first by the caller, so it can never resurrect as a
     * phantom live timer on the next launch.
     */
    clearForLogout() {
        try {
            if (!this.userId) {
                // No known user (forced logout before the profile loaded). Keep anything
                // unconfirmed rather than wiping — the old behaviour destroyed offline work.
                const res = this.db
                    .prepare(
                        `DELETE FROM timer_sessions
                          WHERE ended_at IS NOT NULL
                            AND server_entry_id IS NOT NULL
                            AND confirmed_at IS NOT NULL
                            AND synced_revision = revision`,
                    )
                    .run();
                return res.changes || 0;
            }

            const res = this.db
                .prepare(
                    `DELETE FROM timer_sessions
                      WHERE NOT (
                        (user_id = ? OR user_id IS NULL)
                        AND (synced_revision IS NULL OR synced_revision <> revision)
                      )`,
                )
                .run(this.userId);

            const kept = this.db.prepare('SELECT COUNT(*) AS n FROM timer_sessions').get();
            if (kept?.n > 0) {
                console.warn(
                    `[WorkSessionStore] Kept ${kept.n} unsynced session(s) for upload on next sign-in (removed ${res.changes})`,
                );
            }
            return res.changes || 0;
        } catch (e) {
            console.error('[WorkSessionStore] clearForLogout failed:', e.message);
            return 0;
        }
    }
}

module.exports = { WorkSessionStore, PURGE_MIN_AGE_MS, MIN_SESSION_SECONDS };
