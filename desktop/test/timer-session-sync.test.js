const {
    isPendingCompletedSession,
    hasPendingCompletedSession,
    unsyncedCompletedSecondsForDay,
} = require("../src/main/timer-session-sync");

// Regression coverage for the "offline start+stop lost on reconnect" bug.
//
// A session created AND stopped while offline lives in timer_sessions with
// synced_start / synced_stop = 0. It must (a) be detected as pending so the periodic
// loop keeps retrying the sync until it lands, and (b) have its seconds added back to
// the displayed today-total so the offline time doesn't visibly reset before it syncs.

const DAY_MS = 24 * 60 * 60 * 1000;
const startOfToday = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
};
const todayAt = (h, m = 0) => {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toISOString();
};

// row factory
const session = (over = {}) => ({
    id: "local-1",
    started_at: todayAt(9),
    ended_at: todayAt(10),
    duration_seconds: 3600,
    synced_start: 0,
    synced_stop: 0,
    ...over,
});

describe("isPendingCompletedSession", () => {
    test("fully-offline completed session (0/0, ended) is pending", () => {
        expect(isPendingCompletedSession(session())).toBe(true);
    });

    test("start-synced but stop-pending (1/0, ended) is pending", () => {
        expect(
            isPendingCompletedSession(
                session({ synced_start: 1, synced_stop: 0 }),
            ),
        ).toBe(true);
    });

    test("fully-synced session (1/1) is NOT pending", () => {
        expect(
            isPendingCompletedSession(
                session({ synced_start: 1, synced_stop: 1 }),
            ),
        ).toBe(false);
    });

    test("open session (ended_at null) is NOT a pending COMPLETED session", () => {
        expect(
            isPendingCompletedSession(session({ ended_at: null })),
        ).toBe(false);
    });

    test("null/garbage rows are safe", () => {
        expect(isPendingCompletedSession(null)).toBe(false);
        expect(isPendingCompletedSession(undefined)).toBe(false);
    });
});

describe("hasPendingCompletedSession", () => {
    test("true when any row is a pending completed offline session", () => {
        const rows = [
            session({ synced_start: 1, synced_stop: 1 }), // synced
            session({ id: "local-2" }), // pending 0/0
        ];
        expect(hasPendingCompletedSession(rows)).toBe(true);
    });

    test("false when all sessions are synced or still open", () => {
        const rows = [
            session({ synced_start: 1, synced_stop: 1 }),
            session({ id: "local-open", ended_at: null }),
        ];
        expect(hasPendingCompletedSession(rows)).toBe(false);
    });

    test("false / safe for empty or non-array input", () => {
        expect(hasPendingCompletedSession([])).toBe(false);
        expect(hasPendingCompletedSession(null)).toBe(false);
    });
});

describe("unsyncedCompletedSecondsForDay", () => {
    test("counts a fully-offline completed session started today", () => {
        const rows = [session({ duration_seconds: 3600 })];
        expect(unsyncedCompletedSecondsForDay(rows, startOfToday())).toBe(3600);
    });

    test("does NOT count a session whose start is already synced (server owns it)", () => {
        // Prevents double-counting: once start syncs, the entry is in server today_total.
        const rows = [session({ synced_start: 1, synced_stop: 0 })];
        expect(unsyncedCompletedSecondsForDay(rows, startOfToday())).toBe(0);
    });

    test("does NOT count an open (still-running) session", () => {
        const rows = [session({ ended_at: null, duration_seconds: 3600 })];
        expect(unsyncedCompletedSecondsForDay(rows, startOfToday())).toBe(0);
    });

    test("excludes sessions started before today", () => {
        const yesterday = new Date(Date.now() - DAY_MS).toISOString();
        const rows = [
            session({ started_at: yesterday, duration_seconds: 3600 }),
        ];
        expect(unsyncedCompletedSecondsForDay(rows, startOfToday())).toBe(0);
    });

    test("sums multiple pending offline sessions from today", () => {
        const rows = [
            session({ id: "a", duration_seconds: 1200 }),
            session({ id: "b", started_at: todayAt(13), ended_at: todayAt(14), duration_seconds: 3000 }),
            session({ id: "synced", synced_start: 1, synced_stop: 1, duration_seconds: 9999 }),
        ];
        expect(unsyncedCompletedSecondsForDay(rows, startOfToday())).toBe(4200);
    });

    test("safe for empty / non-array / malformed rows", () => {
        expect(unsyncedCompletedSecondsForDay([], startOfToday())).toBe(0);
        expect(unsyncedCompletedSecondsForDay(null, startOfToday())).toBe(0);
        expect(
            unsyncedCompletedSecondsForDay(
                [session({ started_at: "not-a-date" })],
                startOfToday(),
            ),
        ).toBe(0);
    });
});
