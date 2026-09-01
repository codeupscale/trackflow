<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Day-completion snapshot for the check-in report's "Full Days" column.
 *
 * `required_day_seconds` records the requirement that applied to THAT day
 * (shift length minus grace, or the org fallback), and `met_required_hours`
 * records whether the day's presence reached it.
 *
 * Snapshotting rather than recomputing at read time is deliberate: shifts
 * change. Moving someone from a 9-hour to an 8-hour shift in March must not
 * silently re-judge their January against the new rule — a compliance report
 * has to reflect the rule that was actually in force on the day.
 *
 * Both are nullable: a day with no completed checkout has nothing to judge yet,
 * and null is distinct from "failed".
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('attendance_records', function (Blueprint $table) {
            $table->integer('required_day_seconds')->nullable()->after('worked_seconds');
            $table->boolean('met_required_hours')->nullable()->after('required_day_seconds');
        });

        // Partial index backing the report's SUM(CASE WHEN met_required_hours …)
        // over an org + date window.
        Schema::table('attendance_records', function (Blueprint $table) {
            $table->index(
                ['organization_id', 'date', 'met_required_hours'],
                'idx_ar_org_date_met'
            );
        });
    }

    public function down(): void
    {
        Schema::table('attendance_records', function (Blueprint $table) {
            $table->dropIndex('idx_ar_org_date_met');
            $table->dropColumn(['required_day_seconds', 'met_required_hours']);
        });
    }
};
