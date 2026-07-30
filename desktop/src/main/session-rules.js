// Pure decision logic for local-first work sessions.
//
// No SQLite, no Electron, no network — callers read rows and pass plain objects in.
// That is deliberate: better-sqlite3 is compiled against Electron's ABI and cannot be
// loaded by Jest (the suite maps it to a stub), so anything expressed as SQL is
// effectively untestable here. Every rule that could silently lose tracked time lives in
// this file instead, where it can be tested exhaustively.
//
// Replaces timer-session-sync.js, which carried the same rationale for the old
// synced_start/synced_stop model.

/**
 * A row is DIRTY when the server has not acknowledged its current revision.
 *
 * `revision` is bumped by every local mutation; `synced_revision` records the revision
 * the server confirmed. Comparing the two — rather than a boolean flag — is what makes a
 * mutation that lands mid-round-trip stay dirty instead of being falsely marked clean.
 */
function isDirty(row) {
    if (!row) return false;
    const synced = row.synced_revision;
    if (synced === null || synced === undefined) return true;
    return Number(synced) !== Number(row.revision);
}

/**
 * A row is CONFIRMED when the server has durably stored its current revision: it is
 * closed, has a real server id, carries a confirmation stamp, and nothing has been
 * mutated locally since. Only confirmed rows may ever be purged.
 */
function isConfirmed(row) {
    if (!row) return false;
    if (row.ended_at == null) return false;
    if (!row.server_entry_id) return false;
    if (!row.confirmed_at) return false;
    return !isDirty(row);
}

/**
 * Decide whether a sync result durably acknowledges the revision we actually sent.
 *
 * `sentRevision` is captured BEFORE the request goes out. If the user stopped the timer
 * or an idle split ran while the request was in flight, the row's revision has moved on
 * and the ack no longer describes local truth — the row must stay dirty and go again.
 */
function shouldConfirm(result, sentRevision) {
    if (!result || result.status !== 'ok') return false;
    if (!result.time_entry_id) return false;
    return Number(result.revision) === Number(sentRevision);
}

/**
 * True when the server stored a different duration than we hold locally.
 *
 * Not a failure — the server's value is authoritative once acked, and retrying forever
 * over a discrepancy would be worse than recording it. Callers surface this so a
 * server-side clamp is visible in logs before the local row is purged.
 */
function hasDurationMismatch(row, result) {
    if (!row || !result) return false;
    if (row.duration_seconds == null || result.duration_seconds == null) return false;
    return Number(row.duration_seconds) !== Number(result.duration_seconds);
}

// ── Timezone helpers ────────────────────────────────────────────────────────
// Day boundaries MUST be computed in the ORGANIZATION's timezone: that is the zone
// TimezoneAwareDateRange uses server-side for every report, attendance rollup and
// payslip. Splitting on the machine's local zone would mis-attribute hours for anyone
// travelling or working outside the org's zone.

/** Wall-clock parts of an instant, as seen in `timeZone`. */
function zonedParts(ms, timeZone) {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
    const parts = {};
    for (const p of fmt.formatToParts(new Date(ms))) {
        if (p.type !== 'literal') parts[p.type] = p.value;
    }
    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        // Intl renders midnight as "24" in some ICU versions under hour12:false.
        hour: Number(parts.hour) % 24,
        minute: Number(parts.minute),
        second: Number(parts.second),
    };
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function zoneOffsetMs(ms, timeZone) {
    const p = zonedParts(ms, timeZone);
    const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    // Sub-second precision is irrelevant to a day boundary; drop it to avoid drift.
    return asIfUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * UTC instant of 00:00 on the `timeZone` calendar day containing `ms`.
 *
 * Two-pass: the first guess uses the offset at `ms`, the second re-derives the offset AT
 * the candidate midnight. That second pass is what makes DST-transition days correct —
 * on a spring-forward date the offset at noon differs from the offset at midnight.
 */
function startOfZonedDay(ms, timeZone) {
    const p = zonedParts(ms, timeZone);
    const localMidnightAsUtc = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0);
    let guess = localMidnightAsUtc - zoneOffsetMs(ms, timeZone);
    guess = localMidnightAsUtc - zoneOffsetMs(guess, timeZone);
    return guess;
}

/** UTC instant of the first 00:00 strictly after `ms`, in `timeZone`. */
function nextZonedMidnight(ms, timeZone) {
    const start = startOfZonedDay(ms, timeZone);
    // +26h always lands inside the following calendar day even across a 1h DST shift;
    // snapping back to that day's start yields the boundary itself.
    return startOfZonedDay(start + 26 * 3600 * 1000, timeZone);
}

/** 'YYYY-MM-DD' for an instant in `timeZone`. */
function zonedDayKey(ms, timeZone) {
    const p = zonedParts(ms, timeZone);
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * Midnight boundaries a live session has crossed and must be split at.
 *
 * Returns ascending UTC instants, each strictly inside (startedAtMs, nowMs). Empty when
 * the session has not crossed a boundary — the overwhelmingly common case, so callers
 * can treat this as a cheap per-tick check.
 *
 * LOOPS deliberately: a machine asleep from Friday to Monday wakes with three boundaries
 * behind it and must produce one row per calendar day, not a single impossible row.
 * `maxBoundaries` bounds the work if a clock jumps years (a corrupt RTC), so one bad
 * reading cannot spin here forever.
 */
function midnightBoundaries(startedAtMs, nowMs, timeZone, maxBoundaries = 400) {
    const out = [];
    if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs)) return out;
    if (nowMs <= startedAtMs) return out;

    let boundary = nextZonedMidnight(startedAtMs, timeZone);
    while (boundary < nowMs && out.length < maxBoundaries) {
        out.push(boundary);
        const next = nextZonedMidnight(boundary, timeZone);
        // Defensive: a pathological zone/DST result that fails to advance would loop.
        if (next <= boundary) break;
        boundary = next;
    }
    return out;
}

