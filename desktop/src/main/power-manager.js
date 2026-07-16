// Power Manager — sleep/lock/shutdown auto-stop and startup gap detection.
// Registered from initializeApp(); uses callbacks so timer/UI logic stays in index.js.

const { powerMonitor, Notification } = require("electron");

const DEFAULT_GAP_THRESHOLD_SEC = 180; // 3 minutes

let _registered = false;
let _suspendedAt = null;
let _callbacks = null;
// Coalesce the back-to-back power events a single lid-close emits. macOS (and
// Windows) fire BOTH 'lock-screen' and 'suspend' for one lid-close, a tick apart.
// Without this guard each event runs autoStopForPowerEvent and shows its own
// "auto-stopped" toast, so the user sees two notifications for one real stop
// (the timer itself is protected by the stopTimer mutex, but the toast is not).
// Reset on resume (next sleep cycle) and via a short fallback timeout.
let _autoStopInFlight = false;
let _autoStopResetTimer = null;

/**
 * @param {object} callbacks
 * @param {() => boolean} callbacks.isTimerRunning
 * @param {() => Promise<void>} callbacks.autoStopForPowerEvent - async (reason, endedAtMs)
 * @param {() => void} [callbacks.onSuspendCleanup] - tear down / preserve idle state on suspend
 * @param {() => boolean} [callbacks.shouldAutoStopOnSuspend] - return true to hard-stop
 *   the timer on suspend (legacy/tests). Default: keep timer running; pause capture only.
 * @param {() => void} callbacks.onResumeAfterSleep - optional; timer already stopped on suspend
 * @param {() => void} callbacks.removeListeners - unregister power handlers (logout)
 */
function registerPowerHandlers(callbacks) {
    if (_registered) {
        unregisterPowerHandlers();
    }
    _registered = true;
    _callbacks = callbacks;

    powerMonitor.removeAllListeners("suspend");
    powerMonitor.removeAllListeners("resume");
    powerMonitor.removeAllListeners("lock-screen");
    powerMonitor.removeAllListeners("unlock-screen");

    powerMonitor.on("suspend", () => handleSuspend("sleep"));
    powerMonitor.on("lock-screen", () => handleSuspend("lock-screen"));
    powerMonitor.on("resume", handleResume);
    powerMonitor.on("unlock-screen", handleResume);

    console.log(
        "[PowerManager] Handlers registered (pause capture on suspend; timer keeps running)",
    );
}

function unregisterPowerHandlers() {
    powerMonitor.removeAllListeners("suspend");
    powerMonitor.removeAllListeners("resume");
    powerMonitor.removeAllListeners("lock-screen");
    powerMonitor.removeAllListeners("unlock-screen");
    _registered = false;
    _suspendedAt = null;
    _callbacks = null;
    _autoStopInFlight = false;
    if (_autoStopResetTimer) {
        clearTimeout(_autoStopResetTimer);
        _autoStopResetTimer = null;
    }
}

async function handleSuspend(reason) {
    // FIX D5: Always tear down idle state on suspend, even if the timer isn't running
    // (defensive — a detached/armed idle detector must never survive a power event and
    // fire a spurious auto-stop / bogus idle_discard on wake). Runs before the
    // isTimerRunning short-circuit below.
    try {
        _callbacks?.onSuspendCleanup?.();
    } catch (e) {
        console.error("[power] onSuspendCleanup failed:", e.message);
    }

    const suspendedAtMs = Date.now();
    _suspendedAt = suspendedAtMs;

    if (!_callbacks?.isTimerRunning?.()) return;

    // Default: keep the timer running through sleep/lock; capture services pause in
    // onSuspendCleanup and resume on wake. Hard auto-stop only when the callback
    // explicitly opts in (legacy / tests).
    if (_callbacks?.shouldAutoStopOnSuspend?.() !== true) {
        console.log(
            `[power] ${reason} — timer kept running (capture paused until resume)`,
        );
        return;
    }

    // Legacy hard-stop path (shouldAutoStopOnSuspend === true).
    if (_autoStopInFlight) {
        console.log(
            `[power] ${reason} ignored — auto-stop already in progress from a paired power event`,
        );
        return;
    }
    _autoStopInFlight = true;
    if (_autoStopResetTimer) clearTimeout(_autoStopResetTimer);
    _autoStopResetTimer = setTimeout(() => {
        _autoStopInFlight = false;
    }, 10_000);

    console.log(
        `[power] ${reason} — auto-stopping timer at ${new Date(suspendedAtMs).toISOString()}`,
    );
    try {
        await _callbacks.autoStopForPowerEvent(reason, suspendedAtMs);
    } catch (e) {
        console.error("[power] auto-stop failed:", e.message);
    }
}

