import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  computeClockOffset,
  elapsedSeconds,
  formatElapsed,
  formatDuration,
  formatHhmm,
  formatMinutes,
  formatPolicyTime,
  checkInBadgeTooltip,
  deriveCheckInBadges,
} from '@/lib/check-in-time';

describe('computeClockOffset', () => {
  it('returns server - client in ms', () => {
    const client = Date.parse('2026-07-03T11:30:00.000Z');
    expect(computeClockOffset('2026-07-03T11:30:02.000Z', client)).toBe(2000);
    expect(computeClockOffset('2026-07-03T11:29:57.000Z', client)).toBe(-3000);
  });

  it('returns 0 for missing / unparseable server time', () => {
    expect(computeClockOffset(null, Date.now())).toBe(0);
    expect(computeClockOffset(undefined, Date.now())).toBe(0);
    expect(computeClockOffset('not-a-date', Date.now())).toBe(0);
  });
});

describe('elapsedSeconds — server-derived, drift-free', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-03T11:30:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is 0 at the moment of check-in', () => {
    const clientNow = Date.now();
    // Server is 2s ahead of this client.
    const offset = computeClockOffset('2026-07-03T11:30:02.000Z', clientNow);
    const checkInAt = '2026-07-03T11:30:02.000Z'; // == server now
    expect(elapsedSeconds(checkInAt, offset, Date.now())).toBe(0);
  });

  it('derives elapsed from wall-clock, not from a tick counter', () => {
    const clientNow = Date.now();
    const offset = computeClockOffset('2026-07-03T11:30:02.000Z', clientNow);
    const checkInAt = '2026-07-03T11:30:02.000Z';

    // Advance the wall clock in one big jump (simulating a dropped/slow interval).
    // Because elapsed is recomputed from Date.now(), it must reflect the FULL delta,
    // never the number of ticks that fired.
    vi.advanceTimersByTime(5000);
    expect(elapsedSeconds(checkInAt, offset, Date.now())).toBe(5);

    vi.advanceTimersByTime(3_600_000); // +1h
    expect(elapsedSeconds(checkInAt, offset, Date.now())).toBe(3605);
  });

  it('does not accumulate error across many small advances', () => {
    const clientNow = Date.now();
    const offset = computeClockOffset('2026-07-03T11:30:00.000Z', clientNow);
    const checkInAt = '2026-07-03T11:30:00.000Z';

    // Simulate 1000 imperfect ticks of 1001ms each. A counter-based approach would
    // report 1000 seconds; a derived approach reports the true wall-clock delta.
    for (let i = 0; i < 1000; i++) {
      vi.advanceTimersByTime(1001);
    }
    const wallSeconds = Math.floor((1000 * 1001) / 1000); // 1001
    expect(elapsedSeconds(checkInAt, offset, Date.now())).toBe(wallSeconds);
  });

  it('accounts for clock skew so the client clock cannot run ahead of the server', () => {
    const clientNow = Date.now();
    // Client is 10s AHEAD of the server (offset negative).
    const offset = computeClockOffset('2026-07-03T11:29:50.000Z', clientNow);
    const checkInAt = '2026-07-03T11:29:50.000Z'; // server-time of check-in
    // At t0 the client reads 11:30:00 but server-now is 11:29:50 → elapsed 0.
    expect(elapsedSeconds(checkInAt, offset, Date.now())).toBe(0);
    vi.advanceTimersByTime(4000);
    expect(elapsedSeconds(checkInAt, offset, Date.now())).toBe(4);
  });

  it('never returns a negative value', () => {
    const clientNow = Date.now();
    const offset = 0;
    // check-in is in the future relative to now.
    expect(elapsedSeconds('2026-07-03T12:00:00.000Z', offset, clientNow)).toBe(0);
  });

  it('returns 0 for missing check-in timestamp', () => {
    expect(elapsedSeconds(null, 0, Date.now())).toBe(0);
    expect(elapsedSeconds(undefined, 0, Date.now())).toBe(0);
  });
});

describe('formatElapsed', () => {
  it('formats HH:MM:SS zero-padded', () => {
    expect(formatElapsed(0)).toBe('00:00:00');
    expect(formatElapsed(5)).toBe('00:00:05');
    expect(formatElapsed(65)).toBe('00:01:05');
    expect(formatElapsed(3605)).toBe('01:00:05');
    expect(formatElapsed(3661)).toBe('01:01:01');
  });

  it('supports hours beyond a day', () => {
    expect(formatElapsed(25 * 3600)).toBe('25:00:00');
  });

  it('clamps negatives to zero', () => {
    expect(formatElapsed(-10)).toBe('00:00:00');
  });
});

