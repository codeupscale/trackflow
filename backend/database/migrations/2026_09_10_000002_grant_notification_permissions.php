<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Grant the three notification permissions to the existing system roles.
 *
 * PermissionSeeder produces these on a fresh install, but it DELETES and
 * recreates every system role when it runs — and `user_roles.role_id` is
 * ON DELETE CASCADE, so running it against a live database silently drops
 * every role assignment in the org. A migration is the only safe way to add a
 * permission to a database that already has people in it.
 *
 * Who gets what, and why:
 *   view               — everyone. A notification is addressed to a user, and
 *                        the API only ever returns the caller's own rows.
 *   receive_attendance — org_manager and hr_manager. They act on a late
 *                        arrival; nobody else does.
 *   receive_payroll    — finance_manager. Payroll is their job.
 *   owner              — nothing inserted. Owner bypasses the permission map in
 *                        code and holds everything by definition; giving it
 *                        rows here would be the first exception to that rule.
 *
 * Custom roles are untouched. An org that wants its own role to receive
 * check-ins can grant the key, which is the whole reason these are permissions
 * rather than a hardcoded list of role names.
 */
return new class extends Migration
{
    private const GRANTS = [
        'org_manager' => ['notifications.view', 'notifications.receive_attendance'],
        'hr_manager' => ['notifications.view', 'notifications.receive_attendance'],
        'finance_manager' => ['notifications.view', 'notifications.receive_payroll'],
        'employee' => ['notifications.view'],
    ];

    private const PERMISSIONS = [
        ['notifications.view', 'notifications', 'view', 'See your own notifications'],
        ['notifications.receive_attendance', 'notifications', 'receive_attendance', 'Be notified when employees check in'],
        ['notifications.receive_payroll', 'notifications', 'receive_payroll', 'Be notified about payroll runs and approvals'],
    ];

    public function up(): void
    {
        $now = now();

        // 1. The permission rows themselves, if this has not already run.
        foreach (self::PERMISSIONS as [$key, $module, $action, $description]) {
            if (DB::table('permissions')->where('key', $key)->exists()) {
                continue;
            }

            DB::table('permissions')->insert([
                'id' => Str::uuid()->toString(),
                'key' => $key,
                'module' => $module,
                'action' => $action,
                'description' => $description,
                'has_scope' => false,
            ]);
        }

        $permissionIds = DB::table('permissions')
            ->whereIn('key', array_column(self::PERMISSIONS, 0))
            ->pluck('id', 'key');

        // 2. Attach them to every org's system roles.
        foreach (self::GRANTS as $roleName => $keys) {
            $roleIds = DB::table('roles')
                ->where('name', $roleName)
                ->where('is_system', true)
                ->pluck('id');

            foreach ($roleIds as $roleId) {
                foreach ($keys as $key) {
                    if (! isset($permissionIds[$key])) {
                        continue;
                    }

                    // Idempotent: a re-run must not duplicate a grant, and the
                    // pivot has no unique index to lean on.
                    $exists = DB::table('role_permissions')
                        ->where('role_id', $roleId)
                        ->where('permission_id', $permissionIds[$key])
                        ->exists();

                    if ($exists) {
                        continue;
                    }

                    DB::table('role_permissions')->insert([
                        'id' => Str::uuid()->toString(),
                        'role_id' => $roleId,
                        'permission_id' => $permissionIds[$key],
                        'scope' => 'none',
                        'created_at' => $now,
                    ]);
                }
            }
        }
    }

    public function down(): void
    {
        $permissionIds = DB::table('permissions')
            ->whereIn('key', array_column(self::PERMISSIONS, 0))
            ->pluck('id');

        if ($permissionIds->isEmpty()) {
            return;
        }

        DB::table('role_permissions')->whereIn('permission_id', $permissionIds)->delete();
        DB::table('permissions')->whereIn('id', $permissionIds)->delete();
    }
};
