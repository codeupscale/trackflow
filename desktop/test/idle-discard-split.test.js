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

// The arithmetic above passed for weeks while the shipped code billed every idle
// gap: it mirrors what handleIdleAction is SUPPOSED to do, and the real call site
// computed `resumeIso` and then never passed it, so `closeAndReopen` reopened the
// successor at idle-START and the gap simply moved into the new row.
//
// A mirror can only be trusted if something checks it against the wiring. That is
// what these do. See bugs/desktop-idle-continue-still-bills-the-idle-gap.md.
describe('the real call site actually splits at TWO instants', () => {
    const fs = require('fs');
    const path = require('path');
    const INDEX = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'main', 'index.js'),
        'utf8',
    );
    const STORE = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'main', 'work-session-store.js'),
        'utf8',
    );
    const flat = (s) => s.replace(/\s+/g, ' ');

    test('the idle discard passes the resume instant to splitLocalSession', () => {
        expect(flat(INDEX)).toMatch(
            /splitLocalSession\( prevLocalId, idleStartIso, currentEntry\.project_id \|\| null, null, resumeIso, \)/,
        );
    });

    test('splitLocalSession forwards a reopen instant to the store', () => {
        expect(flat(INDEX)).toMatch(
            /function splitLocalSession\( localId, atIso, projectId, taskId = null, reopenAtIso = null, \)/,
        );
        expect(flat(INDEX)).toMatch(
            /closeAndReopen\(localId, atIso, \{ projectId, taskId, reopenAtIso, \}\)/,
        );
    });

    test('closeAndReopen defaults to contiguous, and honours a later reopen', () => {
        // Contiguous is right for a project switch and the midnight split: no instant
        // may belong to no session. Idle is the one case that must leave a hole.
        expect(flat(STORE)).toMatch(
            /closeAndReopen\(id, atIso, \{ projectId, taskId = null, reopenAtIso = null \} = \{\}\)/,
        );
        expect(flat(STORE)).toMatch(/const startedAt = reopenAtIso \|\| atIso;/);
        expect(flat(STORE)).toMatch(
            /this\.close\(id, atIso\); return this\.open\(\{ projectId, taskId, startedAt \}\);/,
        );
    });

    test('a reopen BEFORE the close instant is rejected, never silently accepted', () => {
        expect(flat(STORE)).toMatch(
            /if \(Date\.parse\(startedAt\) < Date\.parse\(atIso\)\) \{ throw new Error\(/,
        );
    });
});
