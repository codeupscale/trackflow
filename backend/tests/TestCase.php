<?php

namespace Tests;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
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
            DB::table('permissions')->insert([
                'id'          => $id,
                'key'         => $key,
                'module'      => $module,
                'action'      => $action,
                'description' => $description,
                'has_scope'   => $hasScope,
            ]);
            $this->permissionMap[$key] = $id;
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
            ['name' => 'owner',    'display_name' => 'Owner',    'priority' => 100, 'is_default' => false],
            ['name' => 'admin',    'display_name' => 'Admin',    'priority' => 75,  'is_default' => false],
            ['name' => 'manager',  'display_name' => 'Manager',  'priority' => 50,  'is_default' => false],
            ['name' => 'employee', 'display_name' => 'Employee', 'priority' => 10,  'is_default' => true],
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
        $this->insertRolePermissions($orgRoleIds['admin'],    $seeder->getAdminPermissions(),    $this->permissionMap);
        $this->insertRolePermissions($orgRoleIds['manager'],  $seeder->getManagerPermissions(),  $this->permissionMap);
        $this->insertRolePermissions($orgRoleIds['employee'], $seeder->getEmployeePermissions(), $this->permissionMap);
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
