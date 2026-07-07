// Bug B — preserve the idle decision across lock/sleep.
//
// Before the fix, sleeping/locking while the idle alert was showing destroyed the
// window AND hard auto-stopped the timer. Because idle had already server-paused
// the entry at idleStartedAt and the stop path never resumed it, the whole paused
// [idleStartedAt..stop] interval was silently discarded — the user never got the
// Keep/Discard/Reassign choice.
//
// These tests wire the REAL IdleDetector into the REAL PowerManager via callbacks
// that replicate index.js's onSuspendCleanup / onResumeAfterSleep /
// shouldAutoStopOnSuspend exactly, and assert the preserve-across-sleep behavior —
// while proving the normal non-idle lid-close still hard-stops (no regression).

const { powerMonitor } = require('electron');
const IdleDetector = require('../src/main/idle-detector');
const { IDLE_STATE } = require('../src/main/idle-detector');
const PowerManager = require('../src/main/power-manager');

function getHandler(event) {
  const call = powerMonitor.on.mock.calls.find((c) => c[0] === event);
  return call ? call[1] : null;
}

function makeIdleWindow() {
  let destroyed = false;
  let visible = true;
  return {
    _shown: true,
    _actionId: null,
    _dismissedProgrammatically: false,
    show: jest.fn(function () { visible = true; this._shown = true; }),
    hide: jest.fn(function () { visible = false; this._shown = false; }),
    focus: jest.fn(),
    moveTop: jest.fn(),
    flashFrame: jest.fn(),
    setVisibleOnAllWorkspaces: jest.fn(),
    destroy: jest.fn(function () { destroyed = true; }),
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    webContents: { send: jest.fn() },
  };
}

// A harness that mirrors the relevant index.js state + the exact callback bodies
// registered with PowerManager.registerPowerHandlers().
function buildHarness(detector) {
  const state = {
    detector,
    isTimerRunning: true,
    isTimerPaused: true, // idle already server-paused the entry
    idleAlertWindow: null,
    idleSuspendState: null,
    autoStop: jest.fn().mockResolvedValue(undefined),
    lastReshow: null,
  };

  const isIdleAlertActive = () => {
    const detectorIdle = state.detector.isIdleActive();
    const windowLive = state.idleAlertWindow && !state.idleAlertWindow.isDestroyed();
    return !!(detectorIdle || windowLive);
  };

  const hideIdleAlertWindows = () => {
    const w = state.idleAlertWindow;
    if (w && !w.isDestroyed()) {
      w.hide();
      w._shown = false;
    }
  };

  const dismissIdleAlert = () => {
    state.idleSuspendState = null;
    const w = state.idleAlertWindow;
    if (w && !w.isDestroyed()) {
      w._dismissedProgrammatically = true;
      w.destroy();
    }
    state.idleAlertWindow = null;
  };

  const reshowIdleAlertAfterResume = (idleSeconds, idleStartedAt, actionId) => {
    const w = state.idleAlertWindow;
    if (w && !w.isDestroyed()) {
      w._actionId = actionId;
      w.show();
      w.webContents.send('idle-data', {
        idleStartedAt,
        idleSeconds,
        actionId,
        playSound: true,
      });
    }
    state.lastReshow = { idleSeconds, idleStartedAt, actionId };
  };

  PowerManager.registerPowerHandlers({
    isTimerRunning: () => state.isTimerRunning,
    autoStopForPowerEvent: state.autoStop,
    shouldAutoStopOnSuspend: () => !isIdleAlertActive(),
    onSuspendCleanup: () => {
      if (isIdleAlertActive()) {
        if (!state.idleSuspendState) {
          const snap = state.detector.suspend();
          state.idleSuspendState = {
            isIdle: true,
            idleStartedAt:
              (snap && snap.idleStartedAt) || state.detector.idleStartedAt || null,
          };
        }
        hideIdleAlertWindows();
      } else {
        state.detector.stop();
        dismissIdleAlert();
      }
    },
    onResumeAfterSleep: () => {
      const preserved = state.idleSuspendState;
      state.idleSuspendState = null;
      if (preserved && preserved.isIdle && preserved.idleStartedAt) {
        if (state.isTimerRunning) {
          state.detector.resume();
          const newActionId = state.detector.setAlertState(preserved.idleStartedAt);
          const idleSeconds = Math.max(
            0,
            Math.floor((Date.now() - preserved.idleStartedAt) / 1000),
          );
          reshowIdleAlertAfterResume(idleSeconds, preserved.idleStartedAt, newActionId);
        } else {
          state.detector.stop();
          dismissIdleAlert();
        }
      }
    },
  });

  return { state, isIdleAlertActive };
}