async function handleResume() {
    // New sleep/lock cycle begins — clear the paired-event coalescing guard.
    _autoStopInFlight = false;
    if (_autoStopResetTimer) {
        clearTimeout(_autoStopResetTimer);
        _autoStopResetTimer = null;
    }
    const suspendedAtMs = _suspendedAt;
    let sleepSec = 0;
    if (suspendedAtMs) {
        sleepSec = Math.floor((Date.now() - suspendedAtMs) / 1000);
        console.log(`[power] Resumed after ${sleepSec}s`);
        _suspendedAt = null;
    }
    // The sleep gap is measured HERE and handed to the callback: the suspend
    // handler cannot know how long a sleep will last, and nothing runs while the
    // machine is asleep, so resume is the only point at which the gap is known.
    await _callbacks?.onResumeAfterSleep?.({ sleepSec, suspendedAtMs });
}

/**
 * Pure sleep-gap logic (mirrors evaluateStartupGap, for the resume path).
 *
 * The idle detector structurally CANNOT catch a sleep: its interval does not run
 * while the machine is suspended, and the OS idle counter resets on wake because
 * opening the lid is an input event. Without this backstop an overnight sleep
 * accrues the whole gap as tracked time.
 *
 * Short sleeps (<= threshold: lunch, a meeting, a quick lid close) deliberately
 * keep running — that is the product policy. Only a gap LONGER than the idle
 * threshold closes the entry, back-dated to the last real activity so the sleep
 * gap itself is never credited.
 *
 * @returns {{ shouldClose: boolean, stopAtMs: number|null, gapSec: number }}
 */
function evaluateSleepGap({
    sleepSec,
    gapThresholdSec,
    lastActiveAtMs,
    suspendedAtMs,
    hasOpenSession,
}) {
    const gapSec = Number(sleepSec) || 0;
    if (!hasOpenSession || !(gapThresholdSec > 0)) {
        return { shouldClose: false, stopAtMs: null, gapSec };
    }
    if (gapSec <= gapThresholdSec) {
        return { shouldClose: false, stopAtMs: null, gapSec };
    }
    // Prefer the last real activity; fall back to the suspend instant. Never
    // fall back to now() — that would credit the entire sleep gap.
    const stopAtMs = lastActiveAtMs || suspendedAtMs || null;
    if (!stopAtMs) {
        return { shouldClose: false, stopAtMs: null, gapSec };
    }
    return { shouldClose: true, stopAtMs, gapSec };
}

/**
 * Pure gap-detection logic for unit tests.
 * @returns {{ shouldClose: boolean, stopAtMs: number|null, gapSec: number }}
 */
function evaluateStartupGap({
    lastActiveAtMs,
    nowMs,
    gapThresholdSec,
    hasOpenSession,
}) {
    if (!hasOpenSession || !lastActiveAtMs) {
        return { shouldClose: false, stopAtMs: null, gapSec: 0 };
    }
    const gapSec = Math.floor((nowMs - lastActiveAtMs) / 1000);
    if (gapSec > gapThresholdSec) {
        return { shouldClose: true, stopAtMs: lastActiveAtMs, gapSec };
    }
    return { shouldClose: false, stopAtMs: null, gapSec };
}

function formatTimeShortLocal(date) {
    const hours24 = date.getHours();
    const h = hours24 % 12 || 12;
    const m = date.getMinutes().toString().padStart(2, "0");
    const ampm = hours24 >= 12 ? "PM" : "AM";
    return `${h}:${m} ${ampm}`;
}

function showAutoStopNotification(title, body) {
    try {
        if (Notification.isSupported()) {
            const n = new Notification({ title, body, silent: false });
            n.show();
        }
    } catch (e) {
        console.warn("[power] Notification failed:", e.message);
    }
}

module.exports = {
    registerPowerHandlers,
    unregisterPowerHandlers,
    evaluateStartupGap,
    evaluateSleepGap,
    showAutoStopNotification,
    formatTimeShortLocal,
    DEFAULT_GAP_THRESHOLD_SEC,
};
