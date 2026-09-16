<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Grant the asset permissions to existing system roles.
 *
 * A migration, never a seeder run: PermissionSeeder deletes and recreates each
 * org's system roles, and user_roles.role_id is ON DELETE CASCADE, so running it
 * against a live database would silently drop every role assignment.
 *
 *   hr_manager                              — assets.view (organization) + assets.manage
 *   org_manager, finance_manager, employee  — assets.view (own): the items they hold
 *   owner                                   — nothing inserted; bypasses in code
 *
 * Purely additive. No existing grant is changed or removed, and custom roles are
 * untouched.
 */
return new class extends Migration
{
    private const PERMISSIONS = [
        ['assets.view', 'assets', 'view', 'See company items: the whole register, or only your own', true],
        ['assets.manage', 'assets', 'manage', 'Add company items and record hand-overs and returns', false],
    ];

    private const GRANTS = [
        'hr_manager' => ['assets.view' => 'organization', 'assets.manage' => 'none'],
        'org_manager' => ['assets.view' => 'own'],
        'finance_manager' => ['assets.view' => 'own'],
        'employee' => ['assets.view' => 'own'],
    ];

    public function up(): void
    {
        foreach (self::PERMISSIONS as [$key, $module, $action, $description, $hasScope]) {
            if (DB::table('permissions')->where('key', $key)->exists()) {
                continue;
            }

            DB::table('permissions')->insert([
                'id' => Str::uuid()->toString(),
                'key' => $key,
                'module' => $module,
                'action' => $action,
                'description' => $description,
                'has_scope' => $hasScope,
            ]);
        }

        $permissionIds = DB::table('permissions')
            ->whereIn('key', array_column(self::PERMISSIONS, 0))
            ->pluck('id', 'key');

        $now = now();

        foreach (self::GRANTS as $roleName => $grants) {
            $roleIds = DB::table('roles')->where('name', $roleName)->where('is_system', true)->pluck('id');

            foreach ($roleIds as $roleId) {
                foreach ($grants as $key => $scope) {
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
                        'scope' => $scope,
                        'created_at' => $now,
                    ]);
                }
            }
        }
    }

    public function down(): void
    {
        $ids = DB::table('permissions')->whereIn('key', array_column(self::PERMISSIONS, 0))->pluck('id');

        DB::table('role_permissions')->whereIn('permission_id', $ids)->delete();
        DB::table('permissions')->whereIn('id', $ids)->delete();
    }
};
