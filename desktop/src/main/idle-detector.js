// Idle Detection Service — State Machine Implementation
//
// States:
//   STOPPED    — detector is off (timer not running or explicitly stopped)
//   WATCHING   — timer running, monitoring system idle time
//   DETECTED   — idle threshold exceeded, waiting for alert to show
//   ALERTING   — popup is visible, counting idle time, checking auto-stop
//   SUSPENDED  — laptop is asleep / screen locked, intervals paused
//   RESOLVED   — action was taken, transitioning back to WATCHING
//
// Transitions:
//   STOPPED    → WATCHING   : start()
//   WATCHING   → DETECTED   : _check() finds idle >= threshold
//   DETECTED   → ALERTING   : after onIdleDetected callback fires
//   ALERTING   → RESOLVED   : user clicks action OR auto-stop fires
//   RESOLVED   → WATCHING   : after cooldown reset, resume monitoring
//   ANY        → SUSPENDED  : suspend()
//   SUSPENDED  → WATCHING   : resume() (caller decides whether to show alert)
//   ANY        → STOPPED    : stop()
//
// Invalid transitions are logged and ignored, preventing double-actions.

const { powerMonitor } = require("electron");

// Offline fallback only — the server value (Settings → Idle detection) wins.
const DEFAULT_IDLE_TIMEOUT_MIN = 10;
const DEFAULT_IDLE_CHECK_INTERVAL_SEC = 2;
/** Schedule a one-shot fire when within this many seconds of the threshold. */
const BOUNDARY_LEAD_SEC = 20;
// Idle auto-stop is DISABLED by product decision (2026-07-23): the idle alert
// must NEVER auto-dismiss — it stays visible until the user explicitly resolves
// it ("Continue Tracking" or "Stop Timer"). See _applyConfig() for why this is
// safe for billing without any auto-stop cap (the timer is server-paused the
// instant idle is detected, so an unanswered alert credits no additional time).
// The former MAX_AUTO_STOP_MIN clamp and DEFAULT_HARD_STOP_GRACE_SEC backstop
// were removed with that change.

const IDLE_STATE = Object.freeze({
    STOPPED: "STOPPED",
    WATCHING: "WATCHING",
    DETECTED: "DETECTED",
    ALERTING: "ALERTING",
    SUSPENDED: "SUSPENDED",
    RESOLVED: "RESOLVED",
});

class IdleDetector {
    constructor(config = {}) {
        this._state = IDLE_STATE.STOPPED;
        this._applyConfig(config);
        this.checkInterval = null;
        this.idleStartedAt = null;
        this.alertShownAt = null;

        // Cooldown: after idle is resolved, suppress re-detection until the user
        // has provided new input (system idle time drops below threshold).
        this._lastResolvedAt = null;

        // Monotonic action ID — incremented on each idle detection cycle.
        // Passed to callbacks so the caller can detect stale/duplicate actions.
        this._actionId = 0;

        // Callbacks — set by main process
        this._onIdleDetected = null; // (idleSeconds, idleStartedAt, actionId) => void
        this._onAutoStop = null; // (totalIdleSeconds, actionId) => void
        this._boundaryTimer = null;
    }

    // ── Public API ──────────────────────────────────────────────────────────────

    get state() {
        return this._state;
    }

    onIdleDetected(callback) {
        this._onIdleDetected = callback;
    }
    onAutoStop(callback) {
        this._onAutoStop = callback;
    }

    updateConfig(config) {
        const wasEnabled = this.enabled;
        const oldCheckIntervalMs = this.checkIntervalMs;
        this._applyConfig(config);

        if (this._state !== IDLE_STATE.STOPPED) {
            if (!this.enabled && wasEnabled) {
                this.stop();
            } else if (this._state === IDLE_STATE.ALERTING) {
                // ALERTING must ALWAYS keep a check interval running so the
                // absolute hard-stop cap fires even when interactive auto-stop is
                // disabled. Start one if missing; restart if the tick changed.
                if (!this.checkInterval) {
                    this.checkInterval = setInterval(
                        () => this._checkAutoStop(),
                        this.checkIntervalMs,
                    );
                } else if (this.checkIntervalMs !== oldCheckIntervalMs) {
                    clearInterval(this.checkInterval);
                    this.checkInterval = setInterval(
                        () => this._checkAutoStop(),
                        this.checkIntervalMs,
                    );
                }
            } else if (
                this.checkIntervalMs !== oldCheckIntervalMs &&
                this.checkInterval
            ) {
                clearInterval(this.checkInterval);
                this.checkInterval = setInterval(
                    () => this._check(),
                    this.checkIntervalMs,
                );
            }
        }
    }

