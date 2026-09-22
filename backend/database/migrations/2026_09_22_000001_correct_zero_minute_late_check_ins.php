<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Un-mark the check-ins that were only "late" by seconds.
 *
 * Lateness was judged to the SECOND: pressing Check In at 16:30:40 against a
 * 16:30 threshold marked the day `late`, while the minutes recorded were 0
 * because the diff truncates. CheckInService now judges at minute precision,
 * which stops NEW days being wrong — but every day already written that way
 * still counts in the Late tile, the report's late column and the per-employee
 * late count, for someone who by the corrected rule was on time.
 *
 * Precisely scoped: only rows that say `late` AND record no late minutes. A day
 * with even one real minute of lateness is left exactly as it is.
 *
 * Deliberately irreversible. down() cannot know which rows this touched, and
 * re-marking every on-time zero-minute day as late would be the original bug.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('attendance_records')
            ->where('check_in_status', 'late')
            ->where(function ($q) {
                $q->whereNull('check_in_late_minutes')
                    ->orWhere('check_in_late_minutes', '<=', 0);
            })
            ->update([
                'check_in_status' => 'on_time',
                'check_in_late_minutes' => 0,
            ]);
    }

    public function down(): void
    {
        // Intentionally empty — see the class docblock.
    }
};
