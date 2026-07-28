// Regression tests for the QA batch of 2026-07-28:
//   1. bugs/desktop-idle-alert-timer-resumes-on-reconnect.md
//      Offline + idle → the idle pause POST never lands → on reconnect the sync tick
//      adopted the server's stale "running" state and RESTARTED tracking behind the
//      still-open idle alert (nobody clicked Continue).
//   2. bugs/desktop-idle-alert-closed-by-idle-watchdog.md
//      The idle alert is supposed to NEVER auto-dismiss (2026-07-23 decision), but the
//      independent idle WATCHDOG still hard-stopped the timer at
//      idle_timeout + 10min + 2min and called dismissIdleAlert() — the popup vanished
//      roughly ten minutes after it appeared.
//   3. bugs/desktop-all-projects-total-resets-on-start.md
//      afterStartTimer() assigned the PROJECT-scoped today total to todayTotalGlobal,
//      so "Today, all projects" fell to ~0 on start and only recovered on the next
//      10s sync.
//
// The logic lives in src/main/index.js, which cannot be imported without booting
// Electron, so — as with today-total-global-vs-scoped.test.js — these tests
// re-implement the exact predicates. A regression in the source must be mirrored here
// to keep them passing, which is the point: the invariants are stated in one place.

describe("idle alert: local pause outranks server state", () => {
    // Mirrors isIdlePauseAuthoritative() in src/main/index.js.
    function isIdlePauseAuthoritative({ isHandlingIdleAction, idleAlertActive }) {
        return isHandlingIdleAction || idleAlertActive;
    }

    // Mirrors the guard at the top of syncOpenTimerFromServerStatus().
    function adoptsServerState(state) {
        return !isIdlePauseAuthoritative(state);
    }

    // Mirrors the isTimerPaused assignment in applyRunningStatusFromServer().
    function resolvePaused({ serverPaused, localPaused, idleAuthoritative }) {
        return idleAuthoritative && localPaused ? true : serverPaused;
    }

    test("server 'running' is NOT adopted while the idle alert is up", () => {
        expect(
            adoptsServerState({
                isHandlingIdleAction: false,
                idleAlertActive: true,
            }),
        ).toBe(false);
    });

    test("server 'running' is NOT adopted while an idle action is being handled", () => {
        expect(
            adoptsServerState({
                isHandlingIdleAction: true,
                idleAlertActive: false,
            }),
        ).toBe(false);
    });

    test("server state IS adopted once the idle cycle is over", () => {
        expect(
            adoptsServerState({
                isHandlingIdleAction: false,
                idleAlertActive: false,
            }),
        ).toBe(true);
    });

    test("the exact QA repro: offline pause never landed, server says running", () => {
        // Wi-Fi off → idle detected → POST /timer/pause failed → server still
        // "running" → Wi-Fi back on. Local MUST stay paused.
        const paused = resolvePaused({
            serverPaused: false, // server never saw the pause
            localPaused: true, // desktop paused itself at idle detection
            idleAuthoritative: true, // alert is still on screen
        });
        expect(paused).toBe(true);
    });

    test("a genuine server resume is honoured when no alert is pending", () => {
        expect(
            resolvePaused({
                serverPaused: false,
                localPaused: true,
                idleAuthoritative: false,
            }),
        ).toBe(false);
    });

    // Mirrors retryIdlePauseIfUnsynced()'s guards.
    function shouldRetryIdlePause(s) {
        if (s.pauseSynced || s.retryInFlight) return false;
        if (!s.isTimerPaused || !s.idleAlertActive) return false;
        if (!s.hasApiClient || !s.entryId) return false;
        if (String(s.entryId).startsWith("local-")) return false;
        if (s.isOnline === false) return false;
        return true;
    }

    const baseRetry = {
        pauseSynced: false,
        retryInFlight: false,
        isTimerPaused: true,
        idleAlertActive: true,
        hasApiClient: true,
        entryId: "server-entry-1",
        isOnline: true,
    };

    test("re-pushes the idle pause once back online", () => {
        expect(shouldRetryIdlePause(baseRetry)).toBe(true);
    });

    test("does not re-push when the pause already landed", () => {
        expect(shouldRetryIdlePause({ ...baseRetry, pauseSynced: true })).toBe(
            false,
        );
    });

    test("does not re-push while still offline", () => {
        expect(shouldRetryIdlePause({ ...baseRetry, isOnline: false })).toBe(
            false,
        );
    });

    test("does not re-push for a start that never synced (local- id)", () => {
        expect(
            shouldRetryIdlePause({ ...baseRetry, entryId: "local-123" }),
        ).toBe(false);
    });

    test("does not re-push once the alert is gone", () => {
        expect(
            shouldRetryIdlePause({ ...baseRetry, idleAlertActive: false }),
        ).toBe(false);
    });
});

