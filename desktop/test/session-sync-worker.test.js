const { SessionSyncWorker } = require('../src/main/session-sync-worker');

/**
 * In-memory stand-in for WorkSessionStore.
 *
 * Deliberately a fake rather than the real store: better-sqlite3 is compiled against
 * Electron's ABI and cannot load under Jest. What is under test here is the WORKER's
 * decision-making — what it sends, what it confirms, and above all what it refuses to
 * confirm — not SQL execution.
 */
class FakeStore {
    constructor(rows = []) {
        this.rows = rows;
        this.meta = {};
        this.confirmed = [];
        this.failures = [];
        this.purgeCalls = [];
    }

    getDirty(limit) {
        return this.rows
            .filter((r) => r.synced_revision == null || r.synced_revision !== r.revision || r.ended_at == null)
            .slice(0, limit);
    }

    markConfirmed(id, sentRevision, serverEntryId, serverDuration = null) {
        this.confirmed.push({ id, sentRevision, serverEntryId, serverDuration });
        const row = this.rows.find((r) => r.id === id);
        if (row) {
            row.synced_revision = sentRevision;
            row.server_entry_id = serverEntryId;
            row.confirmed_at = new Date().toISOString();
        }
    }

    markFailed(id, message) {
        this.failures.push({ id, message });
    }

    getMeta(k) {
        return this.meta[k] ?? null;
    }

    setMeta(k, v) {
        this.meta[k] = String(v);
    }

    purgeConfirmed(nowMs) {
        this.purgeCalls.push(nowMs);
        const before = this.rows.length;
        this.rows = this.rows.filter(
            (r) => !(r.ended_at && r.server_entry_id && r.confirmed_at && r.synced_revision === r.revision),
        );
        return before - this.rows.length;
    }

    splitLiveAtMidnight() {
        return { live: null, splits: 0 };
    }
}

const row = (over = {}) => ({
    id: 'local-1',
    idempotency_key: 'uuid-1',
    project_id: null,
    task_id: null,
    started_at: '2026-07-30T08:00:00.000Z',
    ended_at: '2026-07-30T09:00:00.000Z',
    duration_seconds: 3600,
    revision: 2,
    synced_revision: null,
    server_entry_id: null,
    confirmed_at: null,
    ...over,
});

const okResult = (over = {}) => ({
    uuid: 'uuid-1',
    status: 'ok',
    time_entry_id: 'srv-1',
    revision: 2,
    duration_seconds: 3600,
    ...over,
});

function makeWorker(store, api, extra = {}) {
    return new SessionSyncWorker({
        store,
        apiClient: api,
        getTimeZone: () => 'Asia/Karachi',
        ...extra,
    });
}

describe('health gate', () => {
    test('does not push when the server is unreachable', async () => {
        const store = new FakeStore([row()]);
        const syncSessions = jest.fn();
        const worker = makeWorker(store, { checkHealth: async () => false, syncSessions });

        const res = await worker.syncNow();

        expect(res.skipped).toBe('unreachable');
        expect(syncSessions).not.toHaveBeenCalled();
        // The row survives untouched — offline is not a reason to lose anything.
        expect(store.rows).toHaveLength(1);
        expect(store.confirmed).toHaveLength(0);
    });

    test('a throwing health probe is treated as unreachable, not as a crash', async () => {
        const store = new FakeStore([row()]);
        const worker = makeWorker(store, {
            checkHealth: async () => {
                throw new Error('ENOTFOUND');
            },
            syncSessions: jest.fn(),
        });

        await expect(worker.syncNow()).resolves.toEqual({ skipped: 'unreachable' });
    });
});