/**
 * True when a live session needs splitting right now.
 */
function needsMidnightSplit(startedAtMs, nowMs, timeZone) {
    return midnightBoundaries(startedAtMs, nowMs, timeZone, 1).length > 0;
}

// ── Purge ───────────────────────────────────────────────────────────────────

/**
 * Eligibility for deleting a local row.
 *
 * Confirmed-and-aged only. The age grace exists so a row is never removed in the same
 * breath as its acknowledgement — if a sync is later found to have been misapplied there
 * is still a local copy to inspect. Live rows, dirty rows and unconfirmed rows are all
 * ineligible by construction.
 */
function isPurgeable(row, nowMs, minAgeMs) {
    if (!isConfirmed(row)) return false;
    const confirmedMs = Date.parse(row.confirmed_at);
    if (!Number.isFinite(confirmedMs)) return false;
    return nowMs - confirmedMs >= minAgeMs;
}

/**
 * Whether the 05:00 purge is due.
 *
 * Compares the most recent 05:00 boundary in `timeZone` against the last purge. This is
 * SLEEP-SAFE by construction, unlike scheduling a timer for the next 05:00: a laptop
 * asleep across the boundary simply finds the check true on its next tick.
 */
function isPurgeDue(nowMs, lastPurgeAtMs, timeZone, hour = 5) {
    const startOfToday = startOfZonedDay(nowMs, timeZone);
    let boundary = startOfToday + hour * 3600 * 1000;
    if (boundary > nowMs) {
        // Today's boundary is still ahead — the most recent one was yesterday.
        const yesterday = startOfZonedDay(startOfToday - 12 * 3600 * 1000, timeZone);
        boundary = yesterday + hour * 3600 * 1000;
    }
    if (lastPurgeAtMs == null) return true;
    return lastPurgeAtMs < boundary;
}

// ── Backoff ─────────────────────────────────────────────────────────────────

/** Retry schedule after a failed sync cycle, in ms. Capped, never zero. */
const BACKOFF_SCHEDULE_MS = [30000, 60000, 120000, 300000, 600000];

function nextBackoffMs(consecutiveFailures) {
    const n = Math.max(1, Number(consecutiveFailures) || 1);
    const idx = Math.min(n - 1, BACKOFF_SCHEDULE_MS.length - 1);
    return BACKOFF_SCHEDULE_MS[idx];
}

// ── Display totals ──────────────────────────────────────────────────────────

/**
 * Seconds of completed local work the SERVER does not know about yet, for the given
 * local day. Added to the displayed today-total so time tracked offline stays visible
 * instead of the total appearing to reset on reconnect.
 *
 * Only rows the server has NEVER acknowledged are counted (`server_entry_id` absent):
 * once an entry exists server-side it is already inside the fetched today-total, and
 * adding it again would double-count.
 */
function unsyncedCompletedSecondsForDay(rows, startOfDayMs) {
    let total = 0;
    for (const r of Array.isArray(rows) ? rows : []) {
        if (!r || r.ended_at == null) continue;
        if (r.server_entry_id) continue;
        const startMs = Date.parse(r.started_at);
        if (Number.isFinite(startMs) && startMs >= startOfDayMs) {
            total += Number(r.duration_seconds) || 0;
        }
    }
    return total;
}

/**
 * Completed seconds tracked locally for ONE project on a given day.
 *
 * Unlike unsyncedCompletedSecondsForDay this counts every completed row, synced or
 * not. It seeds the on-screen project total the instant a timer starts, before any
 * server figure can arrive — starting a timer on a project that already has hours
 * on it must not make the display fall back to 00:00:00 until the next status tick.
 * A null projectId matches rows with no project, so "no project" is a bucket too.
 */
function completedSecondsForProjectDay(
    rows,
    startOfDayMs,
    projectId,
    { unsyncedOnly = false } = {},
) {
    const want = String(projectId ?? "");
    let total = 0;
    for (const r of Array.isArray(rows) ? rows : []) {
        if (!r || r.ended_at == null) continue;
        if (unsyncedOnly && r.server_entry_id) continue;
        if (String(r.project_id ?? "") !== want) continue;
        const startMs = Date.parse(r.started_at);
        if (Number.isFinite(startMs) && startMs >= startOfDayMs) {
            total += Number(r.duration_seconds) || 0;
        }
    }
    return total;
}

/** True if any completed row still needs syncing — drives the retry-until-synced loop. */
function hasPendingCompletedSession(rows) {
    return (Array.isArray(rows) ? rows : []).some(
        (r) => r && r.ended_at != null && isDirty(r),
    );
}

module.exports = {
    isDirty,
    isConfirmed,
    shouldConfirm,
    hasDurationMismatch,
    zonedParts,
    zonedDayKey,
    startOfZonedDay,
    nextZonedMidnight,
    midnightBoundaries,
    needsMidnightSplit,
    isPurgeable,
    isPurgeDue,
    nextBackoffMs,
    BACKOFF_SCHEDULE_MS,
    unsyncedCompletedSecondsForDay,
    completedSecondsForProjectDay,
    hasPendingCompletedSession,
};
