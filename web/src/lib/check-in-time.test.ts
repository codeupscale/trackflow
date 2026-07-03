import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  computeClockOffset,
  elapsedSeconds,
  formatElapsed,
  formatDuration,
  formatHhmm,
  deriveCheckInBadgeStatus,
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

describe('deriveCheckInBadgeStatus', () => {
  it('returns null when not checked in', () => {
    expect(deriveCheckInBadgeStatus({ check_in_at: null })).toBeNull();
    expect(deriveCheckInBadgeStatus({})).toBeNull();
  });

  it('prioritizes missing_checkout over everything', () => {
    expect(
      deriveCheckInBadgeStatus({
        check_in_at: '2026-07-03T11:30:00Z',
        missing_checkout: true,
        is_early_checkout: true,
        check_in_status: 'late',
      })
    ).toBe('missing_checkout');
  });

  it('then early_checkout, then late, then on_time', () => {
    expect(
      deriveCheckInBadgeStatus({
        check_in_at: '2026-07-03T11:30:00Z',
        is_early_checkout: true,
        check_in_status: 'late',
      })
    ).toBe('early_checkout');

    expect(
      deriveCheckInBadgeStatus({
        check_in_at: '2026-07-03T11:30:00Z',
        check_in_status: 'late',
      })
    ).toBe('late');

    expect(
      deriveCheckInBadgeStatus({
        check_in_at: '2026-07-03T11:30:00Z',
        check_in_status: 'on_time',
      })
    ).toBe('on_time');
  });
});