describe('formatDuration — unambiguous "Xh Ym Zs" totals', () => {
  it('renders 0s for zero / null / undefined / negative', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(null)).toBe('0s');
    expect(formatDuration(undefined)).toBe('0s');
    expect(formatDuration(-100)).toBe('0s');
  });

  it('renders sub-minute values in seconds', () => {
    expect(formatDuration(1)).toBe('1s');
    expect(formatDuration(59)).toBe('59s');
  });

  it('includes seconds below an hour', () => {
    expect(formatDuration(90)).toBe('1m 30s'); // 1m30s
    expect(formatDuration(158)).toBe('2m 38s'); // 2m38s
    expect(formatDuration(120)).toBe('2m'); // exact minute drops trailing 0s
  });

  it('renders whole hours with no minutes/seconds as "Xh"', () => {
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(8 * 3600)).toBe('8h');
  });

  it('renders hours + minutes + seconds', () => {
    expect(formatDuration(3660)).toBe('1h 1m'); // 1h1m0s → trailing 0s dropped
    expect(formatDuration(3852)).toBe('1h 4m 12s'); // 1h4m12s
    expect(formatDuration(31800)).toBe('8h 50m'); // 8h50m0s
    expect(formatDuration(31812)).toBe('8h 50m 12s');
  });

  it('keeps an interior zero minute so "1h 0m 5s" is never ambiguous', () => {
    expect(formatDuration(3605)).toBe('1h 0m 5s');
  });
});

describe('formatHhmm — mirrors backend', () => {
  it('formats seconds as HH:MM', () => {
    expect(formatHhmm(0)).toBe('00:00');
    expect(formatHhmm(59)).toBe('00:00');
    expect(formatHhmm(60)).toBe('00:01');
    expect(formatHhmm(3600)).toBe('01:00');
    expect(formatHhmm(3661)).toBe('01:01');
    expect(formatHhmm(8 * 3600 + 30 * 60)).toBe('08:30');
  });

  it('returns null for null/undefined', () => {
    expect(formatHhmm(null)).toBeNull();
    expect(formatHhmm(undefined)).toBeNull();
  });
});

describe('formatMinutes — raw minute counts as "Xh Ym"', () => {
  it('renders 0m for zero / null / undefined / negative', () => {
    expect(formatMinutes(0)).toBe('0m');
    expect(formatMinutes(null)).toBe('0m');
    expect(formatMinutes(undefined)).toBe('0m');
    expect(formatMinutes(-5)).toBe('0m');
  });

  it('renders sub-hour values in minutes only', () => {
    expect(formatMinutes(1)).toBe('1m');
    expect(formatMinutes(36)).toBe('36m');
    expect(formatMinutes(59)).toBe('59m');
  });

  it('renders whole hours with no trailing minutes', () => {
    expect(formatMinutes(60)).toBe('1h');
    expect(formatMinutes(120)).toBe('2h');
  });

  it('renders hours + minutes for values >= 60 (the confusing raw-number case)', () => {
    // The owner's screenshot: a check-in 456 minutes after the official start must
    // read as "7h 36m", never the bare "456".
    expect(formatMinutes(456)).toBe('7h 36m');
    expect(formatMinutes(168)).toBe('2h 48m');
    expect(formatMinutes(90)).toBe('1h 30m');
    expect(formatMinutes(61)).toBe('1h 1m');
  });

  it('floors fractional minutes', () => {
    expect(formatMinutes(90.9)).toBe('1h 30m');
  });
});

describe('formatPolicyTime — 24h policy string to 12h label', () => {
  it('formats HH:MM:SS wall-clock strings', () => {
    expect(formatPolicyTime('11:30:00')).toBe('11:30 AM');
    expect(formatPolicyTime('20:30:00')).toBe('8:30 PM');
    expect(formatPolicyTime('11:45:00')).toBe('11:45 AM');
  });

  it('handles midnight and noon boundaries', () => {
    expect(formatPolicyTime('00:00:00')).toBe('12:00 AM');
    expect(formatPolicyTime('12:00:00')).toBe('12:00 PM');
    expect(formatPolicyTime('12:30')).toBe('12:30 PM');
    expect(formatPolicyTime('00:15')).toBe('12:15 AM');
  });

  it('accepts HH:MM without seconds', () => {
    expect(formatPolicyTime('09:05')).toBe('9:05 AM');
  });

  it('returns null for missing / invalid input', () => {
    expect(formatPolicyTime(null)).toBeNull();
    expect(formatPolicyTime(undefined)).toBeNull();
    expect(formatPolicyTime('')).toBeNull();
    expect(formatPolicyTime('not-a-time')).toBeNull();
    expect(formatPolicyTime('25:00')).toBeNull();
    expect(formatPolicyTime('10:99')).toBeNull();
  });
});