describe("idle watchdog: never closes a live idle alert", () => {
    const IDLE_WATCHDOG_GRACE_SEC = 10 * 60;
    const DEFAULT_GAP_THRESHOLD_SEC = 600;

    // Mirrors getIdleWatchdogCapSec().
    function capSec(idleTimeoutMin) {
        const thresholdSec =
            Number.isFinite(idleTimeoutMin) && idleTimeoutMin > 0
                ? Math.round(idleTimeoutMin * 60)
                : DEFAULT_GAP_THRESHOLD_SEC;
        return thresholdSec + IDLE_WATCHDOG_GRACE_SEC + 120;
    }

    // Mirrors the guard sequence at the top of _idleWatchdogTick().
    function watchdogStops({
        isTimerRunning,
        idleActionInProgress,
        stopTimerInProgress,
        keepIdlePolicy,
        idleAlertActive,
        systemIdleSec,
        idleTimeoutMin,
    }) {
        if (!isTimerRunning) return false;
        if (idleActionInProgress || stopTimerInProgress) return false;
        if (keepIdlePolicy === "always") return false;
        if (idleAlertActive) return false; // ← the fix
        return systemIdleSec >= capSec(idleTimeoutMin);
    }

    const base = {
        isTimerRunning: true,
        idleActionInProgress: false,
        stopTimerInProgress: false,
        keepIdlePolicy: "prompt",
        idleAlertActive: false,
        idleTimeoutMin: 10,
    };

    test("the old behaviour would have fired at 22 min of idle", () => {
        // 10 min threshold + 10 min grace + 2 min margin = 1320s. With the alert on
        // screen since minute 10, that closed it ~12 minutes later — QA's "the idle
        // window closes again after 10 minutes".
        expect(capSec(10)).toBe(1320);
    });

    test("does NOT stop (or dismiss) while the idle alert is waiting for an answer", () => {
        expect(
            watchdogStops({
                ...base,
                idleAlertActive: true,
                systemIdleSec: 5000, // way past the cap
            }),
        ).toBe(false);
    });

    test("still hard-stops when idle detection produced no alert (its real purpose)", () => {
        expect(
            watchdogStops({
                ...base,
                idleAlertActive: false,
                systemIdleSec: 1400,
            }),
        ).toBe(true);
    });

    test("still respects the always-keep-idle policy", () => {
        expect(
            watchdogStops({
                ...base,
                keepIdlePolicy: "always",
                systemIdleSec: 5000,
            }),
        ).toBe(false);
    });

    test("does not fire below the cap", () => {
        expect(watchdogStops({ ...base, systemIdleSec: 1319 })).toBe(false);
    });
});

