const rules = require('../src/main/session-rules');

const KARACHI = 'Asia/Karachi'; // UTC+5, no DST
const NEW_YORK = 'America/New_York'; // UTC-5/-4, DST
const KATHMANDU = 'Asia/Kathmandu'; // UTC+5:45, non-hour offset

const iso = (s) => Date.parse(s);

describe('isDirty / isConfirmed', () => {
    test('a never-synced row is dirty', () => {
        expect(rules.isDirty({ revision: 1, synced_revision: null })).toBe(true);
    });

    test('a row synced at its current revision is clean', () => {
        expect(rules.isDirty({ revision: 3, synced_revision: 3 })).toBe(false);
    });

    test('a row mutated after syncing is dirty again', () => {
        expect(rules.isDirty({ revision: 4, synced_revision: 3 })).toBe(true);
    });

    test('synced_revision 0 is not mistaken for "never synced"', () => {
        // Guards against a truthiness check: 0 is falsy but IS an acknowledgement.
        expect(rules.isDirty({ revision: 0, synced_revision: 0 })).toBe(false);
    });

    test('a live row is never confirmed, however well synced', () => {
        expect(
            rules.isConfirmed({
                revision: 1,
                synced_revision: 1,
                ended_at: null,
                server_entry_id: 'srv',
                confirmed_at: '2026-07-30T00:00:00Z',
            }),
        ).toBe(false);
    });

    test('a closed, acked, stamped row is confirmed', () => {
        expect(
            rules.isConfirmed({
                revision: 2,
                synced_revision: 2,
                ended_at: '2026-07-30T10:00:00Z',
                server_entry_id: 'srv',
                confirmed_at: '2026-07-30T10:00:05Z',
            }),
        ).toBe(true);
    });

    test('a row without a server id is not confirmed', () => {
        expect(
            rules.isConfirmed({
                revision: 2,
                synced_revision: 2,
                ended_at: '2026-07-30T10:00:00Z',
                server_entry_id: null,
                confirmed_at: '2026-07-30T10:00:05Z',
            }),
        ).toBe(false);
    });
});

describe('shouldConfirm', () => {
    test('confirms when the ack matches the revision that was sent', () => {
        expect(rules.shouldConfirm({ status: 'ok', time_entry_id: 'srv', revision: 3 }, 3)).toBe(true);
    });

    test('does NOT confirm when the row changed mid-flight', () => {
        // Sent revision 3; the ack describes 3, but by the time it lands the row is at 4.
        // Confirming against the CURRENT revision here is the bug this guards.
        expect(rules.shouldConfirm({ status: 'ok', time_entry_id: 'srv', revision: 3 }, 4)).toBe(false);
    });

    test('does not confirm a rejected row', () => {
        expect(rules.shouldConfirm({ status: 'rejected', code: 'invalid_timestamp' }, 1)).toBe(false);
    });

    test('does not confirm an ok row with no server id', () => {
        expect(rules.shouldConfirm({ status: 'ok', revision: 1 }, 1)).toBe(false);
    });

    test('does not confirm on a missing/empty result', () => {
        expect(rules.shouldConfirm(null, 1)).toBe(false);
        expect(rules.shouldConfirm(undefined, 1)).toBe(false);
    });
});

describe('hasDurationMismatch', () => {
    test('flags a server-side clamp', () => {
        expect(
            rules.hasDurationMismatch({ duration_seconds: 90000 }, { duration_seconds: 86400 }),
        ).toBe(true);
    });

    test('agrees when identical', () => {
        expect(
            rules.hasDurationMismatch({ duration_seconds: 1200 }, { duration_seconds: 1200 }),
        ).toBe(false);
    });

    test('is silent when either side is unknown (an open session)', () => {
        expect(rules.hasDurationMismatch({ duration_seconds: null }, { duration_seconds: 10 })).toBe(false);
        expect(rules.hasDurationMismatch({ duration_seconds: 10 }, { duration_seconds: null })).toBe(false);
    });
});

