// Pushes local work sessions to the server, and purges local rows once confirmed.
//
// The ONLY component that talks to the server about tracked time. The timer itself never
// does — it writes SQLite and returns. That separation is the whole point: a network
// failure can delay an upload but can no longer affect, truncate, or lose tracked time.
//
// Cycle:
//   1. health gate  — cheap liveness probe; skip silently when the server is unreachable
//   2. push         — batches of dirty rows, revision captured at send time
//   3. confirm      — only on an ack that matches the revision we actually sent
//   4. queue flush  — screenshots/heartbeats AFTER sessions, since they FK to entry ids
//
// A separate 05:00 purge deletes rows the server has confirmed. Nothing else deletes.

const rules = require('./session-rules');

/**
 * Upload cadence — the ONLY routine trigger.
 *
 * Tracking is local and continuous; uploading is a periodic batch, deliberately.
 * There are NO event-driven pushes any more (start / stop / project switch / idle
 * resolve / midnight split / wake / reconnect all used to fire one), so the server
 * is written to on a predictable schedule instead of on every user action.
 *
 * The only remaining out-of-band flushes are the ones that exist to protect data
 * rather than to freshen a dashboard: app launch (upload the previous run's
 * backlog), sign-out, quit, and pre-update — after those the process may not be
 * around for the next tick.
 *
 * Consequence, by design: the web dashboard can lag reality by up to one interval —
 * a running timer, its screenshots and its heartbeats (both FK to a synced entry)
 * only appear after the next cycle.
 */
const SYNC_INTERVAL_MS = 10 * 60 * 1000;

/** How often the purge scheduler checks whether the 05:00 boundary has passed. */
const PURGE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** Sessions per request; the server caps this at timer.sync_batch_max. */
const BATCH_SIZE = 100;

/** Batches per cycle — bounds a huge backlog so one cycle cannot run unbounded. */
const MAX_BATCHES_PER_CYCLE = 10;

/** Fallback day boundary zone when the org config has never been fetched. */
const DEFAULT_TIMEZONE = 'Asia/Karachi';

class SessionSyncWorker {
    /**
     * @param {object}   deps.store         WorkSessionStore
     * @param {object}   deps.apiClient     must expose checkHealth() and syncSessions()
     * @param {function} deps.getTimeZone   () => IANA zone for day boundaries
     * @param {object}   [deps.offlineQueue] flushed after sessions land
     * @param {function} [deps.onPurge]     called with the number of rows purged
     */
    constructor({ store, apiClient, getTimeZone, offlineQueue = null, onPurge = null } = {}) {
        this.store = store;
        this.apiClient = apiClient;
        this.getTimeZone = getTimeZone || (() => DEFAULT_TIMEZONE);
        this.offlineQueue = offlineQueue;
        this.onPurge = onPurge;

        this._syncTimer = null;
        this._purgeTimer = null;
        this._inFlight = false;
        this._consecutiveFailures = 0;
        this._backoffUntilMs = 0;
        this._stopped = true;
    }

    start() {
        if (this._syncTimer) return;
        this._stopped = false;
        this._syncTimer = setInterval(() => this.syncNow('interval'), SYNC_INTERVAL_MS);
        this._purgeTimer = setInterval(() => this.purgeIfDue(), PURGE_CHECK_INTERVAL_MS);
        // Kick immediately so a backlog from a previous run starts uploading at launch.
        this.syncNow('start');
        this.purgeIfDue();
    }

    stop() {
        this._stopped = true;
        if (this._syncTimer) clearInterval(this._syncTimer);
        if (this._purgeTimer) clearInterval(this._purgeTimer);
        this._syncTimer = null;
        this._purgeTimer = null;
    }

    /**
     * Run one cycle.
     *
     * Never throws and never rejects: it is called from timers, IPC handlers and the
     * quit path, none of which can meaningfully handle a failure. Returns a small
     * summary for tests and for the bounded logout/quit flush.
     */
    async syncNow(reason = 'manual', { ignoreBackoff = false } = {}) {
        if (!this.store || !this.apiClient) return { skipped: 'not_ready' };
        if (this._inFlight) return { skipped: 'in_flight' };
        if (!ignoreBackoff && Date.now() < this._backoffUntilMs) {
            return { skipped: 'backoff' };
        }

        this._inFlight = true;
        try {
            // ── 1. Health gate ──────────────────────────────────────────────
            // Deliberately the CHEAP liveness endpoint. The full /health probes S3 and
            // counts failed jobs — far too expensive to have every agent poll it every
            // 60 seconds. All we need to know is whether it is worth spending a request.
            const healthy = await this._isServerReachable();
            if (!healthy) {
                this._noteFailure();
                return { skipped: 'unreachable' };
            }

            // ── 2/3. Push and confirm ───────────────────────────────────────
            let pushed = 0;
            let confirmed = 0;
            let rejected = 0;

            for (let batch = 0; batch < MAX_BATCHES_PER_CYCLE; batch++) {
                const rows = this.store.getDirty(BATCH_SIZE);
                if (rows.length === 0) break;

                const outcome = await this._pushBatch(rows);
                if (!outcome.ok) {
                    this._noteFailure();
                    return { pushed, confirmed, rejected, error: outcome.error };
                }

                pushed += rows.length;
                confirmed += outcome.confirmed;
                rejected += outcome.rejected;

                // Everything in this batch was already current — nothing left to chase.
                if (outcome.confirmed === 0 && outcome.rejected === 0) break;
                if (rows.length < BATCH_SIZE) break;
            }

            this._noteSuccess();

            // ── 4. Dependent uploads ────────────────────────────────────────
            // Screenshots and heartbeats reference time_entries.id, which only exists
            // once the owning session has synced. Flushing them first would 404/422 the
            // whole queue on every reconnect.
            await this._flushQueue();

            return { pushed, confirmed, rejected, reason };
        } catch (e) {
            console.warn('[SessionSync] Cycle failed:', e.message);
            this._noteFailure();
            return { error: e.message };
        } finally {
            this._inFlight = false;
        }
    }

