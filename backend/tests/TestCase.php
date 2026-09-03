<?php

namespace Tests;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

abstract class TestCase extends BaseTestCase
{
    use RefreshDatabase;

    /**
     * Whether permissions have been seeded in this test run.
     * Reset per-test by RefreshDatabase.
     */
    private bool $permissionsSeeded = false;

    protected function setUp(): void
    {
        parent::setUp();

        // The array cache store backs the throttle middleware and lives for the
        // whole PHPUnit process, so hit counters survive RefreshDatabase and leak
        // between tests. Auth is limited to 10/min, which any suite that logs in
        // more than ten times exhausts — turning later assertions into 429s.
        Cache::flush();
    }

    /**
     * Permission key -> id map, populated by seedPermissions().
     */
    private array $permissionMap = [];

    protected function createOrganization(array $attributes = []): Organization
    {
        $org = Organization::factory()->create($attributes);
        $this->ensurePermissionsSeeded();
        $this->createSystemRolesForOrg($org->id);
        return $org;
    }

    protected function createUser(Organization $org, string $role = 'employee', array $attributes = []): User
    {
        $user = User::factory()->create(array_merge([
            'organization_id' => $org->id,
            'role' => $role,
        ], $attributes));

        $this->assignUserRole($user->id, $org->id, $role);

        return $user;
    }

    protected function actingAsUser(string $role = 'owner', ?Organization $org = null): User
    {
        $org = $org ?? $this->createOrganization();
        $user = $this->createUser($org, $role);
        $this->actingAs($user, 'sanctum');
        return $user;
    }

    /**
     * Grant one permission to a user's system role, at the given scope.
     *
     * For cases that exercise a scope the default role no longer carries — an
     * employee reading an own-scope report, say. Asserting the SCOPE narrows
     * correctly and asserting a ROLE holds the key are different tests; this
     * keeps the first from silently disappearing when the second changes.
     */
    protected function grantPermission(User $user, string $key, string $scope = 'none'): void
    {
        $this->ensurePermissionsSeeded();

        $roleId = DB::table('user_roles')->where('user_id', $user->id)->value('role_id');
        $permissionId = $this->permissionMap[$key] ?? null;

        if (! $roleId || ! $permissionId) {
            return;
        }

        DB::table('role_permissions')->updateOrInsert(
            ['role_id' => $roleId, 'permission_id' => $permissionId],
            ['id' => Str::uuid()->toString(), 'scope' => $scope, 'created_at' => now()],
        );
    }

    // -- Private RBAC helpers --

    /**
     * Seed all permission rows exactly once per test.
     */
    private function ensurePermissionsSeeded(): void
    {
        if ($this->permissionsSeeded) {
            return;
        }

        $this->permissionsSeeded = true;
        $this->permissionMap = [];

        $permissions = (new \Database\Seeders\PermissionSeeder)->getPermissions();

        foreach ($permissions as [$key, $module, $action, $description, $hasScope]) {
            $id = Str::uuid()->toString();
            // insertOrIgnore handles the case where a data migration already
            // seeded this permission row (e.g. seed_shifts_payroll_permissions).
            DB::table('permissions')->insertOrIgnore([
                'id'          => $id,
                'key'         => $key,
                'module'      => $module,
                'action'      => $action,
                'description' => $description,
                'has_scope'   => $hasScope,
            ]);
            // Read back the real ID — may differ from $id if the row pre-existed.
            $this->permissionMap[$key] = DB::table('permissions')->where('key', $key)->value('id');
        }
    }

    /**
     * Create 4 system roles for an org and assign their permissions.
     */
    private function createSystemRolesForOrg(string $orgId): void
    {
        $seeder = new \Database\Seeders\PermissionSeeder;
        $now = now();

        $roleDefinitions = [
            ['name' => 'owner',           'display_name' => 'Owner',                'priority' => 100, 'is_default' => false],
            ['name' => 'org_manager',     'display_name' => 'Organization Manager', 'priority' => 75,  'is_default' => false],
            ['name' => 'hr_manager',      'display_name' => 'HR Manager',           'priority' => 65,  'is_default' => false],
            ['name' => 'finance_manager', 'display_name' => 'Finance Manager',      'priority' => 60,  'is_default' => false],
            ['name' => 'employee',        'display_name' => 'Employee / Member',    'priority' => 10,  'is_default' => true],
        ];

        $orgRoleIds = [];

        foreach ($roleDefinitions as $def) {
            $roleId = Str::uuid()->toString();
            DB::table('roles')->insert([
                'id'              => $roleId,
                'organization_id' => $orgId,
                'name'            => $def['name'],
                'display_name'    => $def['display_name'],
                'is_system'       => true,
                'is_default'      => $def['is_default'],
                'priority'        => $def['priority'],
                'created_at'      => $now,
                'updated_at'      => $now,
            ]);
            $orgRoleIds[$def['name']] = $roleId;
        }

        // Assign permissions to roles
        $this->insertRolePermissions($orgRoleIds['org_manager'],     $seeder->getOrgManagerPermissions(),     $this->permissionMap);
        $this->insertRolePermissions($orgRoleIds['hr_manager'],      $seeder->getHrManagerPermissions(),      $this->permissionMap);
        $this->insertRolePermissions($orgRoleIds['finance_manager'], $seeder->getFinanceManagerPermissions(), $this->permissionMap);
        $this->insertRolePermissions($orgRoleIds['employee'],        $seeder->getEmployeePermissions(),       $this->permissionMap);
        // owner: no role_permissions rows (PermissionService handles by priority >= 100)
    }

    /**
     * Insert a user_roles row linking a user to their system role.
     */
    private function assignUserRole(string $userId, string $orgId, string $roleName): void
    {
        $role = DB::table('roles')
            ->where('organization_id', $orgId)
            ->where('name', $roleName)
            ->where('is_system', true)
            ->first();

        if (! $role) {
            return; // Role not found -- fallback to column-based check
        }

        DB::table('user_roles')->insert([
            'id'          => Str::uuid()->toString(),
            'user_id'     => $userId,
            'role_id'     => $role->id,
            'assigned_by' => null,
            'assigned_at' => now(),
        ]);
    }

    /**
     * Bulk-insert role_permissions rows.
     */
    private function insertRolePermissions(string $roleId, array $permScopes, array $permissionMap): void
    {
        $rows = [];
        $now  = now();

        foreach ($permScopes as $key => $scope) {
            if (! isset($permissionMap[$key])) {
                continue;
            }
            $rows[] = [
                'id'            => Str::uuid()->toString(),
                'role_id'       => $roleId,
                'permission_id' => $permissionMap[$key],
                'scope'         => $scope,
                'created_at'    => $now,
            ];
        }

        foreach (array_chunk($rows, 50) as $chunk) {
            DB::table('role_permissions')->insert($chunk);
        }
    }
}