describe('push and confirm', () => {
    test('sends the local session and confirms it on a matching ack', async () => {
        const store = new FakeStore([row()]);
        const syncSessions = jest.fn(async () => ({ results: [okResult()] }));
        const worker = makeWorker(store, { checkHealth: async () => true, syncSessions });

        await worker.syncNow();

        expect(syncSessions).toHaveBeenCalledTimes(1);
        expect(syncSessions.mock.calls[0][0]).toEqual([
            {
                uuid: 'uuid-1',
                revision: 2,
                started_at: '2026-07-30T08:00:00.000Z',
                ended_at: '2026-07-30T09:00:00.000Z',
                project_id: null,
                task_id: null,
            },
        ]);
        expect(store.confirmed).toEqual([
            { id: 'local-1', sentRevision: 2, serverEntryId: 'srv-1', serverDuration: 3600 },
        ]);
    });

    test('confirms against the revision SENT, not the row’s current revision', async () => {
        const store = new FakeStore([row()]);
        const syncSessions = jest.fn(async () => {
            // The user stops the timer (or an idle split runs) while the request is in
            // flight, bumping the row to revision 3.
            store.rows[0].revision = 3;
            store.rows[0].ended_at = '2026-07-30T09:30:00.000Z';
            return { results: [okResult({ revision: 2 })] };
        });
        const worker = makeWorker(store, { checkHealth: async () => true, syncSessions });

        await worker.syncNow();

        // Confirmed at 2, so the row is STILL dirty at 3 and will be pushed again.
        // Recording 3 here would let the purge delete work the server never received.
        expect(store.confirmed[0].sentRevision).toBe(2);
        expect(store.getDirty(10)).toHaveLength(1);
    });

    test('does not confirm when the ack is for a different revision', async () => {
        const store = new FakeStore([row()]);
        const worker = makeWorker(store, {
            checkHealth: async () => true,
            syncSessions: async () => ({ results: [okResult({ revision: 1 })] }),
        });

        await worker.syncNow();

        expect(store.confirmed).toHaveLength(0);
        expect(store.failures[0].message).toMatch(/superseded/);
    });

    test('keeps a rejected row instead of dropping it', async () => {
        const store = new FakeStore([row()]);
        const worker = makeWorker(store, {
            checkHealth: async () => true,
            syncSessions: async () => ({
                results: [{ uuid: 'uuid-1', status: 'rejected', code: 'invalid_timestamp', message: 'bad clock' }],
            }),
        });

        const res = await worker.syncNow();

        expect(res.rejected).toBe(1);
        expect(store.confirmed).toHaveLength(0);
        // Still present locally — a rejection is never a licence to delete tracked time.
        expect(store.rows).toHaveLength(1);
        expect(store.failures[0].message).toMatch(/invalid_timestamp/);
    });

    test('keeps rows when the request itself fails', async () => {
        const store = new FakeStore([row()]);
        const worker = makeWorker(store, {
            checkHealth: async () => true,
            syncSessions: async () => {
                throw new Error('socket hang up');
            },
        });

        const res = await worker.syncNow();

        expect(res.error).toBe('socket hang up');
        expect(store.confirmed).toHaveLength(0);
        expect(store.rows).toHaveLength(1);
        expect(store.failures[0].message).toBe('socket hang up');
    });

    test('marks a row failed when the server omits its result', async () => {
        const store = new FakeStore([row()]);
        const worker = makeWorker(store, {
            checkHealth: async () => true,
            syncSessions: async () => ({ results: [] }),
        });

        await worker.syncNow();

        expect(store.confirmed).toHaveLength(0);
        expect(store.failures[0].message).toMatch(/no result/);
    });

    test('matches results by uuid, not by position', async () => {
        const store = new FakeStore([
            row({ id: 'local-1', idempotency_key: 'uuid-1' }),
            row({ id: 'local-2', idempotency_key: 'uuid-2' }),
        ]);
        const worker = makeWorker(store, {
            checkHealth: async () => true,
            syncSessions: async () => ({
                // Deliberately reversed relative to the request.
                results: [
                    okResult({ uuid: 'uuid-2', time_entry_id: 'srv-2' }),
                    okResult({ uuid: 'uuid-1', time_entry_id: 'srv-1' }),
                ],
            }),
        });

        await worker.syncNow();

        const byId = Object.fromEntries(store.confirmed.map((c) => [c.id, c.serverEntryId]));
        expect(byId).toEqual({ 'local-1': 'srv-1', 'local-2': 'srv-2' });
    });

    test('still confirms when the server clamped the duration', async () => {
        const store = new FakeStore([row({ duration_seconds: 90000 })]);
        const worker = makeWorker(store, {
            checkHealth: async () => true,
            syncSessions: async () => ({ results: [okResult({ duration_seconds: 86400 })] }),
        });

        await worker.syncNow();

        // The server's value is authoritative once acked; retrying forever would be worse.
        expect(store.confirmed[0].serverDuration).toBe(86400);
    });

    test('sends the live session even when it is otherwise clean', async () => {
        // Re-sending the live row is how the server learns the agent is alive; without it
        // client_synced_at goes stale and cleanup force-closes a healthy session.
        const store = new FakeStore([
            row({ ended_at: null, duration_seconds: null, revision: 1, synced_revision: 1, server_entry_id: 'srv-1' }),
        ]);
        const syncSessions = jest.fn(async () => ({
            results: [okResult({ revision: 1, ended_at: null, duration_seconds: null })],
        }));
        const worker = makeWorker(store, { checkHealth: async () => true, syncSessions });

        await worker.syncNow();

        expect(syncSessions).toHaveBeenCalledTimes(1);
        expect(syncSessions.mock.calls[0][0][0].ended_at).toBeNull();
    });
});

