<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Data migration: insert missing shifts.* and payroll.* permissions and their
 * role_permissions for all existing organizations.
 *
 * Uses ON CONFLICT DO NOTHING so this is safe to re-run.
 */
return new class extends Migration
{
    // New permissions to insert (key, module, action, description, has_scope)
    private array $newPermissions = [
        ['payroll.view_own',          'payroll', 'view_own',          'View own payslips',                              false],
        ['payroll.view_team',         'payroll', 'view_team',         'View direct reports payslips',                   false],
        ['payroll.view_all',          'payroll', 'view_all',          'View all payroll data',                          false],
        ['payroll.run',               'payroll', 'run',               'Run payroll for a period',                       false],
        ['payroll.manage_structures', 'payroll', 'manage_structures', 'Create and edit salary structures',              false],
        ['payroll.manage_components', 'payroll', 'manage_components', 'Manage pay components (allowances, deductions)', false],
        ['payroll.approve',           'payroll', 'approve',           'Approve and finalize payslips',                  false],
        ['shifts.view',               'shifts',  'view',              'View shifts and roster',                         false],
        ['shifts.create',             'shifts',  'create',            'Create new shifts',                              false],
        ['shifts.edit',               'shifts',  'edit',              'Edit shift details',                             false],
        ['shifts.delete',             'shifts',  'delete',            'Delete shifts',                                  false],
        ['shifts.manage_assignments', 'shifts',  'manage_assignments','Assign and unassign users to shifts',            false],
        ['shifts.manage_swaps',       'shifts',  'manage_swaps',      'Approve or reject shift swap requests',          false],
    ];

    // role name => [ permission_key => scope ]
    private array $rolePermissions = [
        'admin' => [
            'payroll.view_own'          => 'none',
            'payroll.view_team'         => 'none',
            'payroll.view_all'          => 'none',
            'payroll.run'               => 'none',
            'payroll.manage_structures' => 'none',
            'payroll.manage_components' => 'none',
            'payroll.approve'           => 'none',
            'shifts.view'               => 'none',
            'shifts.create'             => 'none',
            'shifts.edit'               => 'none',
            'shifts.delete'             => 'none',
            'shifts.manage_assignments' => 'none',
            'shifts.manage_swaps'       => 'none',
        ],
        'manager' => [
            'payroll.view_own'          => 'none',
            'payroll.view_team'         => 'none',
            'shifts.view'               => 'none',
            'shifts.manage_assignments' => 'none',
            'shifts.manage_swaps'       => 'none',
        ],
        'employee' => [
            'payroll.view_own' => 'none',
            'shifts.view'      => 'none',
        ],
    ];

    public function up(): void
    {
        DB::transaction(function () {
            $now = now();
            $isPostgres = DB::getDriverName() === 'pgsql';

            // ── Step 1: Insert missing permissions ────────────────────────────
            $permissionMap = []; // key => id

            foreach ($this->newPermissions as [$key, $module, $action, $description, $hasScope]) {
                // Check if permission already exists
                $existing = DB::table('permissions')->where('key', $key)->first();

                if ($existing) {
                    $permissionMap[$key] = $existing->id;
                    continue;
                }

                $id = Str::uuid()->toString();

                if ($isPostgres) {
                    DB::statement(
                        'INSERT INTO permissions (id, key, module, action, description, has_scope)
                         VALUES (?, ?, ?, ?, ?, ?)
                         ON CONFLICT (key) DO NOTHING',
                        [$id, $key, $module, $action, $description, $hasScope]
                    );
                } else {
                    DB::table('permissions')->insertOrIgnore([
                        'id'          => $id,
                        'key'         => $key,
                        'module'      => $module,
                        'action'      => $action,
                        'description' => $description,
                        'has_scope'   => $hasScope,
                    ]);
                }

                // Re-fetch in case of conflict (another process inserted first)
                $permissionMap[$key] = DB::table('permissions')->where('key', $key)->value('id');
            }

            // ── Step 2: For each org, assign permissions to system roles ──────
            $organizations = DB::table('organizations')->select('id')->get();

            foreach ($organizations as $org) {
                foreach ($this->rolePermissions as $roleName => $perms) {
                    $role = DB::table('roles')
                        ->where('organization_id', $org->id)
                        ->where('name', $roleName)
                        ->where('is_system', true)
                        ->first();

                    if (! $role) {
                        continue;
                    }

                    foreach ($perms as $permKey => $scope) {
                        $permId = $permissionMap[$permKey] ?? null;
                        if (! $permId) {
                            continue;
                        }

                        // Check if role_permission already exists
                        $exists = DB::table('role_permissions')
                            ->where('role_id', $role->id)
                            ->where('permission_id', $permId)
                            ->exists();

                        if ($exists) {
                            continue;
                        }

                        if ($isPostgres) {
                            DB::statement(
                                'INSERT INTO role_permissions (id, role_id, permission_id, scope, created_at)
                                 VALUES (?, ?, ?, ?, ?)
                                 ON CONFLICT (role_id, permission_id) DO NOTHING',
                                [Str::uuid()->toString(), $role->id, $permId, $scope, $now]
                            );
                        } else {
                            DB::table('role_permissions')->insertOrIgnore([
                                'id'            => Str::uuid()->toString(),
                                'role_id'       => $role->id,
                                'permission_id' => $permId,
                                'scope'         => $scope,
                                'created_at'    => $now,
                            ]);
                        }
                    }
                }
            }
        });
    }

    public function down(): void
    {
        $keys = array_column($this->newPermissions, 0);

        $permissionIds = DB::table('permissions')
            ->whereIn('key', $keys)
            ->pluck('id');

        DB::table('role_permissions')->whereIn('permission_id', $permissionIds)->delete();
        DB::table('permissions')->whereIn('key', $keys)->delete();
    }
};
