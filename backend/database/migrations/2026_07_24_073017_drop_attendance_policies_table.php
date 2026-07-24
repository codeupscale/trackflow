<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Drop attendance_policies — check-in windows now come from each user's SHIFT
 * (start_time / start+grace / end_time / shift.timezone / shift.allow_early_check_in),
 * with the org fallback (11:30 / 11:45 / 20:30, org timezone) resolved in
 * CheckInService::resolveSchedule(). Values were backfilled onto shifts by
 * 2026_07_23_200926_add_allow_early_check_in_to_shifts_and_backfill (which reads this
 * table), so this drop runs after it and after all code stopped referencing the table.
 *
 * down() recreates the (empty) table shape for reversibility; the data is not restored —
 * it lives in the shifts by then.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('attendance_policies');
    }

    public function down(): void
    {
        Schema::create('attendance_policies', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->time('check_in_time')->default('11:30:00');
            $table->time('late_threshold')->default('11:45:00');
            $table->time('checkout_time')->default('20:30:00');
            $table->string('timezone', 64)->default('Asia/Karachi');
            $table->boolean('allow_early_check_in')->default(false);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->softDeletes();
            $table->unique('organization_id');
        });
    }
};