describe('ordering and concurrency', () => {
    test('flushes the offline queue only AFTER sessions land', async () => {
        const order = [];
        const store = new FakeStore([row()]);
        const worker = makeWorker(
            store,
            {
                checkHealth: async () => true,
                syncSessions: async () => {
                    order.push('sessions');
                    return { results: [okResult()] };
                },
            },
            {
                offlineQueue: {
                    flush: async () => {
                        order.push('queue');
                    },
                },
            },
        );

        await worker.syncNow();

        // Screenshots/heartbeats FK to time_entries.id, which only exists once the
        // owning session has synced. Reversing this 422s the queue on every reconnect.
        expect(order).toEqual(['sessions', 'queue']);
    });

    test('does not flush the queue when sessions could not be pushed', async () => {
        const flush = jest.fn();
        const store = new FakeStore([row()]);
        const worker = makeWorker(
            store,
            { checkHealth: async () => false, syncSessions: jest.fn() },
            { offlineQueue: { flush } },
        );

        await worker.syncNow();

        expect(flush).not.toHaveBeenCalled();
    });

    test('a queue flush failure does not undo confirmed sessions', async () => {
        const store = new FakeStore([row()]);
        const worker = makeWorker(
            store,
            { checkHealth: async () => true, syncSessions: async () => ({ results: [okResult()] }) },
            {
                offlineQueue: {
                    flush: async () => {
                        throw new Error('S3 down');
                    },
                },
            },
        );

        await expect(worker.syncNow()).resolves.toMatchObject({ confirmed: 1 });
        expect(store.confirmed).toHaveLength(1);
    });

    test('a second cycle is skipped while one is in flight', async () => {
        const store = new FakeStore([row()]);
        let release;
        const gate = new Promise((r) => {
            release = r;
        });
        const worker = makeWorker(store, {
            checkHealth: async () => true,
            syncSessions: async () => {
                await gate;
                return { results: [okResult()] };
            },
        });

        const first = worker.syncNow('a');
        const second = await worker.syncNow('b');
        expect(second).toEqual({ skipped: 'in_flight' });

        release();
        await first;
    });

    test('pages through a backlog larger than one batch', async () => {
        const many = Array.from({ length: 150 }, (_, i) =>
            row({ id: `local-${i}`, idempotency_key: `uuid-${i}` }),
        );
        const store = new FakeStore(many);
        const syncSessions = jest.fn(async (payload) => ({
            results: payload.map((p) => okResult({ uuid: p.uuid, revision: p.revision, time_entry_id: `srv-${p.uuid}` })),
        }));
        const worker = makeWorker(store, { checkHealth: async () => true, syncSessions });

        await worker.syncNow();

        expect(syncSessions).toHaveBeenCalledTimes(2);
        expect(syncSessions.mock.calls[0][0]).toHaveLength(100);
        expect(store.confirmed).toHaveLength(150);
    });
});

describe('backoff', () => {
    test('backs off after a failure and skips the next cycle', async () => {
        const store = new FakeStore([row()]);
        const syncSessions = jest.fn();
        const worker = makeWorker(store, { checkHealth: async () => false, syncSessions });

        await worker.syncNow();
        const second = await worker.syncNow();

        expect(second).toEqual({ skipped: 'backoff' });
        expect(syncSessions).not.toHaveBeenCalled();
    });

    test('an explicit trigger can bypass backoff', async () => {
        // The logout/quit flush must not be blocked by a backoff window; that is the
        // moment unsynced time is most at risk.
        const store = new FakeStore([row()]);
        const worker = makeWorker(store, {
            checkHealth: async () => true,
            syncSessions: async () => ({ results: [okResult()] }),
        });
        worker._noteFailure();

        const res = await worker.syncNow('logout', { ignoreBackoff: true });

        expect(res.skipped).toBeUndefined();
        expect(store.confirmed).toHaveLength(1);
    });

    test('a success clears the backoff', async () => {
        const store = new FakeStore([row()]);
        let healthy = false;
        const worker = makeWorker(store, {
            checkHealth: async () => healthy,
            syncSessions: async () => ({ results: [okResult()] }),
        });

        await worker.syncNow();
        expect(worker._backoffUntilMs).toBeGreaterThan(0);

        healthy = true;
        await worker.syncNow('retry', { ignoreBackoff: true });
        expect(worker._backoffUntilMs).toBe(0);
        expect(worker._consecutiveFailures).toBe(0);
    });
});

