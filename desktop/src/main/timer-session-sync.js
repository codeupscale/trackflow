// Pure helpers for the local-first timer offline retry / display logic.
//
// A session created (and possibly stopped) while offline lives in the SQLite
// `timer_sessions` table with synced_start / synced_stop flags. These helpers decide,
// from plain row objects, (a) whether any completed session still needs syncing —
// which drives the periodic retry-until-synced loop — and (b) how many seconds of
// completed-but-unsynced work to add back to the displayed today-total so offline time
// stays visible instead of "resetting" to the server value on reconnect.
//
// No DB, no Electron — index.js does the SQLite read and passes rows in, so this stays
// unit-testable (better-sqlite3 is mocked in the test env).

/**
 * A completed session (ended_at set) still needs syncing when its start never reached
 * the server (synced_start = 0) or the start synced but the stop did not
 * (synced_stop = 0). An open session (ended_at null) is not "completed" and is handled
 * by the active-timer path, not the completed-session retry.
 */
function isPendingCompletedSession(row) {
    if (!row || row.ended_at == null) return false;
    return Number(row.synced_start) === 0 || Number(row.synced_stop) === 0;
}

/** True if any row is a pending completed offline session. */
function hasPendingCompletedSession(rows) {
    return (Array.isArray(rows) ? rows : []).some(isPendingCompletedSession);
}

/**
 * Sum of duration_seconds for completed sessions the SERVER has no knowledge of yet
 * (synced_start === 0), started on/after startOfDayMs (local day).
 *
 * Only synced_start === 0 rows are counted:
 *  - once the start is on the server the entry is part of the server's today_total
 *    (adding it again would double-count), and
 *  - a start-synced / stop-pending row is already reflected server-side as open time.
 *
 * The result is added to the displayed today-total so the offline session's time
 * remains visible until the retry loop lands it on the server.
 */
function unsyncedCompletedSecondsForDay(rows, startOfDayMs) {
    let total = 0;
    for (const r of Array.isArray(rows) ? rows : []) {
        if (!r || r.ended_at == null) continue;
        if (Number(r.synced_start) !== 0) continue; // server already counts it
        const startMs = new Date(r.started_at).getTime();
        if (Number.isFinite(startMs) && startMs >= startOfDayMs) {
            total += Number(r.duration_seconds) || 0;
        }
    }
    return total;
}

module.exports = {
    isPendingCompletedSession,
    hasPendingCompletedSession,
    unsyncedCompletedSecondsForDay,
};