    /**
     * Start monitoring. Only valid from STOPPED state.
     * Resets all internal state for a fresh monitoring session.
     */
    start() {
        if (!this.enabled) return;
        const previousState = this._state;

        // BUG B FIX: Never clobber an in-progress idle cycle. A spurious start()
        // from the timer sync loop / reconcile (e.g. a transient `status.running &&
        // !isTimerRunning` tick) used to reset idleStartedAt/alertShownAt to null and
        // clear the auto-stop interval while the alert was DETECTED or ALERTING. If
        // showIdleAlert() was mid-`await loadProjects()`, isIdleActive() then flipped
        // to false and its guard swallowed the popup → the alert "sometimes doesn't
        // appear". Treat start() as a no-op while an alert is live; the current cycle
        // resolves through resolveIdle()/auto-stop and re-arms itself afterward.
        if (
            previousState === IDLE_STATE.DETECTED ||
            previousState === IDLE_STATE.ALERTING
        ) {
            console.warn(
                `[IdleDetector] start() called in active state ${previousState} — ignoring to preserve live alert`,
            );
            return;
        }

        // Never clobber a sleep-preserved idle cycle — resume()/setAlertState() owns
        // the transition back out of SUSPENDED.
        if (previousState === IDLE_STATE.SUSPENDED) {
            console.warn(
                "[IdleDetector] start() called in SUSPENDED state — ignoring to preserve idle across sleep",
            );
            return;
        }

        // Allow start from STOPPED or RESOLVED (re-arm after action)
        if (
            previousState !== IDLE_STATE.STOPPED &&
            previousState !== IDLE_STATE.RESOLVED
        ) {
            console.warn(
                `[IdleDetector] start() called in state ${previousState} — stopping first`,
            );
            this._clearInterval();
        }

        this._state = IDLE_STATE.WATCHING;
        this.idleStartedAt = null;
        this.alertShownAt = null;

        // Only reset cooldown when starting from a fully stopped state (e.g., new
        // timer session). When re-arming after resolveIdle (RESOLVED state), preserve
        // the cooldown so _check() waits for fresh user input before re-detecting.
        // Without this, starting from RESOLVED with the system still idle causes
        // immediate re-detection (the user hasn't actually returned yet).
        if (previousState === IDLE_STATE.STOPPED) {
            this._lastResolvedAt = null;
        }

        this._clearInterval();
        this.checkInterval = setInterval(
            () => this._check(),
            this.checkIntervalMs,
        );
    }

    /**
     * Fully stop the detector. Clears all state and intervals.
     * Valid from any state.
     */
    stop() {
        this._clearInterval();
        this._state = IDLE_STATE.STOPPED;
        this.idleStartedAt = null;
        this.alertShownAt = null;
    }

    /**
     * Notify the detector that the system is suspending (sleep/lock).
     * Pauses the check interval but preserves idle state so handleResume
     * can inspect it.
     *
     * Returns a snapshot of the current idle state for the caller.
     */
    suspend() {
        const snapshot = {
            previousState: this._state,
            isIdle:
                this._state === IDLE_STATE.ALERTING ||
                this._state === IDLE_STATE.DETECTED,
            idleStartedAt: this.idleStartedAt,
        };

        // Clear interval to prevent _check() from firing on resume before
        // the main process has had a chance to run handleResume.
        this._clearInterval();
        this._state = IDLE_STATE.SUSPENDED;

        return snapshot;
    }

    /**
     * Notify the detector that the system has resumed.
     * Does NOT restart the check interval — the caller must call start()
     * or setAlertState() depending on whether they want to show an alert.
     */
    resume() {
        if (this._state !== IDLE_STATE.SUSPENDED) {
            console.warn(
                `[IdleDetector] resume() called in state ${this._state} — ignoring`,
            );
            return;
        }
        // Transition to STOPPED; caller will call start() or setAlertState()
        this._state = IDLE_STATE.STOPPED;
    }

