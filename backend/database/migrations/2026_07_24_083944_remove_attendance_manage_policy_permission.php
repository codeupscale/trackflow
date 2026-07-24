<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Remove the now-orphaned `attendance.manage_policy` permission.
 *
 * Check-in windows moved from the per-org attendance_policies table to per-user shifts
 * (see 2026_07_24_073017_drop_attendance_policies_table), so the PUT /hr/attendance/policy
 * route and this permission no longer exist. Delete its role_permissions rows first, then
 * the permission itself. Mirrors the deletion half of the original seed migration
 * 2026_07_02_000003_seed_attendance_check_in_permissions.
 */
return new class extends Migration
{
    public function up(): void
    {
        $ids = DB::table('permissions')->where('key', 'attendance.manage_policy')->pluck('id');

        if ($ids->isNotEmpty()) {
            DB::table('role_permissions')->whereIn('permission_id', $ids)->delete();
            DB::table('permissions')->where('key', 'attendance.manage_policy')->delete();
        }
    }

    public function down(): void
    {
        // Re-create the permission (without role grants) for reversibility. The per-shift
        // model made it obsolete, so the historical role grants are not restored.
        DB::table('permissions')->insertOrIgnore([
            'id' => (string) Str::uuid(),
            'key' => 'attendance.manage_policy',
            'module' => 'attendance',
            'action' => 'manage_policy',
            'description' => 'Configure attendance check-in policy',
            'has_scope' => false,
        ]);
    }
};