describe('purge', () => {
    const KARACHI_0530 = Date.parse('2026-07-30T00:30:00Z'); // 05:30 PKT

    test('purges confirmed rows once past 05:00 local', () => {
        const store = new FakeStore([
            row({
                synced_revision: 2,
                server_entry_id: 'srv-1',
                confirmed_at: '2026-07-28T09:00:00.000Z',
            }),
        ]);
        store.meta.last_purge_at = String(Date.parse('2026-07-29T06:00:00Z'));
        const worker = makeWorker(store, { checkHealth: async () => true, syncSessions: jest.fn() });

        const removed = worker.purgeIfDue(KARACHI_0530);

        expect(removed).toBe(1);
        expect(store.rows).toHaveLength(0);
        expect(store.meta.last_purge_at).toBe(String(KARACHI_0530));
    });

    test('never purges a dirty row, even when the purge is due', () => {
        const store = new FakeStore([
            row({ synced_revision: 1, revision: 2, server_entry_id: 'srv-1', confirmed_at: '2026-07-28T09:00:00.000Z' }),
        ]);
        const worker = makeWorker(store, { checkHealth: async () => true, syncSessions: jest.fn() });

        worker.purgeIfDue(KARACHI_0530);

        expect(store.rows).toHaveLength(1);
    });

    test('never purges the live row', () => {
        const store = new FakeStore([
            row({ ended_at: null, synced_revision: 2, server_entry_id: 'srv-1', confirmed_at: '2026-07-28T09:00:00.000Z' }),
        ]);
        const worker = makeWorker(store, { checkHealth: async () => true, syncSessions: jest.fn() });

        worker.purgeIfDue(KARACHI_0530);

        expect(store.rows).toHaveLength(1);
    });

    test('does not run twice in one day', () => {
        const store = new FakeStore([]);
        store.meta.last_purge_at = String(KARACHI_0530);
        const worker = makeWorker(store, { checkHealth: async () => true, syncSessions: jest.fn() });

        worker.purgeIfDue(Date.parse('2026-07-30T06:00:00Z')); // 11:00 PKT, same day

        expect(store.purgeCalls).toHaveLength(0);
    });

    test('runs after a sleep straight across the 05:00 boundary', () => {
        const store = new FakeStore([]);
        store.meta.last_purge_at = String(Date.parse('2026-07-29T00:10:00Z')); // 05:10 PKT prev day
        const worker = makeWorker(store, { checkHealth: async () => true, syncSessions: jest.fn() });

        // Woke at 09:00 PKT, having slept over 05:00. A setTimeout would never have fired.
        worker.purgeIfDue(Date.parse('2026-07-30T04:00:00Z'));

        expect(store.purgeCalls).toHaveLength(1);
    });

    test('purging is independent of connectivity', () => {
        // It only ever deletes rows the server ALREADY confirmed, so being offline is
        // irrelevant — and a permanently offline machine should still reclaim disk.
        const store = new FakeStore([
            row({ synced_revision: 2, server_entry_id: 'srv-1', confirmed_at: '2026-07-28T09:00:00.000Z' }),
        ]);
        const worker = makeWorker(store, {
            checkHealth: async () => false,
            syncSessions: jest.fn(),
        });

        expect(worker.purgeIfDue(KARACHI_0530)).toBe(1);
    });
});

describe('lifecycle', () => {
    test('stop() clears both timers', () => {
        const store = new FakeStore([]);
        const worker = makeWorker(store, { checkHealth: async () => true, syncSessions: jest.fn() });

        worker.start();
        expect(worker._syncTimer).not.toBeNull();
        worker.stop();

        expect(worker._syncTimer).toBeNull();
        expect(worker._purgeTimer).toBeNull();
    });

    test('is inert without a store or api client', async () => {
        const worker = new SessionSyncWorker({});
        await expect(worker.syncNow()).resolves.toEqual({ skipped: 'not_ready' });
    });
});
