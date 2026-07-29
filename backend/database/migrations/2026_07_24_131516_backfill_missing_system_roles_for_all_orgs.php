<?php

use Database\Seeders\PermissionSeeder;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Backfill any MISSING system role for every organization.
 *
 * The 2026_05_13_000004 role-matrix migration renamed admin→org_manager and updated
 * employee, but never CREATED the two new roles (hr_manager, finance_manager) for orgs
 * that already existed — so pre-2026-05-13 orgs only have owner/org_manager/employee and
 * the frontend shows fewer than 5 roles. This ensures all five system roles
 * (owner, org_manager, hr_manager, finance_manager, employee) exist for every org, with
 * the same permission grants PermissionSeeder::seedRolesForOrg() gives fresh installs.
 *
 * Idempotent: an org that already has a given role is skipped, so this is safe to re-run
 * and a no-op on fresh installs (the seeder already created all five).
 */
return new class extends Migration
{
    public function up(): void
    {
        $seeder = new PermissionSeeder;
        $permissionMap = DB::table('permissions')->pluck('id', 'key')->toArray();
        $now = now();

        // Owner has NO role_permissions rows (bypass in code). Others mirror the seeder.
        $roleDefs = [
            ['name' => 'owner', 'display_name' => 'Owner', 'priority' => 100, 'is_default' => false, 'perms' => []],
            ['name' => 'org_manager', 'display_name' => 'Organization Manager', 'priority' => 75, 'is_default' => false, 'perms' => $seeder->getOrgManagerPermissions()],
            ['name' => 'hr_manager', 'display_name' => 'HR Manager', 'priority' => 65, 'is_default' => false, 'perms' => $seeder->getHrManagerPermissions()],
            ['name' => 'finance_manager', 'display_name' => 'Finance Manager', 'priority' => 60, 'is_default' => false, 'perms' => $seeder->getFinanceManagerPermissions()],
            ['name' => 'employee', 'display_name' => 'Employee / Member', 'priority' => 10, 'is_default' => true, 'perms' => $seeder->getEmployeePermissions()],
        ];

        DB::table('organizations')->select('id')->orderBy('id')->chunk(500, function ($orgs) use ($roleDefs, $permissionMap, $now) {
            foreach ($orgs as $org) {
                foreach ($roleDefs as $def) {
                    $exists = DB::table('roles')
                        ->where('organization_id', $org->id)
                        ->where('name', $def['name'])
                        ->exists();

                    if ($exists) {
                        continue;
                    }

                    $roleId = (string) Str::uuid();
                    DB::table('roles')->insert([
                        'id' => $roleId,
                        'organization_id' => $org->id,
                        'name' => $def['name'],
                        'display_name' => $def['display_name'],
                        'is_system' => true,
                        'is_default' => $def['is_default'],
                        'priority' => $def['priority'],
                        'created_at' => $now,
                        'updated_at' => $now,
                    ]);

                    // role_permissions (mirrors PermissionSeeder::insertRolePermissions).
                    $rows = [];
                    foreach ($def['perms'] as $key => $scope) {
                        if (! isset($permissionMap[$key])) {
                            continue;
                        }
                        $rows[] = [
                            'id' => (string) Str::uuid(),
                            'role_id' => $roleId,
                            'permission_id' => $permissionMap[$key],
                            'scope' => $scope,
                            'created_at' => $now,
                        ];
                    }
                    foreach (array_chunk($rows, 50) as $chunk) {
                        DB::table('role_permissions')->insert($chunk);
                    }
                }
            }
        });
    }

    public function down(): void
    {
        // Irreversible data backfill: created roles can't be reliably distinguished from
        // pre-existing ones. No-op.
    }
};
