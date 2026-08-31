<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Team-scoped shift management for team managers.
 *
 * Grants shifts.create / edit / delete / manage_assignments at scope 'project'
 * (this codebase's "team" scope — see PermissionService::SCOPE_HIERARCHY, where
 * project sits below organization) to the employee role.
 *
 * Granting it role-wide is safe because BOTH gates must pass: the service also
 * requires the actor to actually manage a team (teams.manager_id). An employee
 * who manages nobody gets an empty scope and is refused, and the UI hides the
 * controls for them. Org-scoped roles are untouched — their existing 'none'
 * grants already satisfy an 'organization' requirement.
 */
return new class extends Migration
{
    private const KEYS = [
        'shifts.create',
        'shifts.edit',
        'shifts.delete',
        'shifts.manage_assignments',
    ];

    public function up(): void
    {
        $permissionIds = DB::table('permissions')
            ->whereIn('key', self::KEYS)
            ->pluck('id', 'key');

        if ($permissionIds->isEmpty()) {
            return;
        }

        $roleIds = DB::table('roles')->where('name', 'employee')->pluck('id');

        foreach ($roleIds as $roleId) {
            foreach ($permissionIds as $permissionId) {
                $exists = DB::table('role_permissions')
                    ->where('role_id', $roleId)
                    ->where('permission_id', $permissionId)
                    ->exists();

                if ($exists) {
                    continue;
                }

                // role_permissions has created_at only — no updated_at column.
                DB::table('role_permissions')->insert([
                    'id' => (string) Str::uuid(),
                    'role_id' => $roleId,
                    'permission_id' => $permissionId,
                    'scope' => 'project',
                    'created_at' => now(),
                ]);
            }
        }
    }

    public function down(): void
    {
        $permissionIds = DB::table('permissions')
            ->whereIn('key', self::KEYS)
            ->pluck('id');

        $roleIds = DB::table('roles')->where('name', 'employee')->pluck('id');

        DB::table('role_permissions')
            ->whereIn('role_id', $roleIds)
            ->whereIn('permission_id', $permissionIds)
            ->where('scope', 'project')
            ->delete();
    }
};
