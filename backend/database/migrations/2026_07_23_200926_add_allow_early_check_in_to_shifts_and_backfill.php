<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Shifts become the source of check-in windows (replacing attendance_policies).
 *
 * 1. Add `allow_early_check_in` to shifts (the one policy field shifts lacked;
 *    timezone / start_time / end_time / grace_period_minutes already exist).
 * 2. Backfill existing shifts from their org's attendance_policy so behaviour is
 *    preserved when the policy table is dropped: inherit `allow_early_check_in`, and
 *    inherit `timezone` for shifts still on the 'UTC' default (the policy default was
 *    Asia/Karachi — a blind switch would otherwise silently shift every window).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('shifts', 'allow_early_check_in')) {
            Schema::table('shifts', function (Blueprint $table) {
                $table->boolean('allow_early_check_in')->default(false)->after('grace_period_minutes');
            });
        }

        if (! Schema::hasTable('attendance_policies')) {
            return; // fresh install with no legacy policies — nothing to backfill
        }

        $policies = DB::table('attendance_policies')
            ->whereNull('deleted_at')
            ->get(['organization_id', 'timezone', 'allow_early_check_in']);

        foreach ($policies as $policy) {
            // Inherit early-check-in for every shift in the org.
            DB::table('shifts')
                ->where('organization_id', $policy->organization_id)
                ->update(['allow_early_check_in' => (bool) $policy->allow_early_check_in]);

            // Inherit the policy timezone only for shifts still on the default 'UTC'
            // (don't clobber a deliberately-chosen shift timezone).
            if (! empty($policy->timezone)) {
                DB::table('shifts')
                    ->where('organization_id', $policy->organization_id)
                    ->where('timezone', 'UTC')
                    ->update(['timezone' => $policy->timezone]);
            }
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('shifts', 'allow_early_check_in')) {
            Schema::table('shifts', function (Blueprint $table) {
                $table->dropColumn('allow_early_check_in');
            });
        }
    }
};
