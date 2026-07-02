<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Data migration: insert the attendance check-in/checkout permissions and their
 * role_permissions for all existing organizations.
 *
 * Mirrors 2026_04_09_000001_seed_shifts_payroll_permissions.php.
 * Uses ON CONFLICT DO NOTHING so this is safe to re-run.
 *
 * NOTE ON ROLE NAMES: the plan maps grants to "admin / manager / employee".
 * The current system-role taxonomy is owner / org_manager / hr_manager /
 * finance_manager / employee (see PermissionSeeder), so the literal names
 * admin/manager no longer match any system role. We translate:
 *   admin   -> org_manager   (plus finance_manager: staff who also check in)
 *   manager -> hr_manager
 *   employee-> employee
 * check_in is a universal personal action, so it is granted to every non-owner
 * staff role; manage_policy is admin-only (org_manager).
 */
return new class extends Migration
{
    // New permissions to insert (key, module, action, description, has_scope)
    private array $newPermissions = [
        ['attendance.check_in',      'attendance', 'check_in',      'Check in and check out for the day',   false],
        ['attendance.manage_policy', 'attendance', 'manage_policy', 'Configure attendance check-in policy', false],
    ];

    // role name => [ permission_key => scope ]
    private array $rolePermissions = [
        'org_manager' => [
            'attendance.check_in'      => 'none',
            'attendance.manage_policy' => 'none',
        ],
        'hr_manager' => [
            'attendance.check_in' => 'none',
        ],
        'finance_manager' => [
            'attendance.check_in' => 'none',
        ],
        'employee' => [
            'attendance.check_in' => 'none',
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