describe('checkInBadgeTooltip — plain-language, policy-anchored', () => {
  it('late: names the "Xh Ym" and the concrete policy start when available', () => {
    expect(
      checkInBadgeTooltip('late', { lateMinutes: 456, checkInTime: '11:30:00' })
    ).toBe('Checked in 7h 36m after the 11:30 AM official start.');
  });

  it('late: falls back to generic anchor when policy start is missing', () => {
    expect(checkInBadgeTooltip('late', { lateMinutes: 168 })).toBe(
      'Checked in 2h 48m after the official start time.'
    );
  });

  it('late: omits the duration when no minutes are known', () => {
    expect(checkInBadgeTooltip('late', { checkInTime: '11:30:00' })).toBe(
      'Checked in after the 11:30 AM official start.'
    );
  });

  it('early_checkout: names the "Xh Ym" and the concrete checkout time', () => {
    expect(
      checkInBadgeTooltip('early_checkout', {
        earlyMinutes: 168,
        checkoutTime: '20:30:00',
      })
    ).toBe('Checked out 2h 48m before the 8:30 PM checkout time.');
  });

  it('early_checkout: generic phrasing when minutes and policy are unavailable', () => {
    expect(checkInBadgeTooltip('early_checkout', {})).toBe(
      "Checked out before the organization's checkout time."
    );
  });

  it('overtime: names the "Xh Ym" past the checkout time', () => {
    expect(
      checkInBadgeTooltip('overtime', {
        overtimeMinutes: 75,
        checkoutTime: '20:30:00',
      })
    ).toBe('Worked 1h 15m of overtime past the 8:30 PM checkout time.');
  });

  it('missing_checkout / advisory flags return a fixed explanation', () => {
    expect(checkInBadgeTooltip('missing_checkout')).toMatch(/auto-closed/);
    expect(checkInBadgeTooltip('on_approved_leave')).toMatch(/approved leave/);
    expect(checkInBadgeTooltip('worked_on_off_day')).toMatch(/weekend or holiday/);
  });

  it('on_time returns undefined (no tooltip worth showing)', () => {
    expect(checkInBadgeTooltip('on_time')).toBeUndefined();
  });
});

describe('deriveCheckInBadges', () => {
  it('returns an empty array when not checked in', () => {
    expect(deriveCheckInBadges({ check_in_at: null })).toEqual([]);
    expect(deriveCheckInBadges({})).toEqual([]);
  });

  it('renders BOTH late and early_checkout when both are true (regression)', () => {
    // The owner-reported bug: a day that is both late AND an early checkout must
    // show both badges — the earlier single-badge collapse dropped "Late".
    expect(
      deriveCheckInBadges({
        check_in_at: '2026-07-03T11:30:00Z',
        check_in_status: 'late',
        is_early_checkout: true,
      })
    ).toEqual(['late', 'early_checkout']);
  });

  it('keeps a deterministic order: late → early_checkout → missing_checkout', () => {
    expect(
      deriveCheckInBadges({
        check_in_at: '2026-07-03T11:30:00Z',
        check_in_status: 'late',
        is_early_checkout: true,
        missing_checkout: true,
      })
    ).toEqual(['late', 'early_checkout', 'missing_checkout']);
  });

  it('coexists late with missing_checkout', () => {
    expect(
      deriveCheckInBadges({
        check_in_at: '2026-07-03T11:30:00Z',
        check_in_status: 'late',
        missing_checkout: true,
      })
    ).toEqual(['late', 'missing_checkout']);
  });

  it('renders single exception badges alone', () => {
    expect(
      deriveCheckInBadges({
        check_in_at: '2026-07-03T11:30:00Z',
        check_in_status: 'late',
      })
    ).toEqual(['late']);

    expect(
      deriveCheckInBadges({
        check_in_at: '2026-07-03T11:30:00Z',
        is_early_checkout: true,
      })
    ).toEqual(['early_checkout']);

    expect(
      deriveCheckInBadges({
        check_in_at: '2026-07-03T11:30:00Z',
        missing_checkout: true,
      })
    ).toEqual(['missing_checkout']);
  });

  it('surfaces on_time only when nothing else is worth flagging', () => {
    expect(
      deriveCheckInBadges({
        check_in_at: '2026-07-03T11:30:00Z',
        check_in_status: 'on_time',
      })
    ).toEqual(['on_time']);

    // on_time never competes with an exception badge (e.g. an early checkout).
    expect(
      deriveCheckInBadges({
        check_in_at: '2026-07-03T11:30:00Z',
        check_in_status: 'on_time',
        is_early_checkout: true,
      })
    ).toEqual(['early_checkout']);
  });
});
