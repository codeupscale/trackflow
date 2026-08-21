/**
 * "You're back, and you are NOT being tracked."
 *
 * The gap this closes: an employee walks away for a break on a machine that never
 * sleeps and never locks (on charger, external display, screensaver off — the normal
 * office desktop). The idle detector fires, the alert goes unanswered, and the idle
 * watchdog hard-stops the timer. Every existing notification path then misses them:
 *
 *   - the auto-stop toast fires at the moment of the stop, while nobody is at the desk,
 *     and is gone from the screen long before they sit back down;
 *   - `notifyTrackingState()` only runs on wake / unlock / startup, and a machine that
 *     never slept emits none of those;
 *   - the idle alert window was dismissed by the stop itself.
 *
 * So the user returns to a normal-looking desktop and works untracked until they happen
 * to glance at the tray. This module decides when to tell them.
 *
 * Pure: no Electron, no I/O, no timers — index.js owns the polling and the effects.
 * (Same constraint as session-rules.js: anything importable is anything testable.)
 */

/** A break worth announcing. Shorter absences are noise — the user knows they stepped away. */
const DEFAULT_AWAY_THRESHOLD_SEC = 120;

/**
 * OS idle seconds at or below which the user counts as "back at the keyboard".
 * `getSystemIdleTime()` resets to 0 on the first input event, so this only needs to
 * absorb the poll interval, not real think-time.
 */
const DEFAULT_RETURN_ACTIVE_SEC = 15;

/** One announcement per absence; re-arming needs a fresh absence, not a fresh poll. */
const DEFAULT_COOLDOWN_MS = 60_000;

/**
 * Decide whether the user has just come back from a break to a stopped timer.
 *
 * @param {object}  o
 * @param {boolean} o.isAuthenticated      no notifications to a signed-out app
 * @param {boolean} o.isTracking           a running timer needs no warning
 * @param {boolean} o.isIdleAlertActive    the alert is already asking them — don't stack
 * @param {number}  o.systemIdleSec        `powerMonitor.getSystemIdleTime()`
 * @param {number}  o.peakIdleSec          the longest idle reading observed in this absence
 * @param {number}  o.now                  ms
 * @param {number}  [o.lastNotifiedAt=0]   ms of the previous announcement
 * @param {number}  [o.awayThresholdSec]
 * @param {number}  [o.returnActiveSec]
 * @param {number}  [o.cooldownMs]
 * @returns {{ notify: boolean, reason: string }}
 */
function returnToWorkDecision({
    isAuthenticated,
    isTracking,
    isIdleAlertActive = false,
    systemIdleSec,
    peakIdleSec,
    now,
    lastNotifiedAt = 0,
    awayThresholdSec = DEFAULT_AWAY_THRESHOLD_SEC,
    returnActiveSec = DEFAULT_RETURN_ACTIVE_SEC,
    cooldownMs = DEFAULT_COOLDOWN_MS,
} = {}) {
    if (!isAuthenticated) return { notify: false, reason: 'signed-out' };

    // A running timer is the good case — saying nothing is correct.
    if (isTracking) return { notify: false, reason: 'tracking' };

    // The idle alert is a modal asking this exact question. Two prompts is worse than one.
    if (isIdleAlertActive) return { notify: false, reason: 'idle-alert-active' };

    // Fail SAFE, not silent: an unreadable idle counter (some Wayland sessions throw)
    // must not be mistaken for "the user is away", or we would announce nothing forever.
    if (!Number.isFinite(systemIdleSec) || !Number.isFinite(peakIdleSec)) {
        return { notify: false, reason: 'no-idle-reading' };
    }

    // Never been away long enough for this to be a "break".
    if (peakIdleSec < awayThresholdSec) return { notify: false, reason: 'not-away' };

    // Away, but still away — announce on the RETURN, not while the desk is empty.
    // This is the whole point: the auto-stop toast already fired into an empty room.
    if (systemIdleSec > returnActiveSec) return { notify: false, reason: 'still-away' };

    if (now - lastNotifiedAt < cooldownMs) return { notify: false, reason: 'cooldown' };

    return { notify: true, reason: 'returned-to-stopped-timer' };
}

/**
 * Track the longest idle reading of the current absence.
 *
 * Peak rather than "last reading" because the poll can easily land AFTER the user has
 * already touched the keyboard, by which point `getSystemIdleTime()` has reset to 0 and
 * the absence would be invisible. Reset once the user is back and has been told.
 *
 * @returns {number} the new peak
 */
function trackPeakIdle(peakIdleSec, systemIdleSec) {
    if (!Number.isFinite(systemIdleSec)) return peakIdleSec;
    if (!Number.isFinite(peakIdleSec)) return systemIdleSec;
    return Math.max(peakIdleSec, systemIdleSec);
}

/** Wording for the announcement. Pure so the copy is unit-testable. */
function buildReturnToWorkNotification(awaySec) {
    const mins = Math.max(1, Math.round((Number(awaySec) || 0) / 60));
    const away = mins >= 60
        ? `${Math.floor(mins / 60)}h ${mins % 60}m`
        : `${mins} min`;
    return {
        title: 'TrackFlow — Welcome back. You are NOT being tracked',
        body: `The timer stopped while you were away (${away}). Time since then has NOT been recorded — start the timer to resume tracking.`,
    };
}

module.exports = {
    returnToWorkDecision,
    trackPeakIdle,
    buildReturnToWorkNotification,
    DEFAULT_AWAY_THRESHOLD_SEC,
    DEFAULT_RETURN_ACTIVE_SEC,
    DEFAULT_COOLDOWN_MS,
};