describe('zoned day boundaries', () => {
    test('startOfZonedDay lands on local midnight (UTC+5)', () => {
        // 2026-07-30 15:00 PKT == 10:00 UTC. Local midnight is 2026-07-29T19:00Z.
        const start = rules.startOfZonedDay(iso('2026-07-30T10:00:00Z'), KARACHI);
        expect(new Date(start).toISOString()).toBe('2026-07-29T19:00:00.000Z');
    });

    test('handles a non-hour offset (UTC+5:45)', () => {
        const start = rules.startOfZonedDay(iso('2026-07-30T10:00:00Z'), KATHMANDU);
        expect(new Date(start).toISOString()).toBe('2026-07-29T18:15:00.000Z');
    });

    test('an instant exactly at local midnight is its own day start', () => {
        const midnight = iso('2026-07-29T19:00:00Z'); // 2026-07-30 00:00 PKT
        expect(rules.startOfZonedDay(midnight, KARACHI)).toBe(midnight);
    });

    test('nextZonedMidnight is strictly after, even from midnight itself', () => {
        const midnight = iso('2026-07-29T19:00:00Z');
        const next = rules.nextZonedMidnight(midnight, KARACHI);
        expect(next).toBeGreaterThan(midnight);
        expect(new Date(next).toISOString()).toBe('2026-07-30T19:00:00.000Z');
    });

    test('zonedDayKey reports the LOCAL day, not the UTC day', () => {
        // 2026-07-29T20:00Z is already 2026-07-30 in Karachi.
        expect(rules.zonedDayKey(iso('2026-07-29T20:00:00Z'), KARACHI)).toBe('2026-07-30');
        expect(rules.zonedDayKey(iso('2026-07-29T20:00:00Z'), 'UTC')).toBe('2026-07-29');
    });

    test('crosses a DST spring-forward boundary correctly', () => {
        // US DST begins 2026-03-08. Local midnight that day is 05:00 UTC (still EST).
        const start = rules.startOfZonedDay(iso('2026-03-08T18:00:00Z'), NEW_YORK);
        expect(new Date(start).toISOString()).toBe('2026-03-08T05:00:00.000Z');
        // The NEXT midnight is only 23h later — the clock jumped an hour.
        const next = rules.nextZonedMidnight(start, NEW_YORK);
        expect(new Date(next).toISOString()).toBe('2026-03-09T04:00:00.000Z');
        expect(next - start).toBe(23 * 3600 * 1000);
    });

    test('crosses a DST fall-back boundary correctly', () => {
        // US DST ends 2026-11-01. That local day is 25h long.
        const start = rules.startOfZonedDay(iso('2026-11-01T12:00:00Z'), NEW_YORK);
        expect(new Date(start).toISOString()).toBe('2026-11-01T04:00:00.000Z');
        const next = rules.nextZonedMidnight(start, NEW_YORK);
        expect(next - start).toBe(25 * 3600 * 1000);
    });
});

