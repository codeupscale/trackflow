<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Data migration: insert the job_postings permissions and their role_permissions
 * for all existing organizations.
 *
 * Mirrors 2026_07_02_000003_seed_attendance_check_in_permissions.php.
 * Purely additive and guarded by ON CONFLICT DO NOTHING, so it is safe to
 * re-run and — unlike running PermissionSeeder on its own — it never deletes
 * or recreates roles, and therefore never drops user_roles assignments.
 *
 * WHY THIS IS REQUIRED, NOT OPTIONAL: PermissionService::buildPermissionMap
 * grants an owner `Permission::all()` — read from the permissions TABLE. If
 * these rows do not exist, even the owner holds none of them and every
 * job-postings route 403s. Creating the table is not enough to enable the
 * feature; the permission rows are what switch it on.
 *
 * Role mapping matches PermissionSeeder exactly, so migration-upgraded orgs do
 * not drift from fresh installs:
 *   org_manager     -> full control including publish
 *   hr_manager      -> full control including publish (HR owns hiring)
 *   finance_manager -> view + view_salary (compensation visibility only)
 *   employee        -> nothing
 * Owner is bypass-only in PermissionSeeder (no explicit role_permissions rows),
 * so it is intentionally not granted here — step 1 alone is what serves it.
 */
return new class extends Migration
{
    // key, module, action, description, has_scope
    private array $newPermissions = [
        ['job_postings.view',        'job_postings', 'view',        'View job posting list',                             false],
        ['job_postings.create',      'job_postings', 'create',      'Create new job postings',                           false],
        ['job_postings.edit',        'job_postings', 'edit',        'Edit job posting details',                          false],
        ['job_postings.delete',      'job_postings', 'delete',      'Delete job postings',                               false],
        ['job_postings.publish',     'job_postings', 'publish',     'Publish or unpublish postings to the careers page', false],
        ['job_postings.view_salary', 'job_postings', 'view_salary', 'View min/max salary encrypted fields',              false],
    ];

    // role name => [ permission_key => scope ]
    private array $rolePermissions = [
        'org_manager' => [
            'job_postings.view'        => 'none',
            'job_postings.create'      => 'none',
            'job_postings.edit'        => 'none',
            'job_postings.delete'      => 'none',
            'job_postings.publish'     => 'none',
            'job_postings.view_salary' => 'none',
        ],
        'hr_manager' => [
            'job_postings.view'        => 'none',
            'job_postings.create'      => 'none',
            'job_postings.edit'        => 'none',
            'job_postings.delete'      => 'none',
            'job_postings.publish'     => 'none',
            'job_postings.view_salary' => 'none',
        ],
        'finance_manager' => [
            'job_postings.view'        => 'none',
            'job_postings.view_salary' => 'none',
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
                        'id' => $id,
                        'key' => $key,
                        'module' => $module,
                        'action' => $action,
                        'description' => $description,
                        'has_scope' => $hasScope,
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
                                'id' => Str::uuid()->toString(),
                                'role_id' => $role->id,
                                'permission_id' => $permId,
                                'scope' => $scope,
                                'created_at' => $now,
                            ]);
                        }
                    }
                }
            }
        });

        // Permission maps are cached per user (permissions:user:{id}); without
        // this, already-signed-in users keep the old map until the TTL expires
        // and see a tab they cannot use.
        try {
            \Illuminate\Support\Facades\Cache::flush();
        } catch (\Throwable) {
            // Cache driver unavailable during migrate — not fatal.
        }
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