    /**
     * Externally set the detector into ALERTING state with a specific
     * idleStartedAt time. Used by handleResume when sleep duration exceeds
     * threshold and the caller wants to show an alert.
     *
     * Also starts the check interval so auto-stop can fire.
     */
    setAlertState(idleStartedAt) {
        this._clearInterval();
        this._actionId++;
        this._state = IDLE_STATE.ALERTING;
        this.idleStartedAt = idleStartedAt;
        this.alertShownAt = Date.now();

        // ALWAYS run the check interval so BOTH the interactive auto-stop AND the
        // absolute hard-stop cap can fire while the (re-shown, post-sleep) alert is
        // up — even when interactive auto-stop is disabled.
        this.checkInterval = setInterval(
            () => this._checkAutoStop(),
            this.checkIntervalMs,
        );

        return this._actionId;
    }

    /**
     * Called when the user responds to the idle alert or auto-stop fires.
     * Transitions from ALERTING → RESOLVED.
     *
     * @param {number} actionId — must match the current _actionId to prevent
     *   stale actions from a previous idle cycle.
     * @returns {object|null} — idle info if action was valid, null if stale/invalid.
     */
    resolveIdle(actionId = null) {
        // Guard: only resolve from ALERTING state
        if (
            this._state !== IDLE_STATE.ALERTING &&
            this._state !== IDLE_STATE.DETECTED
        ) {
            console.warn(
                `[IdleDetector] resolveIdle() called in state ${this._state} — ignoring`,
            );
            return null;
        }

        // Guard: stale action ID (e.g., user clicked after auto-stop already fired)
        if (actionId !== null && actionId !== this._actionId) {
            console.warn(
                `[IdleDetector] resolveIdle() stale actionId ${actionId} (current: ${this._actionId}) — ignoring`,
            );
            return null;
        }

        const info = {
            idleStartedAt: this.idleStartedAt,
            idleDuration: this.getIdleDuration(),
        };

        this._clearInterval();
        this._state = IDLE_STATE.RESOLVED;
        this._lastResolvedAt = Date.now();
        this.idleStartedAt = null;
        this.alertShownAt = null;

        return info;
    }

    /**
     * Get current idle duration in seconds.
     */
    getIdleDuration() {
        if (!this.idleStartedAt) return 0;
        return Math.floor((Date.now() - this.idleStartedAt) / 1000);
    }

    /**
     * Whether the detector is currently in a state where an idle alert
     * is being shown or should be shown.
     */
    isShowingAlert() {
        return this._state === IDLE_STATE.ALERTING;
    }

    /**
     * Whether idle has been detected but not yet fully resolved.
     */
    isIdleActive() {
        return (
            this._state === IDLE_STATE.ALERTING ||
            this._state === IDLE_STATE.DETECTED
        );
    }

    /**
     * Get the current action ID. Used by the caller to pass to resolveIdle()
     * for stale-action detection.
     */
    getActionId() {
        return this._actionId;
    }

    // ── Private ─────────────────────────────────────────────────────────────────

    _applyConfig(config) {
        const rawTimeout =
            config.idle_timeout != null
                ? Number(config.idle_timeout)
                : DEFAULT_IDLE_TIMEOUT_MIN;
        let timeoutMin =
            Number.isFinite(rawTimeout) && rawTimeout >= 1
                ? rawTimeout
                : DEFAULT_IDLE_TIMEOUT_MIN;
        if (Number.isFinite(rawTimeout) && rawTimeout <= 0) {
            timeoutMin = 1;
        }
        timeoutMin = Math.min(30, Math.max(1, timeoutMin));
        this.idleTimeoutSec = timeoutMin * 60;
        // Idle auto-stop DISABLED (2026-07-23 product decision): the idle alert
        // NEVER auto-dismisses. It stays visible until the user explicitly picks
        // "Continue Tracking" or "Stop Timer". Both the interactive countdown
        // (idle_alert_auto_stop_min) and the former absolute hard-stop grace are
        // forced to 0 here; `_checkAutoStop()` treats 0 as "disabled" for each, so
        // ALERTING now terminates ONLY on an explicit user action (or the
        // sleep/suspend path). `idle_alert_auto_stop_min` is intentionally ignored.
        //
        // This is safe for billing WITHOUT any auto-stop cap because the timer is
        // server-paused the instant idle is DETECTED: pauseTimerForIdle() in the
        // main process calls POST /timer/pause back-dated to idleStartedAt and
        // halts heartbeats + screenshots. Server elapsed is frozen at idle-start
        // for the entire time the alert waits, so an unanswered alert credits NO
        // additional idle/tracked time — the old "12h phantom" hole is closed by
        // the pause, not by a forced auto-stop.
        this.alertAutoStopSec = 0;
        this.hardStopGraceSec = 0;
        const checkSec =
            config.idle_check_interval_sec != null
                ? config.idle_check_interval_sec
                : DEFAULT_IDLE_CHECK_INTERVAL_SEC;
        this.checkIntervalMs = Math.min(60, Math.max(1, checkSec)) * 1000;
        this.enabled = config.idle_detection !== false;
    }

