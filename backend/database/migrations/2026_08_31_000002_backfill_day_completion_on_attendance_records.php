<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Backfill the day-completion snapshot for existing check-in records.
 *
 * Uses each record's OWN `expected_start` / `expected_end` (the shift times the
 * nightly job already snapshots per day) rather than the employee's current
 * shift, so history is judged by the schedule that applied then.
 *
 * Grace is NOT recoverable for past rows — it was never stored — so the backfill
 * deliberately uses the raw span with no grace deduction. That is the strict
 * reading: it can mark a day short that a live evaluation would have forgiven by
 * up to the grace window. Chosen over inventing a grace value that may never
 * have applied. Rows re-evaluated by a later check-in/checkout are corrected by
 * recomputeRecordRollups.
 *
 * Rows with no usable shift times fall back to a 9-hour day, matching the
 * service's own fallback.
 */
return new class extends Migration
{
    private const FALLBACK_SECONDS = 9 * 60 * 60;

    public function up(): void
    {
        DB::table('attendance_records')
            ->whereNotNull('check_in_at')
            ->whereNotNull('check_out_at')
            ->whereNull('required_day_seconds')
            ->orderBy('id')
            // Chunked: a mature org can hold hundreds of thousands of rows.
            ->chunkById(1000, function ($rows) {
                foreach ($rows as $row) {
                    $required = $this->requiredFor($row->expected_start ?? null, $row->expected_end ?? null);

                    $presence = strtotime((string) $row->check_out_at) - strtotime((string) $row->check_in_at);

                    DB::table('attendance_records')
                        ->where('id', $row->id)
                        ->update([
                            'required_day_seconds' => $required,
                            'met_required_hours' => $presence >= $required,
                        ]);
                }
            });
    }

    public function down(): void
    {
        DB::table('attendance_records')->update([
            'required_day_seconds' => null,
            'met_required_hours' => null,
        ]);
    }

    private function requiredFor(?string $start, ?string $end): int
    {
        if ($start === null || $end === null) {
            return self::FALLBACK_SECONDS;
        }

        $s = strtotime("1970-01-01 {$start} UTC");
        $e = strtotime("1970-01-01 {$end} UTC");

        if ($s === false || $e === false) {
            return self::FALLBACK_SECONDS;
        }

        // An overnight shift ends the following day.
        return $e > $s ? $e - $s : $e + 86400 - $s;
    }
};
