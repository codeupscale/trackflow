<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Add missing indexes found during N+1 and performance audit.
 *
 * Existing indexes:
 *   time_entries: (organization_id, user_id, started_at) ✓
 *   screenshots:  (organization_id, user_id, captured_at) ✓, (time_entry_id) ✓
 *   activity_logs: (organization_id, logged_at) ✓
 *
 * Missing indexes (used in WHERE/JOIN/GROUP BY but not indexed):
 */
return new class extends Migration
{
    public function up(): void
    {
        // time_entries: dashboard + reports filter by org + started_at (without user_id)
        Schema::table('time_entries', function (Blueprint $table) {
            $table->index(['organization_id', 'started_at'], 'te_org_started_idx');
        });

        // time_entries: type filter is used in every report (tracked vs idle vs manual)
        Schema::table('time_entries', function (Blueprint $table) {
            $table->index(['organization_id', 'type', 'started_at'], 'te_org_type_started_idx');
        });

        // time_entries: payroll queries filter by is_approved
        Schema::table('time_entries', function (Blueprint $table) {
            $table->index(['user_id', 'is_approved', 'started_at'], 'te_user_approved_started_idx');
        });

        // time_entries: project-based queries in reports
        Schema::table('time_entries', function (Blueprint $table) {
            $table->index(['organization_id', 'project_id', 'started_at'], 'te_org_project_started_idx');
        });

        // activity_logs: computeFinalActivityScore queries by time_entry_id
        Schema::table('activity_logs', function (Blueprint $table) {
            $table->index('time_entry_id', 'al_time_entry_idx');
        });

        // activity_logs: apps report queries by org + user + logged_at + active_app
        Schema::table('activity_logs', function (Blueprint $table) {
            $table->index(['organization_id', 'user_id', 'logged_at'], 'al_org_user_logged_idx');
        });

        // invitations: lookup by token (accept endpoint)
        Schema::table('invitations', function (Blueprint $table) {
            $table->index('token', 'inv_token_idx');
        });
    }

    public function down(): void
    {
        Schema::table('time_entries', function (Blueprint $table) {
            $table->dropIndex('te_org_started_idx');
            $table->dropIndex('te_org_type_started_idx');
            $table->dropIndex('te_user_approved_started_idx');
            $table->dropIndex('te_org_project_started_idx');
        });

        Schema::table('activity_logs', function (Blueprint $table) {
            $table->dropIndex('al_time_entry_idx');
            $table->dropIndex('al_org_user_logged_idx');
        });

        Schema::table('invitations', function (Blueprint $table) {
            $table->dropIndex('inv_token_idx');
        });
    }
};
