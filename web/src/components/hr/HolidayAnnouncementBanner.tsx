'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';

import api from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';
import {
  daysAway,
  headlineHoliday,
  type PublicHoliday,
} from '@/lib/holidays';

/**
 * Org-wide holiday headline under the navbar, shown to every role. Strictly
 * ONE holiday at a time: the nearest upcoming; the rest are held back and take
 * over automatically once its date passes (selection is a pure function of
 * today — see upcomingHolidays()). Deliberately NOT dismissible — an
 * announcement stays up until the date passes or management deletes the
 * holiday on the Holidays tab, so it cannot be muted per-viewer.
 *
 * The headline scrolls like a news ticker at a normal reading pace
 * (22s/loop), enters from the right corner, pauses on hover, and renders
 * static under prefers-reduced-motion. See .tf-ticker in globals.css.
 */
export function HolidayAnnouncementBanner() {
  const { data } = useQuery<PublicHoliday[]>({
    queryKey: ['public-holidays'],
    queryFn: async () => {
      const res = await api.get('/hr/public-holidays');
      const raw = res.data;
      return raw.data ?? raw.holidays ?? (Array.isArray(raw) ? raw : []);
    },
    staleTime: 5 * 60 * 1000,
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Only a holiday management explicitly POSTED appears here — nothing posted
  // means no banner at all.
  const next = headlineHoliday(data ?? [], today);

  if (!next) return null;

  const { holiday, when } = next;
  const away = daysAway(when, today);

  // Explicit indigo shades per theme rather than theme tokens: the strip has
  // its own tinted ground in both themes, so `text-foreground` would clash.
  const headline = (
    <>
      <span className="font-semibold text-indigo-900 dark:text-indigo-100">{holiday.name}</span>
      <span className="text-indigo-700/80 dark:text-indigo-300/80">
        {' '}&middot; {when.toLocaleDateString('en-US', { weekday: 'long' })}, {formatDate(when)}
      </span>
      {holiday.announcer?.name && (
        <span className="text-indigo-700/65 dark:text-indigo-300/60">
          {' '}&middot; Announced by {holiday.announcer.name}
        </span>
      )}
    </>
  );

  return (
    <div
      role="status"
      aria-label={`Upcoming holiday: ${holiday.name}, ${formatDate(when)}${holiday.announcer?.name ? `, announced by ${holiday.announcer.name}` : ''}`}
      // A SLIM tinted strip, not a solid slab: light indigo wash in light mode,
      // a soft translucent indigo in dark. Indigo stakes out its own meaning —
      // amber is the offline banner, red destructive, emerald success — so a
      // holiday is noticeable without ever reading as a warning.
      className="flex items-center gap-2.5 px-4 md:px-6 py-1.5 border-b border-indigo-500/25 bg-indigo-50 dark:bg-indigo-500/10 text-[0.7rem] text-indigo-900 dark:text-indigo-200"
    >
      {/* Fixed label on the left so the bar is identifiable even mid-scroll,
          while only the headline text after it moves. */}
      <span className="flex items-center gap-1.5 shrink-0 pr-3 mr-0.5 border-r border-indigo-500/25">
        <CalendarDays className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
        <span className="font-semibold uppercase tracking-wide text-[0.65rem] text-indigo-700 dark:text-indigo-300">
          Holiday
        </span>
      </span>

      {/* News-style ticker: the headline enters from the RIGHT corner, crosses
          the bar, exits left, and re-enters from the right — never restarting
          mid-bar. aria-hidden — the static aria-label above carries the content
          for screen readers, which must not chase moving text. */}
      <div className="tf-ticker min-w-0 flex-1" aria-hidden="true">
        <span className="tf-ticker-track">{headline}</span>
      </div>

      <span
        className={cn(
          'shrink-0 rounded-full px-2 py-0.5 text-[0.6rem] font-semibold tabular-nums',
          // "Today" fills in for urgency; other days stay a quiet tint.
          away === 0
            ? 'bg-indigo-600 text-white'
            : 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
        )}
      >
        {away === 0 ? 'Today' : away === 1 ? 'Tomorrow' : `in ${away} days`}
      </span>
    </div>
  );
}
