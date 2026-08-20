/**
 * Screenshots must be posted against a REAL server entry id.
 *
 * `POST /screenshots/presign` validates `time_entry_id` as a uuid and looks it up in
 * `time_entries`. Since the offline-first refactor `startTimer()` makes no network call,
 * so the live capture is bound to the local SQLite id (`local-<ts>-<rand>`) — which is
 * not a uuid and does not exist server-side. Every live screenshot 422'd, fell into the
 * offline queue, and arrived (if at all) 15–42 hours late; anything still queued when the
 * 05:00 purge deleted its session row could never resolve and died in the TTL sweep.
 *
 * Production evidence (2026-08-20): live uploads went from 1627/1639 on Aug 12 to 0/835
 * on Aug 18 — the offline-first rollout landed on Aug 13.
 *
 * See bugs/desktop-screenshots-bound-to-local-entry-id.md
 */

const fs = require('fs');
const path = require('path');
const { SessionSyncWorker } = require('../src/main/session-sync-worker');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf8');

class FakeStore {
    constructor(rows = []) {
        this.rows = rows;
        this.meta = {};
        this.purgeArgs = [];
    }
    getDirty(limit) {
        return this.rows
            .filter((r) => r.synced_revision !== r.revision || r.ended_at == null)
            .slice(0, limit);
    }
    markConfirmed(id, sentRevision, serverEntryId) {
        const row = this.rows.find((r) => r.id === id);
        if (row) {
            row.synced_revision = sentRevision;
            row.server_entry_id = serverEntryId;
            row.confirmed_at = new Date().toISOString();
        }
    }
    markFailed() {}
    getMeta(k) { return this.meta[k] ?? null; }
    setMeta(k, v) { this.meta[k] = String(v); }
    purgeConfirmed(nowMs, minAgeMs, keepKeys) {
        this.purgeArgs.push({ nowMs, minAgeMs, keepKeys });
        return 0;
    }
    splitLiveAtMidnight() { return { live: null, splits: 0 }; }
}

const liveRow = (over = {}) => ({
    id: 'local-1755690000-ab3f',
    idempotency_key: 'session-uuid-1',
    project_id: null,
    task_id: null,
    started_at: '2026-08-20T08:00:00.000Z',
    ended_at: null,
    duration_seconds: null,
    revision: 1,
    synced_revision: null,
    server_entry_id: null,
    confirmed_at: null,
    ...over,
});

const api = (results) => ({
    checkHealth: async () => true,
    syncSessions: async () => ({ results }),
});

describe('rebinding the live capture to the server entry id', () => {
    test('fires onSessionConfirmed the first time a session earns a server entry id', async () => {
        const store = new FakeStore([liveRow()]);
        const seen = [];
        const worker = new SessionSyncWorker({
            store,
            apiClient: api([{ uuid: 'session-uuid-1', status: 'ok', time_entry_id: 'srv-abc', revision: 1 }]),
            getTimeZone: () => 'Asia/Karachi',
            onSessionConfirmed: (localId, serverEntryId) => seen.push([localId, serverEntryId]),
        });

        await worker.syncNow();

        expect(seen).toEqual([['local-1755690000-ab3f', 'srv-abc']]);
    });

    test('does not re-fire on later pushes of a session the server already knows', async () => {
        const store = new FakeStore([
            liveRow({ server_entry_id: 'srv-abc', synced_revision: 1, revision: 2 }),
        ]);
        const seen = [];
        const worker = new SessionSyncWorker({
            store,
            apiClient: api([{ uuid: 'session-uuid-1', status: 'ok', time_entry_id: 'srv-abc', revision: 2 }]),
            getTimeZone: () => 'Asia/Karachi',
            onSessionConfirmed: (...a) => seen.push(a),
        });

        await worker.syncNow();

        expect(seen).toHaveLength(0);
    });

    test('a throwing callback never breaks the sync cycle', async () => {
        const store = new FakeStore([liveRow()]);
        const worker = new SessionSyncWorker({
            store,
            apiClient: api([{ uuid: 'session-uuid-1', status: 'ok', time_entry_id: 'srv-abc', revision: 1 }]),
            getTimeZone: () => 'Asia/Karachi',
            onSessionConfirmed: () => { throw new Error('boom'); },
        });

        const res = await worker.syncNow();

        expect(res.confirmed).toBe(1);
        expect(store.rows[0].server_entry_id).toBe('srv-abc');
    });
});

