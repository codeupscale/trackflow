<?php

namespace App\Support;

use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Database\Eloquent\Builder as EloquentBuilder;
use Illuminate\Support\Facades\DB;

/**
 * The single definition of "how long is a time entry, and which entries count".
 *
 * Every surface that reports time — dashboard, reports tab, report builder, the
 * time-entry list — MUST go through this class. They previously each rolled their
 * own arithmetic and disagreed on the same date range:
 *
 *   - Some summed `duration_seconds`, which is not trustworthy. It is written by
 *     the desktop agent and older versions corrupted it: idle rows across the dev
 *     dataset stored 1897h against 55h of real wall-clock, and a handful of tracked
 *     rows store NEGATIVE seconds, which a raw SUM() silently subtracts.
 *   - Some derived it from the timestamps and clamped it, which is correct.
 *   - Some counted `type = 'tracked'` (dropping approved manual time), some counted
 *     everything (including idle), some correctly counted `type <> 'idle'`.
 *   - The daily series grouped by DATE(started_at), i.e. the UTC date, while the
 *     range bounds around it were resolved in the organization timezone.
 */
class WorkedTime
{
    /**
     * Hard ceiling for a single entry. A runaway timer (a session nobody stopped,
     * a dead machine) must not be able to bill days of wall-clock into a rollup.
     */
    public const MAX_ENTRY_DURATION = 43200; // 12h

    /**
     * Canonical duration of one entry, in seconds.
     *
     * Derived from the timestamps rather than read from `duration_seconds`, then
     * clamped to [0, MAX_ENTRY_DURATION] so corrupt rows can neither subtract time
     * nor inflate it.
     */
    public static function durationExpr(string $prefix = ''): string
    {
        $cap = self::MAX_ENTRY_DURATION;
        $startCol = $prefix ? "{$prefix}.started_at" : 'started_at';
        $endCol = $prefix ? "{$prefix}.ended_at" : 'ended_at';

        if (DB::connection()->getDriverName() === 'sqlite') {
            // SQLite: julianday diff * 86400 = seconds; MIN/MAX are scalar here.
            return "MIN(MAX(CAST((julianday({$endCol}) - julianday({$startCol})) * 86400 AS INTEGER), 0), {$cap})";
        }

        return "LEAST(GREATEST(EXTRACT(EPOCH FROM ({$endCol} - {$startCol}))::int, 0), {$cap})";
    }

    /**
     * The calendar date an entry belongs to, in the organization's timezone.
     *
     * `started_at` is a `timestamp without time zone` holding UTC, so DATE() on it
     * yields the UTC date. For Asia/Karachi (UTC+5) that pushes everything worked
     * between local 00:00 and 05:00 onto the previous day's bar.
     */
    public static function localDateExpr(string $timezone, string $prefix = ''): string
    {
        $startCol = $prefix ? "{$prefix}.started_at" : 'started_at';

        if (DB::connection()->getDriverName() === 'sqlite') {
            return "DATE({$startCol})";
        }

        return "DATE({$startCol} AT TIME ZONE 'UTC' AT TIME ZONE " . DB::getPdo()->quote($timezone) . ")";
    }

    /**
     * Restrict a query to the entries that count as WORKED time.
     *
     * Worked = every APPROVED entry that is not idle. "Tracked" is a row type, not a
     * synonym for "worked": filtering on it drops approved manual time, which is how
     * the reports tab came to under-report by the whole manual bucket.
     *
     * @param  EloquentBuilder|QueryBuilder  $query
     */
    public static function scopeWorked($query, string $prefix = '')
    {
        $col = fn (string $c) => $prefix ? "{$prefix}.{$c}" : $c;

        return $query
            ->whereNotNull($col('ended_at'))
            ->where($col('type'), '<>', 'idle')
            ->where($col('approval_status'), 'approved');
    }
}