describe('midnightBoundaries', () => {
    test('an ordinary same-day session needs no split', () => {
        const start = iso('2026-07-30T06:00:00Z'); // 11:00 PKT
        const now = iso('2026-07-30T10:00:00Z'); // 15:00 PKT
        expect(rules.midnightBoundaries(start, now, KARACHI)).toEqual([]);
        expect(rules.needsMidnightSplit(start, now, KARACHI)).toBe(false);
    });

    test('a session crossing midnight yields exactly one boundary', () => {
        const start = iso('2026-07-29T18:00:00Z'); // 23:00 PKT Jul 29
        const now = iso('2026-07-29T20:00:00Z'); // 01:00 PKT Jul 30
        const b = rules.midnightBoundaries(start, now, KARACHI);
        expect(b).toHaveLength(1);
        expect(new Date(b[0]).toISOString()).toBe('2026-07-29T19:00:00.000Z');
        expect(rules.needsMidnightSplit(start, now, KARACHI)).toBe(true);
    });

    test('a weekend-long sleep yields one boundary per calendar day crossed', () => {
        // Friday 22:00 PKT through Monday 09:00 PKT: Sat, Sun, Mon midnights.
        const start = iso('2026-07-24T17:00:00Z');
        const now = iso('2026-07-27T04:00:00Z');
        const b = rules.midnightBoundaries(start, now, KARACHI);
        expect(b.map((x) => new Date(x).toISOString())).toEqual([
            '2026-07-24T19:00:00.000Z',
            '2026-07-25T19:00:00.000Z',
            '2026-07-26T19:00:00.000Z',
        ]);
    });

    test('boundaries are strictly inside the interval and strictly ascending', () => {
        const start = iso('2026-07-24T17:00:00Z');
        const now = iso('2026-07-27T04:00:00Z');
        const b = rules.midnightBoundaries(start, now, KARACHI);
        for (let i = 0; i < b.length; i++) {
            expect(b[i]).toBeGreaterThan(start);
            expect(b[i]).toBeLessThan(now);
            if (i > 0) expect(b[i]).toBeGreaterThan(b[i - 1]);
        }
    });

    test('splitting loses no seconds and double-counts none', () => {
        // The contiguity invariant: each row ends exactly where the next begins, and the
        // pieces sum to the whole. This is the property that makes the split safe.
        const start = iso('2026-07-24T17:00:00Z');
        const now = iso('2026-07-27T04:00:00Z');
        const edges = [start, ...rules.midnightBoundaries(start, now, KARACHI), now];

        let sum = 0;
        for (let i = 1; i < edges.length; i++) {
            expect(edges[i]).toBeGreaterThan(edges[i - 1]);
            sum += edges[i] - edges[i - 1];
        }
        expect(sum).toBe(now - start);
    });

    test('each split piece falls entirely within one local day', () => {
        const start = iso('2026-07-24T17:00:00Z');
        const now = iso('2026-07-27T04:00:00Z');
        const edges = [start, ...rules.midnightBoundaries(start, now, KARACHI), now];

        for (let i = 1; i < edges.length; i++) {
            const dayAtStart = rules.zonedDayKey(edges[i - 1], KARACHI);
            // End instant is exclusive; step back 1ms to stay inside the piece.
            const dayAtEnd = rules.zonedDayKey(edges[i] - 1, KARACHI);
            expect(dayAtEnd).toBe(dayAtStart);
        }
    });

    test('respects the org timezone rather than the machine timezone', () => {
        // 2026-07-29T20:00Z → already Jul 30 in Karachi, still Jul 29 in New York.
        const start = iso('2026-07-29T18:00:00Z');
        const now = iso('2026-07-29T20:00:00Z');
        expect(rules.midnightBoundaries(start, now, KARACHI)).toHaveLength(1);
        expect(rules.midnightBoundaries(start, now, NEW_YORK)).toHaveLength(0);
    });

    test('a session ending exactly at midnight is not split', () => {
        // Avoids minting a zero-length live row; the next tick splits it.
        const start = iso('2026-07-29T18:00:00Z');
        const midnight = iso('2026-07-29T19:00:00Z');
        expect(rules.midnightBoundaries(start, midnight, KARACHI)).toEqual([]);
    });

    test('is bounded when the clock jumps years', () => {
        const start = iso('2020-01-01T00:00:00Z');
        const now = iso('2026-01-01T00:00:00Z');
        expect(rules.midnightBoundaries(start, now, KARACHI, 10)).toHaveLength(10);
    });

    test('returns nothing for a reversed or non-finite interval', () => {
        expect(rules.midnightBoundaries(iso('2026-07-30T10:00:00Z'), iso('2026-07-29T10:00:00Z'), KARACHI)).toEqual([]);
        expect(rules.midnightBoundaries(NaN, iso('2026-07-30T10:00:00Z'), KARACHI)).toEqual([]);
    });
});

describe('isPurgeable', () => {
    const confirmed = {
        revision: 2,
        synced_revision: 2,
        ended_at: '2026-07-28T10:00:00Z',
        server_entry_id: 'srv',
        confirmed_at: '2026-07-28T10:00:05Z',
    };
    const now = iso('2026-07-30T05:00:00Z');
    const DAY = 24 * 3600 * 1000;

    test('purges a confirmed row past the age grace', () => {
        expect(rules.isPurgeable(confirmed, now, DAY)).toBe(true);
    });

    test('keeps a confirmed row that is still inside the grace', () => {
        expect(rules.isPurgeable({ ...confirmed, confirmed_at: '2026-07-30T04:00:00Z' }, now, DAY)).toBe(false);
    });

    test('NEVER purges a live row', () => {
        expect(rules.isPurgeable({ ...confirmed, ended_at: null }, now, DAY)).toBe(false);
    });

    test('NEVER purges a dirty row', () => {
        expect(rules.isPurgeable({ ...confirmed, revision: 3 }, now, DAY)).toBe(false);
    });

    test('NEVER purges an unconfirmed row', () => {
        expect(rules.isPurgeable({ ...confirmed, confirmed_at: null }, now, DAY)).toBe(false);
        expect(rules.isPurgeable({ ...confirmed, server_entry_id: null }, now, DAY)).toBe(false);
    });

    test('keeps a row whose confirmation stamp is unparseable', () => {
        expect(rules.isPurgeable({ ...confirmed, confirmed_at: 'not-a-date' }, now, DAY)).toBe(false);
    });
});