    async _isServerReachable() {
        try {
            return await this.apiClient.checkHealth();
        } catch {
            return false;
        }
    }

    /**
     * Push one batch and apply the per-row acks.
     *
     * The revision is snapshotted per row BEFORE the request goes out. Confirming
     * against the row's revision at RESPONSE time would mark a session the user stopped
     * mid-flight as fully synced — and the purge would then delete work the server never
     * received.
     */
    async _pushBatch(rows) {
        const sent = rows.map((row) => ({
            id: row.id,
            revision: Number(row.revision),
            row,
        }));

        const payload = sent.map(({ row, revision }) => ({
            uuid: row.idempotency_key,
            revision,
            started_at: row.started_at,
            ended_at: row.ended_at || null,
            project_id: row.project_id || null,
            task_id: row.task_id || null,
        }));

        let response;
        try {
            response = await this.apiClient.syncSessions(payload);
        } catch (e) {
            for (const { id } of sent) this.store.markFailed(id, e.message);
            return { ok: false, error: e.message, confirmed: 0, rejected: 0 };
        }

        const results = (response && response.results) || [];
        const byUuid = new Map();
        for (const r of results) {
            if (r && r.uuid) byUuid.set(r.uuid, r);
        }

        let confirmed = 0;
        let rejected = 0;

        for (const { id, revision, row } of sent) {
            const result = byUuid.get(row.idempotency_key);

            if (!result) {
                this.store.markFailed(id, 'no result returned for session');
                continue;
            }

            if (rules.shouldConfirm(result, revision)) {
                if (rules.hasDurationMismatch(row, result)) {
                    // The server's value wins once acked — retrying forever over a clamp
                    // would be worse. Record both so the discrepancy is visible before
                    // the local copy is purged.
                    console.warn(
                        `[SessionSync] Duration differs for ${row.idempotency_key}: local=${row.duration_seconds}s server=${result.duration_seconds}s`,
                    );
                }
                this.store.markConfirmed(
                    id,
                    revision,
                    result.time_entry_id,
                    result.duration_seconds ?? null,
                );
                confirmed++;
                continue;
            }

            if (result.status === 'rejected') {
                // KEEP the row. A rejection is never a licence to delete tracked time —
                // it stays local, visible in totals, and recoverable by hand.
                this.store.markFailed(id, `${result.code || 'rejected'}: ${result.message || ''}`);
                rejected++;
                continue;
            }

            // Acked, but for a revision other than the one we sent — the row changed
            // mid-flight. Leave it dirty; the next cycle carries the newer state.
            this.store.markFailed(id, 'superseded by a newer local revision');
        }

        return { ok: true, confirmed, rejected };
    }

    async _flushQueue() {
        if (!this.offlineQueue || typeof this.offlineQueue.flush !== 'function') return;
        try {
            await this.offlineQueue.flush();
        } catch (e) {
            console.warn('[SessionSync] Offline queue flush failed:', e.message);
        }
    }

    _noteSuccess() {
        this._consecutiveFailures = 0;
        this._backoffUntilMs = 0;
    }

    _noteFailure() {
        this._consecutiveFailures += 1;
        this._backoffUntilMs = Date.now() + rules.nextBackoffMs(this._consecutiveFailures);
    }

    // ── Purge ───────────────────────────────────────────────────────────────

    /**
     * Delete confirmed local rows once past the 05:00 boundary in the org timezone.
     *
     * Boundary-comparison rather than a scheduled timer, so a machine asleep across
     * 05:00 still purges on its next tick instead of skipping the day entirely.
     */
    purgeIfDue(nowMs = Date.now()) {
        if (!this.store) return 0;

        const tz = this._timeZone();
        const lastRaw = this.store.getMeta('last_purge_at');
        const lastMs = lastRaw ? Number(lastRaw) : null;

        if (!rules.isPurgeDue(nowMs, Number.isFinite(lastMs) ? lastMs : null, tz)) {
            return 0;
        }

        const removed = this.store.purgeConfirmed(nowMs);
        this.store.setMeta('last_purge_at', String(nowMs));

        if (removed > 0) {
            console.log(`[SessionSync] Purged ${removed} confirmed local session(s)`);
            if (this.onPurge) this.onPurge(removed);
        }
        return removed;
    }

    _timeZone() {
        try {
            return this.getTimeZone() || DEFAULT_TIMEZONE;
        } catch {
            return DEFAULT_TIMEZONE;
        }
    }

    /**
     * Split the live session at any local-midnight boundary it has crossed.
     *
     * Driven by the 1s tray tick rather than this worker's own timer: the split must
     * happen promptly and regardless of connectivity, since it is a purely local
     * correctness operation.
     */
    splitAtMidnightIfNeeded(nowMs = Date.now()) {
        if (!this.store) return { live: null, splits: 0 };
        try {
            return this.store.splitLiveAtMidnight(this._timeZone(), nowMs);
        } catch (e) {
            console.error('[SessionSync] Midnight split failed:', e.message);
            return { live: null, splits: 0 };
        }
    }
}

module.exports = {
    SessionSyncWorker,
    SYNC_INTERVAL_MS,
    PURGE_CHECK_INTERVAL_MS,
    BATCH_SIZE,
    MAX_BATCHES_PER_CYCLE,
    DEFAULT_TIMEZONE,
};
