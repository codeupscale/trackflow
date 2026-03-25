<?php

namespace App\Support;

use Carbon\Carbon;

/**
 * Converts user-facing date ranges (in a given timezone) to UTC bounds for DB queries.
 * DB stores datetimes in UTC; filters must use the user's local day boundaries.
 *
 * Upper bound uses start-of-next-day so callers should use < (not <=) for the end:
 *   WHERE column >= $start AND column < $end
 *
 * Example: User in Asia/Karachi (UTC+5) selects "2026-03-19"
 *   → Start: 2026-03-19 00:00:00 Karachi = 2026-03-18 19:00:00 UTC
 *   → End:   2026-03-20 00:00:00 Karachi = 2026-03-19 19:00:00 UTC
 */
final class TimezoneAwareDateRange
{
    private const FALLBACK_TIMEZONE = 'UTC';

    /**
     * Return UTC bounds [start, end) for a date range in the given timezone.
     * Use for DB queries: WHERE column >= $start AND column < $end
     *
     * End is the start of the NEXT day (exclusive upper bound) to avoid
     * missing entries with fractional seconds in the last second of the day.
     *
     * @return array{0: string, 1: string} ['Y-m-d H:i:s', 'Y-m-d H:i:s'] in UTC
     */
    public static function toUtcBounds(string $dateFrom, string $dateTo, string $timezone): array
    {
        $tz = self::sanitizeTimezone($timezone);

        $start = Carbon::parse($dateFrom, $tz)->startOfDay()->utc()->format('Y-m-d H:i:s');
        $end = Carbon::parse($dateTo, $tz)->addDay()->startOfDay()->utc()->format('Y-m-d H:i:s');

        return [$start, $end];
    }

    /**
     * Return UTC bounds [start, end) for "today" in the given timezone.
     * Use for timer "today total", dashboard "today", etc.
     *
     * End is start of tomorrow (exclusive) — use < for upper bound.
     *
     * @return array{0: string, 1: string} ['Y-m-d H:i:s', 'Y-m-d H:i:s'] in UTC
     */
    public static function userTodayUtcBounds(string $timezone): array
    {
        $tz = self::sanitizeTimezone($timezone);

        $start = Carbon::now($tz)->startOfDay()->utc()->format('Y-m-d H:i:s');
        $end = Carbon::now($tz)->addDay()->startOfDay()->utc()->format('Y-m-d H:i:s');

        return [$start, $end];
    }

    /**
     * Single date: start of day in user TZ → UTC.
     */
    public static function startOfDayUtc(string $date, string $timezone): string
    {
        $tz = self::sanitizeTimezone($timezone);

        return Carbon::parse($date, $tz)->startOfDay()->utc()->format('Y-m-d H:i:s');
    }

    /**
     * Single date: start of NEXT day in user TZ → UTC (exclusive upper bound).
     * Use with < operator: WHERE column < endOfDayUtc(...)
     */
    public static function endOfDayUtc(string $date, string $timezone): string
    {
        $tz = self::sanitizeTimezone($timezone);

        return Carbon::parse($date, $tz)->addDay()->startOfDay()->utc()->format('Y-m-d H:i:s');
    }

    private static function sanitizeTimezone(string $timezone): string
    {
        $timezone = trim($timezone);
        if ($timezone === '') {
            return self::FALLBACK_TIMEZONE;
        }

        try {
            Carbon::now($timezone);
            return $timezone;
        } catch (\Exception) {
            return self::FALLBACK_TIMEZONE;
        }
    }
}