describe('isPurgeDue', () => {
    test('due when it has never run', () => {
        expect(rules.isPurgeDue(iso('2026-07-30T10:00:00Z'), null, KARACHI)).toBe(true);
    });

    test('due just after 05:00 local when the last run predates it', () => {
        const now = iso('2026-07-30T00:30:00Z'); // 05:30 PKT
        const last = iso('2026-07-29T06:00:00Z');
        expect(rules.isPurgeDue(now, last, KARACHI)).toBe(true);
    });

    test('not due again the same day', () => {
        const now = iso('2026-07-30T06:00:00Z'); // 11:00 PKT
        const last = iso('2026-07-30T00:05:00Z'); // 05:05 PKT, already ran
        expect(rules.isPurgeDue(now, last, KARACHI)).toBe(false);
    });

    test('not due before 05:00 local when yesterday already ran', () => {
        const now = iso('2026-07-29T22:00:00Z'); // 03:00 PKT Jul 30
        const last = iso('2026-07-29T00:10:00Z'); // 05:10 PKT Jul 29
        expect(rules.isPurgeDue(now, last, KARACHI)).toBe(false);
    });

    test('fires after a sleep across the boundary', () => {
        // Asleep 03:00 PKT Jul 30 → 09:00 PKT Jul 30, straight over 05:00. A
        // setTimeout(msUntil5am) would simply never have fired.
        const now = iso('2026-07-30T04:00:00Z'); // 09:00 PKT
        const last = iso('2026-07-29T00:10:00Z'); // 05:10 PKT Jul 29
        expect(rules.isPurgeDue(now, last, KARACHI)).toBe(true);
    });
});

describe('nextBackoffMs', () => {
    test('escalates then caps', () => {
        expect(rules.nextBackoffMs(1)).toBe(30000);
        expect(rules.nextBackoffMs(2)).toBe(60000);
        expect(rules.nextBackoffMs(3)).toBe(120000);
        expect(rules.nextBackoffMs(4)).toBe(300000);
        expect(rules.nextBackoffMs(5)).toBe(600000);
        expect(rules.nextBackoffMs(99)).toBe(600000);
    });

    test('never returns zero for a bogus count', () => {
        expect(rules.nextBackoffMs(0)).toBe(30000);
        expect(rules.nextBackoffMs(undefined)).toBe(30000);
        expect(rules.nextBackoffMs(-5)).toBe(30000);
    });
});

describe('limitToOneOpenSession', () => {
    // The server 422s an entire batch that carries two open sessions, so one orphaned
    // open row (phantom stop → user clicks Start again) would otherwise block EVERY
    // upload, for every session, on every cycle.
    const closed = (id, started) => ({
        id,
        started_at: started,
        created_at: started,
        ended_at: started,
    });
    const open = (id, started, created = started) => ({
        id,
        started_at: started,
        created_at: created,
        ended_at: null,
    });

    test('passes a batch with a single open row through untouched', () => {
        const rows = [closed('a', '2026-08-10T01:00:00Z'), open('b', '2026-08-10T02:00:00Z')];
        expect(rules.limitToOneOpenSession(rows)).toEqual(rows);
    });

    test('keeps only the newest open row and every closed row', () => {
        const orphan = open('orphan', '2026-08-09T09:00:00Z');
        const live = open('live', '2026-08-10T08:00:00Z');
        const done = closed('done', '2026-08-10T01:00:00Z');
        const kept = rules.limitToOneOpenSession([orphan, done, live]);
        expect(kept.map((r) => r.id)).toEqual(['done', 'live']);
    });

    test('never drops a closed row, however many open ones there are', () => {
        const rows = [
            closed('c1', '2026-08-10T01:00:00Z'),
            open('o1', '2026-08-10T02:00:00Z'),
            open('o2', '2026-08-10T03:00:00Z'),
            open('o3', '2026-08-10T04:00:00Z'),
            closed('c2', '2026-08-10T05:00:00Z'),
        ];
        const kept = rules.limitToOneOpenSession(rows);
        expect(kept.filter((r) => r.ended_at == null)).toHaveLength(1);
        expect(kept.map((r) => r.id)).toEqual(['c1', 'o3', 'c2']);
    });

    test('handles an empty / non-array input', () => {
        expect(rules.limitToOneOpenSession(null)).toEqual([]);
        expect(rules.limitToOneOpenSession([])).toEqual([]);
    });
});

