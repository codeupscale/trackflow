<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Adds the check-in / checkout session columns to attendance_records so a
 * single daily record can also carry the live check-in state.
 *
 * The partial index idx_ar_open_sessions makes the "find the open session for
 * this user" lookup (checkout + the missing-checkout backstop) an index-only
 * probe instead of a scan of the day's rows.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('attendance_records', function (Blueprint $table) {
            // last_seen is the closest existing column; on PostgreSQL the after()
            // modifier is a no-op but is kept to document intent.
            $table->timestamp('check_in_at')->nullable()->after('last_seen');
            $table->timestamp('check_out_at')->nullable()->after('check_in_at');
            $table->integer('worked_seconds')->nullable()->after('check_out_at');
            $table->string('check_in_status', 20)->nullable()->after('worked_seconds'); // on_time | late
            $table->integer('check_in_late_minutes')->default(0)->after('check_in_status');
            $table->integer('check_out_early_minutes')->default(0)->after('check_in_late_minutes');
            $table->integer('check_out_overtime_minutes')->default(0)->after('check_out_early_minutes');
            $table->boolean('is_early_checkout')->default(false)->after('check_out_overtime_minutes');
            $table->boolean('missing_checkout')->default(false)->after('is_early_checkout');
            $table->jsonb('check_in_flags')->nullable()->after('missing_checkout');
        });

        // Partial index: only rows with an open session (checked in, not yet out,
        // not soft-deleted). Raw statement because Laravel's schema builder cannot
        // express a partial (WHERE) index portably.
        DB::statement(
            'CREATE INDEX idx_ar_open_sessions ON attendance_records '
            .'(organization_id, user_id, check_in_at) '
            .'WHERE check_in_at IS NOT NULL AND check_out_at IS NULL AND deleted_at IS NULL'
        );
    }

    public function down(): void
    {
        // Drop the raw partial index first so the column drop is clean on Postgres.
        DB::statement('DROP INDEX IF EXISTS idx_ar_open_sessions');

        Schema::table('attendance_records', function (Blueprint $table) {
            $table->dropColumn([
                'check_in_at',
                'check_out_at',
                'worked_seconds',
                'check_in_status',
                'check_in_late_minutes',
                'check_out_early_minutes',
                'check_out_overtime_minutes',
                'is_early_checkout',
                'missing_checkout',
                'check_in_flags',
            ]);
        });
    }
};
