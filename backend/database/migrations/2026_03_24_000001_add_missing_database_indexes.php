<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Add missing indexes identified during performance audit.
 *
 * - project_user.user_id: member lookups by user
 * - timesheets: composite indexes for org+period and user+period queries
 * - screenshots.user_id: employee-scoped screenshot filtering
 * - users (organization_id, is_active): active user listing queries
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('project_user', function (Blueprint $table) {
            $table->index('user_id', 'pu_user_id_idx');
        });

        Schema::table('timesheets', function (Blueprint $table) {
            $table->index(['organization_id', 'period_start', 'period_end'], 'ts_org_period_idx');
            $table->index(['user_id', 'period_start'], 'ts_user_period_idx');
        });

        Schema::table('screenshots', function (Blueprint $table) {
            $table->index('user_id', 'ss_user_id_idx');
        });

        Schema::table('users', function (Blueprint $table) {
            $table->index(['organization_id', 'is_active'], 'usr_org_active_idx');
        });
    }

    public function down(): void
    {
        Schema::table('project_user', function (Blueprint $table) {
            $table->dropIndex('pu_user_id_idx');
        });

        Schema::table('timesheets', function (Blueprint $table) {
            $table->dropIndex('ts_org_period_idx');
            $table->dropIndex('ts_user_period_idx');
        });

        Schema::table('screenshots', function (Blueprint $table) {
            $table->dropIndex('ss_user_id_idx');
        });

        Schema::table('users', function (Blueprint $table) {
            $table->dropIndex('usr_org_active_idx');
        });
    }
};
