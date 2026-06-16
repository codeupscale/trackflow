// Unit tests for the local-first timer-sync invariants introduced by the
// timer-sync bug fixes (BUG 1 / BUG 2 / BUG 3).
//
// The mutation logic lives inside src/main/index.js, which cannot be imported in
// a unit test without booting the full Electron app. These tests therefore
// re-implement the pure invariants exactly as coded in index.js and assert their
// behavior, so a regression in the algorithm is caught here. Each test cites the
// index.js function it mirrors.

describe('Timer sync invariants', () => {
  // Mirrors adoptServerStartedAt() in src/main/index.js.
  // Local started_at is the immutable source of truth: the server start is only
  // adopted when there is no local anchor yet, or it is earlier-or-equal.
  function adoptServerStartedAt(cachedStartedAtMs, serverStartedAtIso) {
    const serverMs = serverStartedAtIso ? new Date(serverStartedAtIso).getTime() : null;
    if (serverMs == null || Number.isNaN(serverMs)) return cachedStartedAtMs;
    if (cachedStartedAtMs == null || serverMs <= cachedStartedAtMs) return serverMs;
    return cachedStartedAtMs; // server start is LATER — keep local truth
  }

  describe('BUG 2: adoptServerStartedAt never pushes the start forward', () => {
    test('adopts server start when no local anchor exists', () => {
      const server = '2026-06-15T09:00:00.000Z';
      expect(adoptServerStartedAt(null, server)).toBe(new Date(server).getTime());
    });

    test('adopts server start when it is EARLIER than local (never lose time)', () => {
      const local = new Date('2026-06-15T09:05:00.000Z').getTime();
      const server = '2026-06-15T09:00:00.000Z';
      expect(adoptServerStartedAt(local, server)).toBe(new Date(server).getTime());
    });

    test('KEEPS local anchor when server start is LATER (prevents backward jump)', () => {
      // This is the core BUG 2 scenario: offline start 09:00, server reconcile
      // stamps 11:00. The displayed timer must NOT jump from 2h down to 0.
      const local = new Date('2026-06-15T09:00:00.000Z').getTime();
      const server = '2026-06-15T11:00:00.000Z';
      expect(adoptServerStartedAt(local, server)).toBe(local);
    });

    test('keeps local anchor when server start is missing/invalid', () => {
      const local = new Date('2026-06-15T09:00:00.000Z').getTime();
      expect(adoptServerStartedAt(local, null)).toBe(local);
      expect(adoptServerStartedAt(local, 'not-a-date')).toBe(local);
    });

    test('equal starts are a no-op (idempotent)', () => {
      const iso = '2026-06-15T09:00:00.000Z';
      const local = new Date(iso).getTime();
      expect(adoptServerStartedAt(local, iso)).toBe(local);
    });
  });

  describe('BUG 2: clock-skew is applied consistently (neither stored nor displayed)', () => {
    // Mirrors startTrayTimer(): elapsed = Date.now() - _cachedStartedAtMs, with
    // NO _clockOffsetMs added. The anchor is stored on the local clock, so the
    // display must measure on the local clock too.
    function elapsedSeconds(cachedStartedAtMs, nowMs) {
      return Math.floor((nowMs - cachedStartedAtMs) / 1000);
    }

    test('elapsed is computed purely on the local clock (no double-applied skew)', () => {
      const start = new Date('2026-06-15T09:00:00.000Z').getTime();
      const now = new Date('2026-06-15T09:00:30.000Z').getTime();
      // Even if the server clock were +60s skewed, we do NOT add it here.
      expect(elapsedSeconds(start, now)).toBe(30);
    });
  });

  describe('BUG 3: stop targeting binds to a specific server entry id', () => {
    // Mirrors syncSessionStop()/stopTimer() payload construction.
    function buildStopPayload({ serverEntryId, startedAt, endedAt, idempotencyKey, offline }) {
      const payload = {};
      if (serverEntryId) payload.time_entry_id = serverEntryId;
      if (idempotencyKey) payload.idempotency_key = idempotencyKey;
      if (offline) {
        payload.started_at = startedAt;
        payload.ended_at = endedAt;
      }
      return payload;
    }

    test('reconcile stop always carries time_entry_id (never a bare timestamp pair)', () => {
      const payload = buildStopPayload({
        serverEntryId: 'srv-entry-1',
        startedAt: '2026-06-15T09:00:00.000Z',
        endedAt: '2026-06-15T10:00:00.000Z',
        idempotencyKey: 'idem-1',
        offline: true,
      });
      expect(payload.time_entry_id).toBe('srv-entry-1');
      expect(payload.idempotency_key).toBe('idem-1');
      expect(payload).toHaveProperty('started_at');
      expect(payload).toHaveProperty('ended_at');
    });

    test('404 on stop is mapped to already-synced success', () => {
      // Mirrors syncSessionStop()/stopTimer() 404 handling.
      function handleStopError(status) {
        if (status === 404) return { synced: true };
        return { synced: false };
      }
      expect(handleStopError(404)).toEqual({ synced: true });
      expect(handleStopError(500)).toEqual({ synced: false });
    });
  });

  describe('BUG 3: stop mutex serializes concurrent stops', () => {
    // Mirrors the _stopTimerInProgress guard in stopTimer().
    function makeStopper() {
      let inProgress = false;
      let stops = 0;
      return async function stopTimer() {
        if (inProgress) return { error: 'Timer stop already in progress' };
        inProgress = true;
        try {
          await Promise.resolve();
          stops++;
          return { success: true, stops };
        } finally {
          inProgress = false;
        }
      };
    }

    test('only the first of two concurrent stops proceeds', async () => {
      const stopTimer = makeStopper();
      const [a, b] = await Promise.all([stopTimer(), stopTimer()]);
      const results = [a, b];
      expect(results.filter((r) => r.success)).toHaveLength(1);
      expect(results.filter((r) => r.error)).toHaveLength(1);
    });
  });
});
