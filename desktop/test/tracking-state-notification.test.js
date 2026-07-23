// "Always know your tracking state" notifications — content + dedup logic.
//
// Covers the pure pieces that index.js's notifyTrackingState() delegates to:
//   - buildTrackingStateNotification(): title/body wording per state.
//   - shouldNotifyTrackingState(): logout gate, paired-event coalescing, genuine
//     state-change pass-through, auto-stop suppression, idle-alert suppression.

const {
  buildTrackingStateNotification,
  formatDurationShort,
  shouldNotifyTrackingState,
} = require('../src/main/system-notifications');

describe('formatDurationShort', () => {
  test('formats "Xh Ym" above an hour', () => {
    expect(formatDurationShort(3 * 3600 + 25 * 60)).toBe('3h 25m');
  });
  test('formats "Ym" under an hour', () => {
    expect(formatDurationShort(25 * 60)).toBe('25m');
  });
  test('handles zero / garbage safely', () => {
    expect(formatDurationShort(0)).toBe('0m');
    expect(formatDurationShort(-5)).toBe('0m');
    expect(formatDurationShort(undefined)).toBe('0m');
  });
});

describe('buildTrackingStateNotification (content selection)', () => {
  test('tracking active → running + today total + "being tracked"', () => {
    const { title, body } = buildTrackingStateNotification({
      isTracking: true,
      todayTotalSeconds: 2 * 3600 + 5 * 60,
    });
    expect(title).toBe('TrackFlow — Tracking active');
    expect(body).toContain('running');
    expect(body).toContain('2h 5m');
    expect(body).toMatch(/being tracked/i);
  });

  test('not tracking → stopped + "NOT being tracked"', () => {
    const { title, body } = buildTrackingStateNotification({ isTracking: false });
    expect(title).toBe('TrackFlow — Not tracking');
    expect(body).toMatch(/not being tracked/i);
    expect(body).toMatch(/start the timer/i);
  });
});

describe('shouldNotifyTrackingState (dedup / coalescing)', () => {
  const base = {
    isAuthenticated: true,
    isTracking: true,
    isIdleAlertActive: false,
    now: 100000,
    lastStateNotifAt: 0,
    lastNotifiedTracking: null,
    lastAutoStopNotifAt: 0,
    debounceMs: 5000,
    autoStopSuppressMs: 8000,
  };

  test('NEVER fires when unauthenticated (respects logout)', () => {
    expect(shouldNotifyTrackingState({ ...base, isAuthenticated: false })).toBe(false);
  });

  test('fires on a fresh transition', () => {
    expect(shouldNotifyTrackingState(base)).toBe(true);
  });

  test('coalesces the paired resume+unlock into ONE notif (same state, within window)', () => {
    // First (resume) fired at t=100000, tracking=true.
    const afterFirst = {
      ...base,
      lastStateNotifAt: 100000,
      lastNotifiedTracking: true,
      now: 100000 + 800, // unlock arrives 0.8s later
    };
    expect(shouldNotifyTrackingState(afterFirst)).toBe(false);
  });

  test('a GENUINE state change is allowed through even within the debounce window', () => {
    // Was "not tracking"; now tracking changed to true 1s later (real change).
    const changed = {
      ...base,
      isTracking: true,
      lastNotifiedTracking: false,
      lastStateNotifAt: 100000,
      now: 100000 + 1000,
    };
    expect(shouldNotifyTrackingState(changed)).toBe(true);
  });

  test('same state fires again once the debounce window has passed', () => {
    const later = {
      ...base,
      lastNotifiedTracking: true,
      lastStateNotifAt: 100000,
      now: 100000 + 6000, // > 5s
    };
    expect(shouldNotifyTrackingState(later)).toBe(true);
  });

  test('a resume that just AUTO-STOPPED shows the stop toast, NOT a generic notif', () => {
    // Auto-stop toast fired 1s ago; the paired resume must not add a "not tracking".
    const afterAutoStop = {
      ...base,
      isTracking: false,
      lastNotifiedTracking: null,
      lastAutoStopNotifAt: 100000 - 1000,
      now: 100000,
    };
    expect(shouldNotifyTrackingState(afterAutoStop)).toBe(false);
  });

  test('the auto-stop suppression expires after its window', () => {
    const afterAutoStop = {
      ...base,
      isTracking: false,
      lastNotifiedTracking: null,
      lastAutoStopNotifAt: 100000 - 9000, // > 8s ago
      now: 100000,
    };
    expect(shouldNotifyTrackingState(afterAutoStop)).toBe(true);
  });

  test('does not fire while an idle alert is showing (no contradiction)', () => {
    expect(
      shouldNotifyTrackingState({ ...base, isIdleAlertActive: true }),
    ).toBe(false);
  });
});
