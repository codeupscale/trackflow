<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Take the Reports section off the employee role.
 *
 * Employees held reports.view/export at 'own' scope, so the section only ever
 * showed them their own hours — the same numbers already on the dashboard, in
 * Time Entries and in My Attendance. It was a fourth door onto one set of
 * figures, and org-wide roles are the ones reporting is actually for.
 *
 * Revoked rather than hidden in the sidebar: the nav filters on key presence,
 * which gates a menu and nothing else. With the permission gone the API refuses
 * the request too (routes/api.php guards the whole prefix with
 * permission:reports.view), so a bookmark cannot walk around the menu.
 *
 * Every other role keeps reports at 'organization' scope and is untouched.
 */
return new class extends Migration
{
    private const KEYS = [
        'reports.view',
        'reports.export',
    ];

    public function up(): void
    {
        $permissionIds = DB::table('permissions')->whereIn('key', self::KEYS)->pluck('id');
        $roleIds = DB::table('roles')->where('name', 'employee')->pluck('id');

        if ($permissionIds->isEmpty() || $roleIds->isEmpty()) {
            return;
        }

        DB::table('role_permissions')
            ->whereIn('role_id', $roleIds)
            ->whereIn('permission_id', $permissionIds)
            ->delete();
    }

    public function down(): void
    {
        // Restores the previous grant so the change is reversible on a rollback.
        $permissions = DB::table('permissions')->whereIn('key', self::KEYS)->pluck('id', 'key');
        $roleIds = DB::table('roles')->where('name', 'employee')->pluck('id');

        foreach ($roleIds as $roleId) {
            foreach ($permissions as $permissionId) {
                DB::table('role_permissions')->insertOrIgnore([
                    'id' => (string) \Illuminate\Support\Str::uuid(),
                    'role_id' => $roleId,
                    'permission_id' => $permissionId,
                    'scope' => 'own',
                    'created_at' => now(),
                ]);
            }
        }
    }
};