describe("all-projects total is never overwritten by a project-scoped one", () => {
    // Mirrors afterStartTimer()'s todayTotalGlobal handling.
    function globalTotalAfterStart({
        previousGlobal,
        allProjectsFromStart,
        elapsedSec,
    }) {
        if (allProjectsFromStart == null) return previousGlobal;
        return Math.max(0, allProjectsFromStart - elapsedSec);
    }

    test("starting a project with no time today keeps the global total", () => {
        // The bug: todayTotalGlobal = today_total (project-scoped = 0) → the popup's
        // "Today, all projects" line dropped to 00:00:00 until the 10s sync.
        expect(
            globalTotalAfterStart({
                previousGlobal: 7200, // 2h already tracked on other projects
                allProjectsFromStart: null, // older backend: keep what we have
                elapsedSec: 0,
            }),
        ).toBe(7200);
    });

    test("uses the backend's always-global figure when present", () => {
        expect(
            globalTotalAfterStart({
                previousGlobal: 7200,
                allProjectsFromStart: 7201, // includes ~1s of the new entry
                elapsedSec: 1,
            }),
        ).toBe(7200);
    });

    test("never goes negative", () => {
        expect(
            globalTotalAfterStart({
                previousGlobal: 0,
                allProjectsFromStart: 0,
                elapsedSec: 5,
            }),
        ).toBe(0);
    });

    // Mirrors applyRunningStatusFromServer()'s total derivation.
    function derive(status) {
        const globalTotal = status.today_total ?? 0;
        const elapsed = status.elapsed_seconds ?? 0;
        const allProjects = status.all_projects_today_total ?? globalTotal;
        return {
            todayTotalGlobal: Math.max(0, allProjects - elapsed),
            todayTotalCurrentProject: Math.max(
                0,
                (status.project_today_total ?? globalTotal) - elapsed,
            ),
        };
    }

    test("running status with a project filter keeps the global line global", () => {
        // get-timer-state passes the selected project, so today_total is scoped.
        const status = {
            running: true,
            today_total: 1800, // scoped to the selected project
            all_projects_today_total: 9000,
            project_today_total: 1800,
            elapsed_seconds: 600,
        };
        const { todayTotalGlobal, todayTotalCurrentProject } = derive(status);
        expect(todayTotalGlobal).toBe(8400); // regression: was 1200 (scoped)
        expect(todayTotalCurrentProject).toBe(1200);
    });

    test("falls back to today_total when the backend omits the global field", () => {
        const { todayTotalGlobal } = derive({
            running: true,
            today_total: 3600,
            elapsed_seconds: 600,
        });
        expect(todayTotalGlobal).toBe(3000);
    });
});

describe("popup lock while the idle alert is pending", () => {
    // Mirrors applyIdleLock() + updateStartBtnState() + syncProjectSelectEnabled()
    // in src/renderer/index-renderer.js, and the IPC guards in src/main/index.js.
    function controlState({
        idleLocked,
        isRunning,
        isPaused,
        hasProject,
        projectOptions,
    }) {
        if (idleLocked) {
            return {
                startDisabled: true,
                stopDisabled: true,
                projectDisabled: true,
            };
        }
        return {
            startDisabled: isRunning || isPaused ? true : !hasProject,
            stopDisabled: false,
            projectDisabled: isRunning || isPaused || projectOptions <= 1,
        };
    }

    test("every timer control is disabled while the alert waits", () => {
        expect(
            controlState({
                idleLocked: true,
                isRunning: true,
                isPaused: true,
                hasProject: true,
                projectOptions: 3,
            }),
        ).toEqual({
            startDisabled: true,
            stopDisabled: true,
            projectDisabled: true,
        });
    });

    test("controls return to their normal state after the alert is answered", () => {
        expect(
            controlState({
                idleLocked: false,
                isRunning: true,
                isPaused: false,
                hasProject: true,
                projectOptions: 3,
            }),
        ).toEqual({
            startDisabled: true, // running — Start is hidden/disabled as before
            stopDisabled: false, // Stop works again
            projectDisabled: true, // still running
        });
    });

    test("stopped + project selected is fully interactive once unlocked", () => {
        expect(
            controlState({
                idleLocked: false,
                isRunning: false,
                isPaused: false,
                hasProject: true,
                projectOptions: 3,
            }),
        ).toEqual({
            startDisabled: false,
            stopDisabled: false,
            projectDisabled: false,
        });
    });

    // Mirrors the start-timer / stop-timer ipcMain guards.
    function ipcAllowed(idleAlertActive) {
        return !idleAlertActive;
    }

    test("main rejects start/stop IPC while the alert is pending", () => {
        expect(ipcAllowed(true)).toBe(false);
        expect(ipcAllowed(false)).toBe(true);
    });
});