describe('index.js wiring', () => {
    test('capture starts on the resolved server id, never blindly on currentEntry.id', () => {
        expect(SRC).toMatch(/screenshotService\.start\(captureEntryId\)/);
        expect(SRC).not.toMatch(/screenshotService\.start\(currentEntry\.id\)/);
    });

    test('liveCaptureEntryId prefers the server entry id', () => {
        const fn = SRC.slice(SRC.indexOf('function liveCaptureEntryId()'));
        expect(fn).toMatch(/resolveServerEntryIdForQueue/);
        expect(fn).toMatch(/return resolved \|\| currentEntry\.id/);
    });

    test('the sync worker is constructed with a rebinding callback', () => {
        const ctor = SRC.slice(SRC.indexOf('new SessionSyncWorker({'), SRC.indexOf('sessionSyncWorker.start()'));
        expect(ctor).toMatch(/onSessionConfirmed/);
        expect(ctor).toMatch(/rebindEntryId\(serverEntryId\)/);
    });

    test('screenshots get the same session anchor the activity monitor uses', () => {
        expect(SRC).toMatch(/screenshotService\.getCurrentEntryMeta\s*=/);
    });
});

describe('offline queue resolution survives the purge', () => {
    const OfflineQueue = require('../src/main/offline-queue');
    const QSRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'offline-queue.js'), 'utf8');

    test('add() persists session_uuid — the field flush() resolves through', () => {
        // The queue's own comment records why this matters: a field dropped on the way
        // in reads back as undefined and silently costs the item its only route home.
        const addFn = QSRC.slice(QSRC.indexOf('const queueData = {'), QSRC.indexOf('this._stmtInsert.run(type, JSON.stringify(queueData)'));
        expect(addFn).toMatch(/session_uuid/);
    });

    test('_resolveEntryId prefers session_uuid over the per-shot dedupe key', () => {
        const q = Object.create(OfflineQueue.prototype);
        const asked = [];
        q.resolveServerEntryId = (meta) => { asked.push(meta); return 'srv-xyz'; };

        const got = q._resolveEntryId({
            time_entry_id: 'local-1755690000-ab3f',
            idempotency_key: 'per-shot-key',
            session_uuid: 'session-uuid-1',
        });

        expect(got).toBe('srv-xyz');
        expect(asked[0].idempotency_key).toBe('session-uuid-1');
    });

    test('a shot carrying only a session_uuid is never treated as an unresolvable orphan', () => {
        const q = Object.create(OfflineQueue.prototype);
        expect(q._isUnresolvableOrphan({ session_uuid: 'session-uuid-1' })).toBe(false);
        // Genuinely anchorless items must still be dropped rather than held forever.
        expect(q._isUnresolvableOrphan({})).toBe(true);
    });

    test('the purge is handed the sessions queued items still depend on', () => {
        const store = new FakeStore([]);
        const worker = new SessionSyncWorker({
            store,
            apiClient: api([]),
            getTimeZone: () => 'Asia/Karachi',
            offlineQueue: { referencedSessionKeys: () => ['local-1755690000-ab3f', 'session-uuid-1'] },
        });
        store.meta.last_purge_at = null;

        worker.purgeIfDue(Date.parse('2026-08-20T06:00:00.000Z'));

        expect(store.purgeArgs).toHaveLength(1);
        expect(store.purgeArgs[0].keepKeys).toEqual(['local-1755690000-ab3f', 'session-uuid-1']);
    });

    test('purgeConfirmed excludes referenced sessions from the DELETE', () => {
        const WSRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'work-session-store.js'), 'utf8');
        const fn = WSRC.slice(WSRC.indexOf('purgeConfirmed('), WSRC.indexOf('clearForLogout()'));
        expect(fn).toMatch(/id NOT IN/);
        expect(fn).toMatch(/idempotency_key NOT IN/);
    });
});
