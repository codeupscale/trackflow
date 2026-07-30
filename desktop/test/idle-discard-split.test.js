// Arithmetic of the local idle split.
//
// handleIdleAction() lives in src/main/index.js, which cannot be imported without
// booting Electron, so this mirrors the computation exactly as coded there — the same
// approach the retired timer-sync-invariants suite used. The invariant is worth pinning
// independently of the transport: it is what stops discarded idle time being billed.

const rules = require('../src/main/session-rules');

/**
 * Mirrors the "discard" branch of handleIdleAction() in src/main/index.js.
 *
 * The live session is closed at idle-START and a new one opened at the resume instant,
 * so the idle gap belongs to no session at all. Only pre-idle work is credited.
 */
function applyIdleDiscard({ sessionStartMs, idleStartMs, resumeMs, todayTotalBefore }) {
    const preIdleSeconds = Math.floor((idleStartMs - sessionStartMs) / 1000);
    return {
        closedAt: idleStartMs,
        reopenedAt: resumeMs,
        todayTotalAfter: todayTotalBefore + Math.max(0, preIdleSeconds),
        creditedSeconds: Math.max(0, preIdleSeconds),
        discardedSeconds: Math.max(0, Math.floor((resumeMs - idleStartMs) / 1000)),
    };
}

const MIN = 60 * 1000;

describe('idle discard splits the session locally', () => {
    // Worked 20 min, went idle, answered the prompt 12 min later.
    const sessionStartMs = Date.parse('2026-07-30T09:00:00Z');
    const idleStartMs = sessionStartMs + 20 * MIN;
    const resumeMs = idleStartMs + 12 * MIN;

    test('credits only the work done BEFORE going idle', () => {
        const r = applyIdleDiscard({
            sessionStartMs,
            idleStartMs,
            resumeMs,
            todayTotalBefore: 0,
        });

        expect(r.creditedSeconds).toBe(20 * 60);
        expect(r.todayTotalAfter).toBe(20 * 60);
    });

    test('the idle gap is credited to nobody', () => {
        const r = applyIdleDiscard({
            sessionStartMs,
            idleStartMs,
            resumeMs,
            todayTotalBefore: 0,
        });

        expect(r.discardedSeconds).toBe(12 * 60);
        // The closed session ends where idle began; the new one starts at the resume.
        // The gap between them belongs to no session — that is the whole point.
        expect(r.closedAt).toBe(idleStartMs);
        expect(r.reopenedAt).toBe(resumeMs);
        expect(r.reopenedAt - r.closedAt).toBe(12 * MIN);
    });

    test('regression: measuring to idle-END would bill the discarded gap', () => {
        // The historic bug — "desktop shows ~20m while the portal shows ~16m" — came
        // from measuring pre-idle work to idle-END. The new session already counts from
        // the resume, so that double-counts the gap.
        const wrong = Math.floor((resumeMs - sessionStartMs) / 1000);
        const right = applyIdleDiscard({
            sessionStartMs,
            idleStartMs,
            resumeMs,
            todayTotalBefore: 0,
        }).creditedSeconds;

        expect(wrong).toBe(32 * 60);
        expect(right).toBe(20 * 60);
        expect(wrong - right).toBe(12 * 60);
    });

    test('accumulates onto an existing day total', () => {
        const r = applyIdleDiscard({
            sessionStartMs,
            idleStartMs,
            resumeMs,
            todayTotalBefore: 3600,
        });

        expect(r.todayTotalAfter).toBe(3600 + 20 * 60);
    });

    test('a session that went idle immediately credits nothing', () => {
        const r = applyIdleDiscard({
            sessionStartMs,
            idleStartMs: sessionStartMs,
            resumeMs,
            todayTotalBefore: 0,
        });

        expect(r.creditedSeconds).toBe(0);
        expect(r.todayTotalAfter).toBe(0);
    });

    test('a clock that ran backwards never produces negative credit', () => {
        const r = applyIdleDiscard({
            sessionStartMs,
            idleStartMs: sessionStartMs - 5 * MIN,
            resumeMs,
            todayTotalBefore: 100,
        });

        expect(r.creditedSeconds).toBe(0);
        expect(r.todayTotalAfter).toBe(100);
    });

    test('both halves of the split remain syncable', () => {
        // The closed half and the newly opened half are ordinary dirty rows — there is
        // no separate idle payload to replay, which is what the idle_discard queue type
        // used to be for.
        const closed = { ended_at: 'x', revision: 2, synced_revision: 1 };
        const reopened = { ended_at: null, revision: 1, synced_revision: null };

        expect(rules.isDirty(closed)).toBe(true);
        expect(rules.isDirty(reopened)).toBe(true);
        expect(rules.isConfirmed(closed)).toBe(false);
    });
});