// Drive a real detector to ALERTING with a known idleStartedAt.
function driveToAlerting(detector) {
  detector.start();
  powerMonitor.getSystemIdleTime.mockReturnValue(300); // 5 min idle
  jest.advanceTimersByTime(10000);
}

describe('Bug B — idle preserved across lock/sleep', () => {
  let detector;

  beforeEach(() => {
    jest.useFakeTimers();
    powerMonitor.on.mockClear();
    powerMonitor.getSystemIdleTime.mockReturnValue(0);
    detector = new IdleDetector({
      idle_timeout: 5,
      idle_alert_auto_stop_min: 10,
      idle_check_interval_sec: 10,
    });
  });

  afterEach(() => {
    detector.stop();
    PowerManager.unregisterPowerHandlers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('suspend while idle-active does NOT stop the timer and does NOT null idleStartedAt', async () => {
    driveToAlerting(detector);
    expect(detector.state).toBe(IDLE_STATE.ALERTING);
    const originalIdleStart = detector.idleStartedAt;
    expect(originalIdleStart).not.toBeNull();

    const { state } = buildHarness(detector);
    state.idleAlertWindow = makeIdleWindow();

    await getHandler('suspend')();

    // Timer NOT hard-stopped
    expect(state.autoStop).not.toHaveBeenCalled();
    // Detector parked in SUSPENDED with idleStartedAt preserved
    expect(detector.state).toBe(IDLE_STATE.SUSPENDED);
    expect(detector.idleStartedAt).toBe(originalIdleStart);
    // Window hidden, NOT destroyed
    expect(state.idleAlertWindow.hide).toHaveBeenCalledTimes(1);
    expect(state.idleAlertWindow.isDestroyed()).toBe(false);
    // Snapshot captured
    expect(state.idleSuspendState).toMatchObject({
      isIdle: true,
      idleStartedAt: originalIdleStart,
    });
    // Timer stays paused (so reconcile self-heal stays suppressed)
    expect(state.isTimerPaused).toBe(true);
  });

  test('resume re-enters ALERTING with the SAME idleStartedAt and idle duration spans the sleep gap', async () => {
    driveToAlerting(detector);
    const originalIdleStart = detector.idleStartedAt;

    const { state } = buildHarness(detector);
    state.idleAlertWindow = makeIdleWindow();

    await getHandler('suspend')();
    expect(detector.state).toBe(IDLE_STATE.SUSPENDED);

    // Sleep for 10 minutes (fake clock advances Date.now under modern timers).
    jest.advanceTimersByTime(600000);

    getHandler('resume')();

    // Back in ALERTING, same anchor
    expect(detector.state).toBe(IDLE_STATE.ALERTING);
    expect(detector.idleStartedAt).toBe(originalIdleStart);

    // Idle duration now spans idle(5m) + sleep(10m) = 15m = 900s
    expect(detector.getIdleDuration()).toBe(900);
    expect(state.lastReshow.idleSeconds).toBe(900);

    // Window re-shown, timer never stopped, still paused
    expect(state.idleAlertWindow.show).toHaveBeenCalled();
    expect(state.idleAlertWindow.isDestroyed()).toBe(false);
    expect(state.autoStop).not.toHaveBeenCalled();
    expect(state.isTimerPaused).toBe(true);

    // Re-show broadcasts fresh idle-data with playSound (renderer re-beeps).
    const sent = state.idleAlertWindow.webContents.send.mock.calls.find(
      (c) => c[0] === 'idle-data',
    );
    expect(sent[1].playSound).toBe(true);
    expect(sent[1].idleSeconds).toBe(900);
  });

  test('alertShownAt resets to wake time on resume (no instant auto-stop on wake)', async () => {
    driveToAlerting(detector);
    const { state } = buildHarness(detector);
    state.idleAlertWindow = makeIdleWindow();

    await getHandler('suspend')();
    jest.advanceTimersByTime(600000); // 10 min sleep (>= auto-stop threshold)
    getHandler('resume')();

    // Auto-stop grace is 10 min; alertShownAt was reset to wake time, so nothing
    // fires immediately after wake.
    jest.advanceTimersByTime(10000);
    expect(state.autoStop).not.toHaveBeenCalled();
    expect(detector.state).toBe(IDLE_STATE.ALERTING);
  });
});

describe('Bug B — regressions protected', () => {
  let detector;

  beforeEach(() => {
    jest.useFakeTimers();
    powerMonitor.on.mockClear();
    powerMonitor.getSystemIdleTime.mockReturnValue(0);
    detector = new IdleDetector({
      idle_timeout: 5,
      idle_alert_auto_stop_min: 10,
      idle_check_interval_sec: 10,
    });
  });

  afterEach(() => {
    detector.stop();
    PowerManager.unregisterPowerHandlers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('NON-idle lid-close still hard auto-stops (no idle alert active)', async () => {
    // Detector merely WATCHING, no alert window.
    detector.start();
    const { state } = buildHarness(detector);
    expect(state.idleAlertWindow).toBeNull();

    await getHandler('suspend')();

    // Normal policy preserved: timer hard-stopped, detector torn down.
    expect(state.autoStop).toHaveBeenCalledTimes(1);
    expect(detector.state).toBe(IDLE_STATE.STOPPED);
    expect(state.idleSuspendState).toBeNull();
  });

  test('paired lock-screen + suspend is idempotent: one snapshot, no stop, idleStartedAt intact', async () => {
    driveToAlerting(detector);
    const originalIdleStart = detector.idleStartedAt;

    const { state } = buildHarness(detector);
    state.idleAlertWindow = makeIdleWindow();

    // A single lid-close emits both events back-to-back.
    await getHandler('lock-screen')();
    await getHandler('suspend')();

    // Never hard-stopped; snapshot captured once with the ORIGINAL anchor (the
    // second event finds the detector already SUSPENDED and must not clobber it).
    expect(state.autoStop).not.toHaveBeenCalled();
    expect(detector.state).toBe(IDLE_STATE.SUSPENDED);
    expect(detector.idleStartedAt).toBe(originalIdleStart);
    expect(state.idleSuspendState).toMatchObject({
      isIdle: true,
      idleStartedAt: originalIdleStart,
    });
    // Both events hide the (same) window; it is never destroyed.
    expect(state.idleAlertWindow.isDestroyed()).toBe(false);

    // And a subsequent resume still restores the full duration.
    jest.advanceTimersByTime(600000);
    getHandler('resume')();
    expect(detector.state).toBe(IDLE_STATE.ALERTING);
    expect(detector.getIdleDuration()).toBe(900);
  });

  test("'never'/'always' policies (no alert window) fall through to the hard-stop path", async () => {
    // These policies never open an idle window and the detector is not ALERTING,
    // so isIdleAlertActive() is false → normal hard auto-stop, untouched by Bug B.
    detector.start(); // WATCHING, no window
    const { state, isIdleAlertActive } = buildHarness(detector);
    expect(isIdleAlertActive()).toBe(false);

    await getHandler('suspend')();
    expect(state.autoStop).toHaveBeenCalledTimes(1);
  });
});
