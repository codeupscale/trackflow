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
  dayPresenceSeconds,
  requiredDaySeconds,
  requiredDayFromPolicy,
  REQUIRED_DAY_SECONDS,
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

  it('early_checkout: names the completed time and the shortfall against 9h', () => {
    // Anchored on the 9-hour day requirement, not on the checkout clock time —
    // the badge now means "short day", so the tooltip must quantify the gap.
    expect(
      checkInBadgeTooltip('early_checkout', { presenceSeconds: 6 * 3600 + 12 * 60 })
    ).toBe('Completed 6h 12m of the required 9h day — 2h 48m short.');
  });

  it('early_checkout: generic phrasing when presence is unavailable', () => {
    expect(checkInBadgeTooltip('early_checkout', {})).toBe(
      'Did not complete the required 9h day (break included).'
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

  it('NEVER emits a late badge, however late the check-in was', () => {
    // The Late badge was retired (owner decision). Lateness is still reported
    // numerically in the "Late (min)" column, never as a status badge — so a
    // late arrival that completed a full day is indistinguishable from any
    // other complete day here.
    expect(
      deriveCheckInBadges({
        check_in_at: '2026-07-03T04:00:00Z',
        check_in_status: 'late',
        check_out_at: '2026-07-03T13:00:00Z', // 9h — a full day
      })
    ).toEqual([]);

    expect(
      deriveCheckInBadges({
        check_in_at: '2026-07-03T04:00:00Z',
        check_in_status: 'late',
        check_out_at: '2026-07-03T13:00:00Z',
        missing_checkout: true,
      })
    ).toEqual(['missing_checkout']);
  });

  it('flags a short day as early_checkout, measured on PRESENCE not clock-out time', () => {
    // 8h present — under the 9h requirement.
    expect(
      deriveCheckInBadges({
        check_in_at: '2026-07-03T04:00:00Z',
        check_out_at: '2026-07-03T12:00:00Z',
      })
    ).toEqual(['early_checkout']);

    // Exactly 9h is complete, not short (boundary).
    expect(
      deriveCheckInBadges({
        check_in_at: '2026-07-03T04:00:00Z',
        check_out_at: '2026-07-03T13:00:00Z',
      })
    ).toEqual([]);

    // Over 9h is likewise complete.
    expect(
      deriveCheckInBadges({
        check_in_at: '2026-07-03T04:00:00Z',
        check_out_at: '2026-07-03T14:30:00Z',
      })
    ).toEqual([]);
  });

  it('counts the break toward the 9 hours (span, not summed sessions)', () => {
    // In 09:00, out 18:00 with an hour of break in between: worked_seconds is
    // only 8h but the DAY is 9h, so this must NOT be flagged. Measuring summed
    // sessions instead would wrongly demand a 10-hour presence.
    expect(
      deriveCheckInBadges({
        check_in_at: '2026-07-03T04:00:00Z',
        check_out_at: '2026-07-03T13:00:00Z',
        worked_seconds: 8 * 3600,
      })
    ).toEqual([]);
  });

  it('does not flag a day that used the grace window (owner-reported case)', () => {
    // 11:30 shift with 15 minutes of grace: checking in at 11:45 and out at
    // 20:30 is 8h45m — under the 9h shift length, but the grace is exactly what
    // the policy grants, so this is a COMPLETE day. Judging against a flat 9h
    // would punish the employee for using the allowance they were given.
    const shift = {
      start_time: '11:30:00',
      end_time: '20:30:00',
      grace_period_minutes: 15,
    };

    expect(
      deriveCheckInBadges({
        check_in_at: '2026-07-03T06:45:00Z', // 11:45 local
        check_out_at: '2026-07-03T15:30:00Z', // 20:30 local → 8h45m
        shift,
      })
    ).toEqual([]);

    // One minute past the grace allowance IS short.
    expect(
      deriveCheckInBadges({
        check_in_at: '2026-07-03T06:46:00Z',
        check_out_at: '2026-07-03T15:30:00Z', // 8h44m
        shift,
      })
    ).toEqual(['early_checkout']);
  });

  it('derives the requirement from the shift, not a flat 9 hours', () => {
    // A 6-hour shift is complete at 6 hours — a flat 9h rule would flag every
    // part-time day forever.
    expect(
      deriveCheckInBadges({
        check_in_at: '2026-07-03T04:00:00Z',
        check_out_at: '2026-07-03T10:00:00Z',
        shift: { start_time: '09:00:00', end_time: '15:00:00', grace_period_minutes: 0 },
      })
    ).toEqual([]);
  });

  it('trusts the server snapshot over the local computation', () => {
    // The snapshot was taken against the schedule in force THAT day. If the
    // employee later moved to a shorter shift, recomputing locally would
    // retroactively "pass" a day that genuinely fell short — history must not
    // be re-judged by today's rule.
    expect(
      deriveCheckInBadges({
        check_in_at: '2026-07-03T04:00:00Z',
        check_out_at: '2026-07-03T13:00:00Z', // 9h — locally this looks complete
        met_required_hours: false, // …but that day required more
      })
    ).toEqual(['early_checkout']);

    // And the converse: a locally-short day the server passed stays passed.
    expect(
      deriveCheckInBadges({
        check_in_at: '2026-07-03T04:00:00Z',
        check_out_at: '2026-07-03T09:00:00Z', // 5h
        met_required_hours: true,
      })
    ).toEqual([]);
  });

  it('falls back to the local rule only when the snapshot is absent', () => {
    // Rows predating the snapshot carry null and must still be judged.
    expect(
      deriveCheckInBadges({
        check_in_at: '2026-07-03T04:00:00Z',
        check_out_at: '2026-07-03T09:00:00Z',
        met_required_hours: null,
      })
    ).toEqual(['early_checkout']);
  });

  it('never judges an open day short (no checkout yet)', () => {
    // Someone still working must not be flagged mid-day. With no checkout and
    // no recorded work there is nothing to measure.
    expect(
      deriveCheckInBadges({
        check_in_at: '2026-07-03T04:00:00Z',
        check_out_at: null,
      })
    ).toEqual([]);
  });

  it('falls back to worked_seconds when the timestamp pair is unusable', () => {
    // Legacy row with no checkout timestamp but a recorded total.
    expect(
      deriveCheckInBadges({
        check_in_at: '2026-07-03T04:00:00Z',
        worked_seconds: 5 * 3600,
      })
    ).toEqual(['early_checkout']);

    expect(
      deriveCheckInBadges({
        check_in_at: '2026-07-03T04:00:00Z',
        worked_seconds: 9 * 3600,
      })
    ).toEqual([]);
  });

  it('keeps a deterministic order: early_checkout → missing_checkout', () => {
    expect(
      deriveCheckInBadges({
        check_in_at: '2026-07-03T04:00:00Z',
        check_out_at: '2026-07-03T10:00:00Z', // 6h — short
        missing_checkout: true,
      })
    ).toEqual(['early_checkout', 'missing_checkout']);
  });

  it('renders single exception badges alone', () => {
    expect(
      deriveCheckInBadges({
        check_in_at: '2026-07-03T04:00:00Z',
        check_out_at: '2026-07-03T09:00:00Z',
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
        check_in_at: '2026-07-03T04:00:00Z',
        check_in_status: 'on_time',
        check_out_at: '2026-07-03T13:00:00Z',
      })
    ).toEqual(['on_time']);

    // on_time never competes with an exception badge (e.g. a short day).
    expect(
      deriveCheckInBadges({
        check_in_at: '2026-07-03T04:00:00Z',
        check_in_status: 'on_time',
        check_out_at: '2026-07-03T09:00:00Z',
      })
    ).toEqual(['early_checkout']);
  });
});

describe('requiredDaySeconds', () => {
  it('subtracts the grace period from the shift length', () => {
    expect(
      requiredDaySeconds({ start_time: '11:30:00', end_time: '20:30:00', grace_period_minutes: 15 })
    ).toBe(8 * 3600 + 45 * 60);
  });

  it('handles an overnight shift', () => {
    // 16:00 → 01:00 is 9 hours across midnight, not a negative span.
    expect(
      requiredDaySeconds({ start_time: '16:00:00', end_time: '01:00:00', grace_period_minutes: 0 })
    ).toBe(9 * 3600);
  });

  it('falls back to 9h with no usable shift', () => {
    expect(requiredDaySeconds(null)).toBe(REQUIRED_DAY_SECONDS);
    expect(requiredDaySeconds({ start_time: null, end_time: null })).toBe(REQUIRED_DAY_SECONDS);
  });

  it('never lets grace erase the whole day', () => {
    expect(
      requiredDaySeconds({ start_time: '09:00:00', end_time: '10:00:00', grace_period_minutes: 999 })
    ).toBe(0);
  });
});

describe('requiredDayFromPolicy', () => {
  it('converts late_threshold back into a grace allowance', () => {
    // check_in 11:30, threshold 11:45 → 15 minutes of grace on a 9h day.
    expect(
      requiredDayFromPolicy({
        check_in_time: '11:30:00',
        late_threshold: '11:45:00',
        checkout_time: '20:30:00',
      })
    ).toBe(8 * 3600 + 45 * 60);
  });
});

describe('dayPresenceSeconds', () => {
  it('measures first check-in to last checkout, break included', () => {
    expect(
      dayPresenceSeconds({
        check_in_at: '2026-07-03T04:00:00Z',
        check_out_at: '2026-07-03T13:00:00Z',
        worked_seconds: 8 * 3600,
      })
    ).toBe(9 * 3600);
  });

  it('returns null for an open day with no recorded work', () => {
    expect(
      dayPresenceSeconds({ check_in_at: '2026-07-03T04:00:00Z', check_out_at: null })
    ).toBeNull();
  });

  it('falls back to worked_seconds without a usable timestamp pair', () => {
    expect(
      dayPresenceSeconds({ check_in_at: '2026-07-03T04:00:00Z', worked_seconds: 7200 })
    ).toBe(7200);
  });

  it('ignores an inverted timestamp pair and falls back', () => {
    // Checkout before check-in is corrupt data; never report negative presence.
    expect(
      dayPresenceSeconds({
        check_in_at: '2026-07-03T13:00:00Z',
        check_out_at: '2026-07-03T04:00:00Z',
        worked_seconds: 3600,
      })
    ).toBe(3600);
  });
});
