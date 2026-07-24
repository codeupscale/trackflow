<?php

namespace App\Support;

/**
 * The effective check-in schedule for a user on a given day — sourced from their
 * assigned shift (or the org fallback). Deliberately exposes the SAME property names the
 * old per-org AttendancePolicy did (check_in_time / late_threshold / checkout_time /
 * timezone / allow_early_check_in), so CheckInService method bodies read it unchanged.
 *
 * Times are wall-clock "HH:MM:SS" strings in `timezone`, rebuilt per-date via
 * Carbon::parse("$date $time", $tz) by the callers so DST is handled correctly.
 *
 * `late_threshold` is derived: shift start_time + grace_period_minutes.
 */
final class CheckInSchedule
{
    public function __construct(
        public readonly string $check_in_time,
        public readonly string $late_threshold,
        public readonly string $checkout_time,
        public readonly string $timezone,
        public readonly bool $allow_early_check_in,
        /** Source shift id, or null when the org fallback was used. */
        public readonly ?string $shift_id = null,
    ) {}
}
