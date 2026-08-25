import { describe, it, expect } from 'vitest';
import {
  headlineHoliday,
  nextOccurrence,
  upcomingHolidays,
  type PublicHoliday,
} from '@/lib/holidays';

const holiday = (over: Partial<PublicHoliday>): PublicHoliday => ({
  id: 'h1',
  name: 'Holiday',
  date: '2026-09-01',
  is_recurring: false,
  ...over,
});

const day = (s: string) => new Date(s + 'T00:00:00');

describe('holiday banner queue', () => {
  // The user's exact scenario: two announced holidays, 2 days and 5 days away.
  const eid = holiday({ id: 'eid', name: 'Eid', date: '2026-08-27' });
  const founders = holiday({ id: 'founders', name: 'Founders Day', date: '2026-08-30' });

  it('shows the nearer holiday first and holds the second back', () => {
    const list = upcomingHolidays([founders, eid], day('2026-08-25'));
    expect(list.map((x) => x.holiday.name)).toEqual(['Eid', 'Founders Day']);
  });

  it('the held holiday takes over automatically once the first date passes', () => {
    // Aug 28 — Eid (Aug 27) is now in the past.
    const list = upcomingHolidays([founders, eid], day('2026-08-28'));
    expect(list.map((x) => x.holiday.name)).toEqual(['Founders Day']);
  });

  it('a holiday still shows on its own day', () => {
    const list = upcomingHolidays([founders, eid], day('2026-08-27'));
    expect(list[0].holiday.name).toBe('Eid');
  });

  it('a passed one-time holiday never resurfaces', () => {
    expect(nextOccurrence(eid, day('2026-12-01'))).toBeNull();
  });

  it('a recurring holiday rolls to next year after passing', () => {
    const annual = holiday({ id: 'annual', name: 'National Day', date: '2025-03-23', is_recurring: true });
    const next = nextOccurrence(annual, day('2026-08-25'));
    expect(next?.getFullYear()).toBe(2027);
    expect(next?.getMonth()).toBe(2); // March
    expect(next?.getDate()).toBe(23);
  });

  it('a recurring holiday later this year stays in this year', () => {
    const annual = holiday({ id: 'annual', name: 'National Day', date: '2020-12-25', is_recurring: true });
    const next = nextOccurrence(annual, day('2026-08-25'));
    expect(next?.getFullYear()).toBe(2026);
  });

  it('a pinned upcoming holiday beats a nearer unpinned one for the headline', () => {
    const pinnedLater = holiday({ id: 'p', name: 'Pinned Day', date: '2026-08-30', is_pinned: true });
    const pick = headlineHoliday([eid, pinnedLater], day('2026-08-25'));
    expect(pick?.holiday.name).toBe('Pinned Day');
  });

  it('shows nothing when no holiday is posted', () => {
    // Upcoming holidays exist, but none was posted — an unposted holiday is
    // not an announcement, so the banner stays empty.
    const pick = headlineHoliday([eid, founders], day('2026-08-25'));
    expect(pick).toBeUndefined();
  });

  it('a posted holiday whose date passed clears the headline', () => {
    const stalePin = holiday({ id: 'p', name: 'Stale Pin', date: '2026-08-20', is_pinned: true });
    const pick = headlineHoliday([stalePin, founders], day('2026-08-25'));
    expect(pick).toBeUndefined();
  });
});