describe('display totals', () => {
    const startOfDay = iso('2026-07-30T00:00:00Z');

    test('counts completed rows the server has never seen', () => {
        const rows = [
            { ended_at: 'x', started_at: '2026-07-30T01:00:00Z', duration_seconds: 600, server_entry_id: null, revision: 2, synced_revision: null },
            { ended_at: 'x', started_at: '2026-07-30T02:00:00Z', duration_seconds: 900, server_entry_id: null, revision: 2, synced_revision: null },
        ];
        expect(rules.unsyncedCompletedSecondsForDay(rows, startOfDay)).toBe(1500);
    });

    test('excludes rows the server has confirmed at this revision (no double-count)', () => {
        const rows = [
            {
                ended_at: 'x',
                started_at: '2026-07-30T01:00:00Z',
                duration_seconds: 600,
                server_entry_id: 'srv',
                revision: 2,
                synced_revision: 2,
                server_duration_seconds: 600,
            },
        ];
        expect(rules.unsyncedCompletedSecondsForDay(rows, startOfDay)).toBe(0);
    });

    // THE IDLE-DISCARD ROW. It was pushed while it was still LIVE, so it has a
    // server_entry_id — but server-side it is the OPEN entry, absent from the closed
    // sum the desktop reads and whose live elapsed the desktop subtracts back out.
    // Skipping it here deducted the user's pre-idle work from both today-totals within
    // 10s of clicking "Continue tracking", until the next 10-minute session sync.
    // Bug: bugs/desktop-idle-continue-deducts-pre-idle-time-from-total.md
    test('counts a row synced while OPEN and since closed locally', () => {
        const rows = [
            {
                ended_at: '2026-07-30T02:40:00Z',
                started_at: '2026-07-30T02:00:00Z',
                duration_seconds: 2400,
                server_entry_id: 'srv',
                revision: 3,
                synced_revision: 2,
                server_duration_seconds: null,
            },
        ];
        expect(rules.unsyncedCompletedSecondsForDay(rows, startOfDay)).toBe(2400);
    });

    test('credits only what the server has not already stored for a partially-known row', () => {
        const rows = [
            {
                ended_at: 'x',
                started_at: '2026-07-30T02:00:00Z',
                duration_seconds: 900,
                server_entry_id: 'srv',
                revision: 4,
                synced_revision: 3,
                server_duration_seconds: 600,
            },
        ];
        expect(rules.unsyncedCompletedSecondsForDay(rows, startOfDay)).toBe(300);
    });

    test('excludes live rows and earlier days', () => {
        const rows = [
            { ended_at: null, started_at: '2026-07-30T01:00:00Z', duration_seconds: null, server_entry_id: null, revision: 1, synced_revision: null },
            { ended_at: 'x', started_at: '2026-07-29T01:00:00Z', duration_seconds: 600, server_entry_id: null, revision: 2, synced_revision: null },
        ];
        expect(rules.unsyncedCompletedSecondsForDay(rows, startOfDay)).toBe(0);
    });

    describe('completedSecondsForProjectDay', () => {
        // Regression: starting a timer on a project that already had hours today
        // showed 00:00:00, because the start path hardcoded the project base to 0.
        test('sums every completed row for the project, synced or not', () => {
            const rows = [
                { ended_at: 'x', started_at: '2026-07-30T01:00:00Z', duration_seconds: 600, project_id: 'p1', server_entry_id: 'srv' },
                { ended_at: 'x', started_at: '2026-07-30T02:00:00Z', duration_seconds: 900, project_id: 'p1', server_entry_id: null },
            ];
            expect(rules.completedSecondsForProjectDay(rows, startOfDay, 'p1')).toBe(1500);
        });

        test('ignores other projects', () => {
            const rows = [
                { ended_at: 'x', started_at: '2026-07-30T01:00:00Z', duration_seconds: 600, project_id: 'p1' },
                { ended_at: 'x', started_at: '2026-07-30T02:00:00Z', duration_seconds: 900, project_id: 'p2' },
            ];
            expect(rules.completedSecondsForProjectDay(rows, startOfDay, 'p2')).toBe(900);
        });

        test('excludes live rows and earlier days', () => {
            const rows = [
                { ended_at: null, started_at: '2026-07-30T01:00:00Z', duration_seconds: null, project_id: 'p1' },
                { ended_at: 'x', started_at: '2026-07-29T23:00:00Z', duration_seconds: 600, project_id: 'p1' },
            ];
            expect(rules.completedSecondsForProjectDay(rows, startOfDay, 'p1')).toBe(0);
        });

        test('a null project id is its own bucket, not a wildcard', () => {
            const rows = [
                { ended_at: 'x', started_at: '2026-07-30T01:00:00Z', duration_seconds: 600, project_id: null },
                { ended_at: 'x', started_at: '2026-07-30T02:00:00Z', duration_seconds: 900, project_id: 'p1' },
            ];
            expect(rules.completedSecondsForProjectDay(rows, startOfDay, null)).toBe(600);
        });

        test('handles a missing/!array row set', () => {
            expect(rules.completedSecondsForProjectDay(null, startOfDay, 'p1')).toBe(0);
        });

        // The start seed adds ONLY unsynced local rows on top of the server's figure.
        // Counting synced rows there would double-count them against the server total
        // and overstate the day.
        test('unsyncedOnly skips rows the server has confirmed at this revision', () => {
            const rows = [
                {
                    ended_at: 'x',
                    started_at: '2026-07-30T01:00:00Z',
                    duration_seconds: 600,
                    project_id: 'p1',
                    server_entry_id: 'srv',
                    revision: 2,
                    synced_revision: 2,
                    server_duration_seconds: 600,
                },
                { ended_at: 'x', started_at: '2026-07-30T02:00:00Z', duration_seconds: 900, project_id: 'p1', server_entry_id: null, revision: 2, synced_revision: null },
            ];
            expect(rules.completedSecondsForProjectDay(rows, startOfDay, 'p1', { unsyncedOnly: true })).toBe(900);
            expect(rules.completedSecondsForProjectDay(rows, startOfDay, 'p1')).toBe(1500);
        });

        // Same regression as the day-total: the pre-idle row still counts toward the
        // PROJECT total until the server has it closed, or the project display drops by
        // the pre-idle span right after "Continue tracking".
        test('unsyncedOnly counts a row synced while OPEN and since closed locally', () => {
            const rows = [
                {
                    ended_at: '2026-07-30T02:40:00Z',
                    started_at: '2026-07-30T02:00:00Z',
                    duration_seconds: 2400,
                    project_id: 'p1',
                    server_entry_id: 'srv',
                    revision: 3,
                    synced_revision: 2,
                    server_duration_seconds: null,
                },
            ];
            expect(rules.completedSecondsForProjectDay(rows, startOfDay, 'p1', { unsyncedOnly: true })).toBe(2400);
        });
    });

    test('hasPendingCompletedSession only counts closed dirty rows', () => {
        expect(rules.hasPendingCompletedSession([{ ended_at: 'x', revision: 1, synced_revision: null }])).toBe(true);
        expect(rules.hasPendingCompletedSession([{ ended_at: 'x', revision: 1, synced_revision: 1 }])).toBe(false);
        expect(rules.hasPendingCompletedSession([{ ended_at: null, revision: 1, synced_revision: null }])).toBe(false);
        expect(rules.hasPendingCompletedSession([])).toBe(false);
    });
});