    _clearInterval() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        if (this._boundaryTimer) {
            clearTimeout(this._boundaryTimer);
            this._boundaryTimer = null;
        }
    }

    _scheduleBoundaryFire(remainingSec) {
        if (this._boundaryTimer) return;
        const ms = Math.max(50, Math.floor(remainingSec * 1000));
        this._boundaryTimer = setTimeout(() => {
            this._boundaryTimer = null;
            this._check();
        }, ms);
    }

    /**
     * Main check loop — only runs in WATCHING state.
     * Detects when the user crosses the idle threshold.
     */
    _check() {
        // Only detect idle while in WATCHING state
        if (this._state !== IDLE_STATE.WATCHING) return;

        let systemIdleSec;
        try {
            systemIdleSec = powerMonitor.getSystemIdleTime();
        } catch (err) {
            console.error(
                "[IdleDetector] getSystemIdleTime() threw:",
                err.message,
            );
            return;
        }

        // Log idle time periodically (every ~60s) to help diagnose detection issues
        if (!this._lastLoggedAt || Date.now() - this._lastLoggedAt > 60000) {
            console.log(
                `[IdleDetector] _check: systemIdleSec=${systemIdleSec}, threshold=${this.idleTimeoutSec}s, enabled=${this.enabled}`,
            );
            this._lastLoggedAt = Date.now();
        }

        // Cooldown: after resolution, wait for fresh user input AND a minimum
        // cooldown period (60s) before re-detecting. This prevents the alert from
        // immediately reappearing when the user clicks an action while still idle.
        if (this._lastResolvedAt) {
            const cooldownElapsed = Date.now() - this._lastResolvedAt;
            const MIN_COOLDOWN_MS = 60000; // 60 seconds minimum after user action
            if (
                systemIdleSec < this.idleTimeoutSec &&
                cooldownElapsed >= MIN_COOLDOWN_MS
            ) {
                this._lastResolvedAt = null; // Fresh input + cooldown elapsed — resume detection
            } else {
                return; // Still in cooldown or still idle from before resolution
            }
        }

        if (systemIdleSec >= this.idleTimeoutSec) {
            this._clearBoundaryOnly();
            // Idle threshold crossed — transition to DETECTED
            this._state = IDLE_STATE.DETECTED;
            this._actionId++;
            this.idleStartedAt = Date.now() - systemIdleSec * 1000;
            this.alertShownAt = Date.now();

            // Stop the WATCHING interval — we will start a different interval
            // (auto-stop check) once the alert is confirmed shown
            this._clearInterval();

            if (this._onIdleDetected) {
                // NEVER let a caller exception escape. The lines below re-arm the
                // detector; skipping them leaves it stranded in DETECTED with no
                // interval, which means idle is never detected again for the rest of
                // the session AND every isIdleActive() consumer (the idle hard-stop
                // watchdog, the popup lock) believes an alert is on screen forever.
                // That is precisely how one bad call site cost every OS its idle
                // window — see bugs/desktop-idle-alert-never-appears.md.
                try {
                    this._onIdleDetected(
                        systemIdleSec,
                        this.idleStartedAt,
                        this._actionId,
                    );
                } catch (err) {
                    console.error(
                        "[IdleDetector] onIdleDetected callback threw:",
                        err && err.message,
                    );
                }
            }

            // Transition to ALERTING after callback (caller should show alert).
            // The check interval still runs, but with auto-stop disabled
            // (alertAutoStopSec === 0 and hardStopGraceSec === 0) `_checkAutoStop`
            // never fires — the alert stays visible until the user resolves it.
            // The interval is kept so the ALERTING invariant (checkInterval != null)
            // and its state-cleanup path on resolve/suspend are unchanged.
            //
            // ONLY when the callback left us in DETECTED. The `keep_idle_time`
            // policies that never open a window ('always' resolves + re-starts,
            // 'never' discards) move the detector on themselves; forcing ALERTING
            // over the top of that stomped their fresh WATCHING state and orphaned
            // the interval start() had just armed — idle silently stopped working
            // for those orgs too.
            if (this._state === IDLE_STATE.DETECTED) {
                this._state = IDLE_STATE.ALERTING;
                this._clearInterval();
                this.checkInterval = setInterval(
                    () => this._checkAutoStop(),
                    this.checkIntervalMs,
                );
            }
        } else if (
            systemIdleSec >= this.idleTimeoutSec - BOUNDARY_LEAD_SEC &&
            systemIdleSec < this.idleTimeoutSec
        ) {
            this._scheduleBoundaryFire(this.idleTimeoutSec - systemIdleSec);
        }
    }

    _clearBoundaryOnly() {
        if (this._boundaryTimer) {
            clearTimeout(this._boundaryTimer);
            this._boundaryTimer = null;
        }
    }

    /**
     * Auto-stop check — only runs in ALERTING state.
     * Fires the auto-stop callback when the alert has been shown for longer
     * than alertAutoStopSec. Uses alertShownAt (not idleStartedAt) so that
     * long sleeps don't cause immediate auto-stop before the user sees the popup.
     *
     * Previously this compared total idle time (Date.now() - idleStartedAt)
     * against idleTimeoutSec + alertAutoStopSec, which caused a bug: after a
     * long sleep (> idle + autoStop threshold), the first _checkAutoStop tick
     * would fire auto-stop immediately — before showIdleAlert() had finished
     * creating the BrowserWindow. The user's timer was stopped without them
     * ever seeing the idle alert.
     */
    _checkAutoStop() {
        if (this._state !== IDLE_STATE.ALERTING) {
            this._clearInterval();
            return;
        }

        if (!this.alertShownAt) {
            this._clearInterval();
            return;
        }

        const alertDurationSec = (Date.now() - this.alertShownAt) / 1000;
        const totalIdleSec = this.idleStartedAt
            ? Math.floor((Date.now() - this.idleStartedAt) / 1000)
            : Math.floor(alertDurationSec);

        // Interactive auto-stop: fires alertAutoStopSec after the alert appeared
        // (measured from alertShownAt, NOT idleStartedAt — a long sleep must not
        // auto-stop before the user has a chance to see the re-shown popup).
        const interactiveFire =
            this.alertAutoStopSec > 0 &&
            alertDurationSec >= this.alertAutoStopSec;

        // Absolute hard-stop cap: DISABLED (hardStopGraceSec forced to 0 in
        // _applyConfig, 2026-07-23). Guarded with > 0 so a 0 value means "disabled"
        // rather than "fire immediately" (alertDurationSec >= 0 is always true).
        // With both mechanisms off the alert never auto-dismisses; it is safe
        // because the timer is server-paused at idle-detection, so no time accrues
        // while it waits.
        const hardCapFire =
            this.hardStopGraceSec > 0 &&
            alertDurationSec >= this.hardStopGraceSec;

        if (interactiveFire || hardCapFire) {
            const totalIdleDuration = totalIdleSec;
            const actionId = this._actionId;
            // Fire auto-stop BEFORE resolving, so the callback can read idleStartedAt
            if (this._onAutoStop) {
                this._onAutoStop(totalIdleDuration, actionId);
            }
            // Auto-resolve (the callback should also call resolveIdle, but
            // we do it here defensively in case the callback doesn't)
            if (this._state === IDLE_STATE.ALERTING) {
                this.resolveIdle(actionId);
            }
        }
    }
}

// Export both the class and the state enum
module.exports = IdleDetector;
module.exports.IDLE_STATE = IDLE_STATE;
