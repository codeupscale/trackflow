/**
 * "You came back and your timer was stopped" — the notification nobody was getting.
 *
 * Reported by the owner: employees returned from a break, saw nothing, and kept working
 * untracked. On a machine that never sleeps and never locks (charger + external display,
 * the normal office desktop) every existing path misses them — the auto-stop toast fires
 * while the desk is empty, `notifyTrackingState()` only runs on wake/unlock/startup, and
 * the idle alert was dismissed by the stop itself.
 *
 * See bugs/desktop-no-notification-on-return-from-break.md
 */

const fs = require('fs');
const path = require('path');
const {
    returnToWorkDecision,
    trackPeakIdle,
    buildReturnToWorkNotification,
    DEFAULT_AWAY_THRESHOLD_SEC,
} = require('../src/main/return-to-work');

const base = (over = {}) => ({
    isAuthenticated: true,
    isTracking: false,
    isIdleAlertActive: false,
    systemIdleSec: 0,
    peakIdleSec: 600,
    now: 1_000_000,
    lastNotifiedAt: 0,
    ...over,
});

describe('returnToWorkDecision', () => {
    test('announces when the user is back after a real absence and the timer is stopped', () => {
        expect(returnToWorkDecision(base()).notify).toBe(true);
    });

    test('says nothing while the desk is still empty — the point is to catch the RETURN', () => {
        const d = returnToWorkDecision(base({ systemIdleSec: 400 }));
        expect(d.notify).toBe(false);
        expect(d.reason).toBe('still-away');
    });

    test('says nothing when the timer is running', () => {
        expect(returnToWorkDecision(base({ isTracking: true })).reason).toBe('tracking');
    });

    test('says nothing for a short break — that is noise, not a lost session', () => {
        const d = returnToWorkDecision(base({ peakIdleSec: 30 }));
        expect(d.notify).toBe(false);
        expect(d.reason).toBe('not-away');
    });

    test('defers to a live idle alert rather than stacking a second prompt', () => {
        expect(returnToWorkDecision(base({ isIdleAlertActive: true })).reason).toBe('idle-alert-active');
    });

    test('never notifies a signed-out app', () => {
        expect(returnToWorkDecision(base({ isAuthenticated: false })).reason).toBe('signed-out');
    });

    test('announces once per absence, not once per poll', () => {
        const d = returnToWorkDecision(base({ lastNotifiedAt: 999_000 }));
        expect(d.notify).toBe(false);
        expect(d.reason).toBe('cooldown');
    });

    test('an unreadable idle counter stays silent instead of inventing an absence', () => {
        // Some Wayland sessions throw from getSystemIdleTime(); a NaN must not read as
        // "away for ages" and fire a spurious alert.
        expect(returnToWorkDecision(base({ systemIdleSec: NaN })).reason).toBe('no-idle-reading');
        expect(returnToWorkDecision(base({ peakIdleSec: NaN })).reason).toBe('no-idle-reading');
    });

    test('honours the org idle threshold passed in', () => {
        const opts = base({ peakIdleSec: 200 });
        expect(returnToWorkDecision({ ...opts, awayThresholdSec: 120 }).notify).toBe(true);
        expect(returnToWorkDecision({ ...opts, awayThresholdSec: 600 }).notify).toBe(false);
    });

    test('the default threshold is a real break, not a coffee refill', () => {
        expect(DEFAULT_AWAY_THRESHOLD_SEC).toBeGreaterThanOrEqual(60);
    });
});

describe('trackPeakIdle', () => {
    test('remembers the longest reading of the absence', () => {
        let peak = 0;
        [30, 120, 600].forEach((s) => { peak = trackPeakIdle(peak, s); });
        expect(peak).toBe(600);
    });

    test('a reset to 0 on the users first keystroke does not erase the absence', () => {
        // This is why peak is tracked at all: the poll that observes the return sees
        // systemIdleSec === 0, and a "last reading" model would forget they were ever away.
        let peak = trackPeakIdle(0, 900);
        peak = trackPeakIdle(peak, 0);
        expect(peak).toBe(900);
    });

    test('an unreadable sample leaves the peak untouched', () => {
        expect(trackPeakIdle(300, NaN)).toBe(300);
    });
});

describe('buildReturnToWorkNotification', () => {
    test('leads with the fact that matters', () => {
        const { title, body } = buildReturnToWorkNotification(1800);
        expect(title).toMatch(/NOT being tracked/);
        expect(body).toMatch(/30 min/);
        expect(body).toMatch(/start the timer/i);
    });

    test('reads hours and minutes for a long absence', () => {
        expect(buildReturnToWorkNotification(5400).body).toMatch(/1h 30m/);
    });

    test('never reports a 0-minute break', () => {
        expect(buildReturnToWorkNotification(20).body).toMatch(/1 min/);
    });
});

describe('wiring', () => {
    const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf8');
    const RENDERER = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index-renderer.js'), 'utf8');
    const PRELOAD = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'index.js'), 'utf8');
    const HTML = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');

    test('the watcher runs while the timer is STOPPED — the watchdog only covers running', () => {
        const tick = SRC.slice(SRC.indexOf('function _returnWatchTick()'), SRC.indexOf('function notifyReturnToWork'));
        expect(tick).toMatch(/if \(isTimerRunning\)/);
        expect(tick).toMatch(/returnToWorkDecision/);
    });

    test('it is started with the session and torn down on logout', () => {
        expect(SRC).toMatch(/startReturnWatch\(\);/);
        const teardown = SRC.slice(SRC.indexOf('function removeSessionListeners()'), SRC.indexOf('function removeSessionListeners()') + 900);
        expect(teardown).toMatch(/stopReturnWatch\(\)/);
    });

    test('all three cues fire: notification with sound, renderer beep, visible window', () => {
        const fn = SRC.slice(SRC.indexOf('function notifyReturnToWork'), SRC.indexOf('function startReturnWatch'));
        expect(fn).toMatch(/silent: false/);
        expect(fn).toMatch(/showPopup\(\)/);
        expect(fn).toMatch(/notifyPopup\("return-from-break"/);
    });

    test('the toast carries a unique id so Windows cannot dedup it away', () => {
        const fn = SRC.slice(SRC.indexOf('function notifyReturnToWork'), SRC.indexOf('function startReturnWatch'));
        expect(fn).toMatch(/id: `trackflow-return-\$\{Date\.now\(\)\}`/);
    });

    test('the channel is exposed through the contextBridge, not ipcRenderer directly', () => {
        expect(PRELOAD).toMatch(/onReturnFromBreak/);
        expect(RENDERER).toMatch(/window\.trackflow\.onReturnFromBreak/);
        expect(RENDERER).not.toMatch(/require\(['"]electron['"]\)/);
    });

    test('the renderer beeps and shows the banner', () => {
        expect(RENDERER).toMatch(/playReturnBeep/);
        expect(RENDERER).toMatch(/createOscillator/);
        expect(HTML).toMatch(/id="returnBanner"/);
    });

    test('the banner clears once tracking resumes', () => {
        const started = RENDERER.slice(RENDERER.indexOf('window.trackflow.onTimerStarted'), RENDERER.indexOf('window.trackflow.onTimerStarted') + 700);
        expect(started).toMatch(/hideReturnBanner\(\)/);
    });

    test('the beep uses WebAudio only — an external sound file would violate the CSP', () => {
        const beep = RENDERER.slice(RENDERER.indexOf('function playReturnBeep'), RENDERER.indexOf('function formatAwayLabel'));
        expect(beep).not.toMatch(/new Audio\(|\.mp3|\.wav/);
    });
});
