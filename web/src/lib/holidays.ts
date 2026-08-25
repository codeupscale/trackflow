/**
 * Public-holiday date logic, shared by the org-wide announcement banner and
 * the Holidays management tab.
 *
 * Lives in lib rather than beside a component because the employee-facing
 * "Upcoming Holidays" card was removed — the headline banner is the single
 * employee-visible surface now — and these helpers outlived it.
 */

export interface PublicHoliday {
  id: string;
  name: string;
  date: string; // ISO
  is_recurring: boolean;
  is_pinned?: boolean;
  announcer?: { id: string; name: string } | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Next occurrence of a holiday on/after today. A recurring holiday rolls to
 * this year's month/day, or next year's if it has already passed; a one-time
 * holiday only counts while its date is still ahead.
 */
export function nextOccurrence(h: PublicHoliday, today: Date): Date | null {
  const d = new Date(h.date.slice(0, 10) + 'T00:00:00');
  if (!h.is_recurring) return d >= today ? d : null;
  const roll = new Date(today.getFullYear(), d.getMonth(), d.getDate());
  return roll >= today ? roll : new Date(today.getFullYear() + 1, d.getMonth(), d.getDate());
}

export function daysAway(d: Date, today: Date): number {
  return Math.round((d.getTime() - today.getTime()) / DAY_MS);
}

/**
 * All upcoming holidays sorted nearest-first. Because passed one-time holidays
 * resolve to null and recurring ones roll forward, the moment a date passes
 * the next holiday moves to the front automatically — no state, purely a
 * function of today.
 */
export function upcomingHolidays(
  holidays: PublicHoliday[],
  today: Date,
): { holiday: PublicHoliday; when: Date }[] {
  return holidays
    .map((h) => ({ holiday: h, when: nextOccurrence(h, today) }))
    .filter((x): x is { holiday: PublicHoliday; when: Date } => x.when !== null)
    .sort((a, b) => a.when.getTime() - b.when.getTime());
}

/**
 * Which holiday the org-wide banner shows: ONLY one management explicitly
 * posted. There is deliberately no nearest-upcoming fallback — an unposted
 * holiday is not an announcement, so with nothing posted the banner renders
 * nothing at all.
 *
 * A posted holiday whose date has passed also stops qualifying (a passed
 * one-time holiday has no next occurrence), so a stale pin clears itself
 * instead of leaving old news on every page.
 */
export function headlineHoliday(
  holidays: PublicHoliday[],
  today: Date,
): { holiday: PublicHoliday; when: Date } | undefined {
  return upcomingHolidays(holidays, today).find((x) => x.holiday.is_pinned);
}
