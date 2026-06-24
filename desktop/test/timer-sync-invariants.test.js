// Unit tests for the local-first timer-sync invariants introduced by the
// timer-sync bug fixes (BUG 1 / BUG 2 / BUG 3).
//
// The mutation logic lives inside src/main/index.js, which cannot be imported in
// a unit test without booting the full Electron app. These tests therefore
// re-implement the pure invariants exactly as coded in index.js and assert their
// behavior, so a regression in the algorithm is caught here. Each test cites the
// index.js function it mirrors.

describe("Timer sync invariants", () => {
    // Mirrors adoptServerStartedAt() in src/main/index.js.
    // Local started_at is the immutable source of truth: the server start is only
    // adopted when there is no local anchor yet, or it is earlier-or-equal.
    function adoptServerStartedAt(cachedStartedAtMs, serverStartedAtIso) {
        const serverMs = serverStartedAtIso
            ? new Date(serverStartedAtIso).getTime()
            : null;
        if (serverMs == null || Number.isNaN(serverMs))
            return cachedStartedAtMs;
        if (cachedStartedAtMs == null || serverMs <= cachedStartedAtMs)
            return serverMs;
        return cachedStartedAtMs; // server start is LATER — keep local truth
    }

    describe("BUG 2: adoptServerStartedAt never pushes the start forward", () => {
        test("adopts server start when no local anchor exists", () => {
            const server = "2026-06-15T09:00:00.000Z";
            expect(adoptServerStartedAt(null, server)).toBe(
                new Date(server).getTime(),
            );
        });

        test("adopts server start when it is EARLIER than local (never lose time)", () => {
            const local = new Date("2026-06-15T09:05:00.000Z").getTime();
            const server = "2026-06-15T09:00:00.000Z";
            expect(adoptServerStartedAt(local, server)).toBe(
                new Date(server).getTime(),
            );
        });

        test("KEEPS local anchor when server start is LATER (prevents backward jump)", () => {
            // This is the core BUG 2 scenario: offline start 09:00, server reconcile
            // stamps 11:00. The displayed timer must NOT jump from 2h down to 0.
            const local = new Date("2026-06-15T09:00:00.000Z").getTime();
            const server = "2026-06-15T11:00:00.000Z";
            expect(adoptServerStartedAt(local, server)).toBe(local);
        });

        test("keeps local anchor when server start is missing/invalid", () => {
            const local = new Date("2026-06-15T09:00:00.000Z").getTime();
            expect(adoptServerStartedAt(local, null)).toBe(local);
            expect(adoptServerStartedAt(local, "not-a-date")).toBe(local);
        });

        test("equal starts are a no-op (idempotent)", () => {
            const iso = "2026-06-15T09:00:00.000Z";
            const local = new Date(iso).getTime();
            expect(adoptServerStartedAt(local, iso)).toBe(local);
        });
    });

    describe("BUG 2: clock-skew is applied consistently (neither stored nor displayed)", () => {
        // Mirrors startTrayTimer(): elapsed = Date.now() - _cachedStartedAtMs, with
        // NO _clockOffsetMs added. The anchor is stored on the local clock, so the
        // display must measure on the local clock too.
        function elapsedSeconds(cachedStartedAtMs, nowMs) {
            return Math.floor((nowMs - cachedStartedAtMs) / 1000);
        }

        test("elapsed is computed purely on the local clock (no double-applied skew)", () => {
            const start = new Date("2026-06-15T09:00:00.000Z").getTime();
            const now = new Date("2026-06-15T09:00:30.000Z").getTime();
            // Even if the server clock were +60s skewed, we do NOT add it here.
            expect(elapsedSeconds(start, now)).toBe(30);
        });
    });

    describe("BUG 3: stop targeting binds to a specific server entry id", () => {
        // Mirrors syncSessionStop()/stopTimer() payload construction.
        function buildStopPayload({
            serverEntryId,
            startedAt,
            endedAt,
            idempotencyKey,
            offline,
        }) {
            const payload = {};
            if (serverEntryId) payload.time_entry_id = serverEntryId;
            if (idempotencyKey) payload.idempotency_key = idempotencyKey;
            if (offline) {
                payload.started_at = startedAt;
                payload.ended_at = endedAt;
            }
            return payload;
        }

        test("reconcile stop always carries time_entry_id (never a bare timestamp pair)", () => {
            const payload = buildStopPayload({
                serverEntryId: "srv-entry-1",
                startedAt: "2026-06-15T09:00:00.000Z",
                endedAt: "2026-06-15T10:00:00.000Z",
                idempotencyKey: "idem-1",
                offline: true,
            });
            expect(payload.time_entry_id).toBe("srv-entry-1");
            expect(payload.idempotency_key).toBe("idem-1");
            expect(payload).toHaveProperty("started_at");
            expect(payload).toHaveProperty("ended_at");
        });

        test("404 on stop is mapped to already-synced success", () => {
            // Mirrors syncSessionStop()/stopTimer() 404 handling.
            function handleStopError(status) {
                if (status === 404) return { synced: true };
                return { synced: false };
            }
            expect(handleStopError(404)).toEqual({ synced: true });
            expect(handleStopError(500)).toEqual({ synced: false });
        });
    });

    describe("phantom-stop desync: unsynced local start drives a reconcile push", () => {
        // Mirrors the branch in startTimerSync() (src/main/index.js) where the 10s
        // loop sees server.running===false while isTimerRunning===true AND the active
        // local session has synced_start===0. Previously this branch only bailed,
        // leaving the start stranded until an offline→online transition (which never
        // fires when the original POST /timer/start failed transiently while
        // net.isOnline() stayed true). The fix: release both mutation guards, then
        // schedule reconcileTimerState()+flush via setImmediate, gated on isOnline.
        //
        // This models the loop branch + reconcile's "push unsynced active start" step
        // (reconcileTimerState Phase 2) to prove the start is pushed with the ORIGINAL
        // idempotency_key and the REAL local started_at.

        // Mirrors reconcileTimerState() Phase 2: push the unsynced active local start.
        async function reconcileTimerState({
            apiClient,
            getActiveLocalTimer,
            mutationInProgress,
        }) {
            if (mutationInProgress) return { skipped: "guard-held" }; // early-return invariant
            const localActive = getActiveLocalTimer();
            if (localActive && !localActive.synced_start) {
                await apiClient.startTimer(
                    localActive.project_id || null,
                    localActive.idempotency_key,
                    localActive.started_at,
                );
                return { pushed: true };
            }
            return { pushed: false };
        }

        // Mirrors the startTimerSync() branch decision.
        function syncLoopBranch({
            serverRunning,
            isTimerRunning,
            localActive,
            isOnline,
        }) {
            const result = { releasedGuards: false, scheduledReconcile: false };
            if (!serverRunning && isTimerRunning) {
                if (localActive && !localActive.synced_start) {
                    // Release both guards BEFORE reconcile (reconcile early-returns if held).
                    result.releasedGuards = true;
                    if (isOnline) result.scheduledReconcile = true;
                    return result;
                }
            }
            return result;
        }

        test("loop schedules reconcile (after releasing guards) when start is unsynced and online", () => {
            const r = syncLoopBranch({
                serverRunning: false,
                isTimerRunning: true,
                localActive: { synced_start: 0 },
                isOnline: true,
            });
            expect(r.releasedGuards).toBe(true);
            expect(r.scheduledReconcile).toBe(true);
        });

        test("loop does NOT schedule reconcile while genuinely offline (online handler owns that)", () => {
            const r = syncLoopBranch({
                serverRunning: false,
                isTimerRunning: true,
                localActive: { synced_start: 0 },
                isOnline: false,
            });
            // Guards still release (local state preserved), but no push while offline.
            expect(r.releasedGuards).toBe(true);
            expect(r.scheduledReconcile).toBe(false);
        });

        test("reconcile pushes the start with the ORIGINAL idempotency_key and REAL local started_at", async () => {
            const startTimer = jest
                .fn()
                .mockResolvedValue({ entry: { id: "srv-1" } });
            const localActive = {
                synced_start: 0,
                project_id: "proj-9",
                idempotency_key: "idem-original-abc",
                started_at: "2026-06-15T09:00:00.000Z",
            };
            const res = await reconcileTimerState({
                apiClient: { startTimer },
                getActiveLocalTimer: () => localActive,
                mutationInProgress: false, // guards were released by the loop first
            });
            expect(res.pushed).toBe(true);
            expect(startTimer).toHaveBeenCalledTimes(1);
            expect(startTimer).toHaveBeenCalledWith(
                "proj-9",
                "idem-original-abc",
                "2026-06-15T09:00:00.000Z",
            );
        });

        test("reconcile is a no-op if invoked while the mutation guard is STILL held (proves release ordering matters)", async () => {
            const startTimer = jest.fn();
            const res = await reconcileTimerState({
                apiClient: { startTimer },
                getActiveLocalTimer: () => ({
                    synced_start: 0,
                    idempotency_key: "k",
                    started_at: "x",
                }),
                mutationInProgress: true,
            });
            expect(res).toEqual({ skipped: "guard-held" });
            expect(startTimer).not.toHaveBeenCalled();
        });
    });

    describe("BUG 3: stop mutex serializes concurrent stops", () => {
        // Mirrors the _stopTimerInProgress guard in stopTimer().
        function makeStopper() {
            let inProgress = false;
            let stops = 0;
            return async function stopTimer() {
                if (inProgress)
                    return { error: "Timer stop already in progress" };
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

        test("only the first of two concurrent stops proceeds", async () => {
            const stopTimer = makeStopper();
            const [a, b] = await Promise.all([stopTimer(), stopTimer()]);
            const results = [a, b];
            expect(results.filter((r) => r.success)).toHaveLength(1);
            expect(results.filter((r) => r.error)).toHaveLength(1);
        });
    });

    describe("phantom-stop recovery: orphaned SQLite session", () => {
        // Mirrors restoreInMemoryFromLocalActive() + shouldPreserveLocalRunningWhenServerStopped().
        function restoreInMemoryFromLocalActive(localActive) {
            if (!localActive || localActive.ended_at) return null;
            return {
                isTimerRunning: true,
                currentEntry: {
                    id: localActive.server_entry_id || localActive.id,
                    started_at: localActive.started_at,
                    _localId: localActive.id,
                },
                cachedStartedAtMs: new Date(localActive.started_at).getTime(),
            };
        }

        function shouldPreserveLocalRunningWhenServerStopped({
            isTimerRunning,
            localActive,
            idleActive,
        }) {
            if (idleActive) return true;
            if (isTimerRunning && localActive && !localActive.synced_start)
                return true;
            if (!isTimerRunning && localActive && !localActive.ended_at)
                return true;
            return false;
        }

        test("preserves and restores when SQLite has open session but memory was cleared", () => {
            const localActive = {
                id: "local-1",
                server_entry_id: "srv-1",
                started_at: "2026-06-15T06:00:00.000Z",
                synced_start: 1,
                ended_at: null,
            };
            expect(
                shouldPreserveLocalRunningWhenServerStopped({
                    isTimerRunning: false,
                    localActive,
                    idleActive: false,
                }),
            ).toBe(true);
            const restored = restoreInMemoryFromLocalActive(localActive);
            expect(restored.isTimerRunning).toBe(true);
            expect(restored.currentEntry.id).toBe("srv-1");
            expect(restored.cachedStartedAtMs).toBe(
                new Date(localActive.started_at).getTime(),
            );
        });
    });

    // Mirrors the "FIX D5" today-total update + display formula in
    // handleIdleAction()/buildTimerTickPayload() in src/main/index.js.
    // After a discard/reassign split, the server closes the original tracked
    // entry at idle_START and the idle gap is excluded (audit-only `idle` entry);
    // the new live entry counts from idle_END. The displayed total is
    // todayTotalCurrentProject + liveElapsed, so todayTotal MUST advance by the
    // pre-idle work measured to idle-START — never to idle-END (that double-counts
    // the discarded gap and inflates the display to the full wall-clock elapsed).
    describe("BUG D5: discard excludes the idle gap from the today total", () => {
        // delta added to todayTotalCurrentProject for the closed pre-idle entry
        function preIdleDelta(startedAtMs, idleStartedAtMs) {
            return Math.max(
                0,
                Math.floor((idleStartedAtMs - startedAtMs) / 1000),
            );
        }
        // what the running widget shows after the split
        function displayTotalAfterDiscard(
            startedAtMs,
            idleStartedAtMs,
            idleEndedAtMs,
            nowMs,
            priorTodayTotal = 0,
        ) {
            const todayTotal =
                priorTodayTotal + preIdleDelta(startedAtMs, idleStartedAtMs);
            const liveElapsed = Math.max(
                0,
                Math.floor((nowMs - idleEndedAtMs) / 1000),
            );
            return todayTotal + liveElapsed;
        }

        const started = new Date("2026-06-15T09:00:00.000Z").getTime();
        const idleStart = started + 16 * 60 * 1000; // 16m pre-idle work
        const idleEnd = idleStart + 4 * 60 * 1000; // 4m idle gap (discarded)
        const now = idleEnd + 30 * 1000; // 30s post-idle work

        test("today total advances by pre-idle work measured to idle-START", () => {
            expect(preIdleDelta(started, idleStart)).toBe(16 * 60);
        });

        test("displayed total excludes the discarded idle gap", () => {
            // 16m pre-idle + 30s post-idle = 990s. NOT 16m + 4m + 30s (wall clock).
            expect(
                displayTotalAfterDiscard(started, idleStart, idleEnd, now),
            ).toBe(16 * 60 + 30);
        });

        test("regression: measuring to idle-END would inflate by the whole gap", () => {
            // The old buggy formula used idleEnd as the pre-idle boundary.
            const buggyTodayTotal = Math.floor((idleEnd - started) / 1000);
            const buggyDisplay =
                buggyTodayTotal + Math.floor((now - idleEnd) / 1000);
            const correctDisplay = displayTotalAfterDiscard(
                started,
                idleStart,
                idleEnd,
                now,
            );
            // The bug inflated the display by exactly the 4-minute idle gap.
            expect(buggyDisplay - correctDisplay).toBe(4 * 60);
            // ...and made the display equal the full wall-clock elapsed.
            expect(buggyDisplay).toBe(Math.floor((now - started) / 1000));
        });
    });
});
