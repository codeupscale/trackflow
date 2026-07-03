<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds sessions_count to attendance_records for the multi-session check-in
 * redesign (Module 3.1). Sessions are promoted to the check_in_sessions child
 * table; this denormalized counter lets list/summary views know how many
 * check-in/checkout pairs a day's record has without a join.
 *
 * Backfilled to 1 for existing single-pair rows by the companion migration
 * 2026_07_03_000002_create_check_in_sessions_table (which runs after this one
 * per the filename timestamp ordering).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('attendance_records', function (Blueprint $table) {
            // after() is a no-op on PostgreSQL but is kept to document intent.
            $table->unsignedInteger('sessions_count')->default(0)->after('missing_checkout');
        });
    }

    public function down(): void
    {
        Schema::table('attendance_records', function (Blueprint $table) {
            $table->dropColumn('sessions_count');
        });
    }
};
