<?php

namespace Tests;

use App\Models\Organization;
use App\Models\Role;
use App\Models\User;
use Database\Seeders\PermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

abstract class TestCase extends BaseTestCase
{
    use RefreshDatabase;

    /**
     * System role definitions — mirrors PermissionSeeder.
     */
    private const SYSTEM_ROLES = [
        ['name' => 'owner',    'display_name' => 'Owner',    'priority' => 100, 'is_default' => false],
        ['name' => 'admin',    'display_name' => 'Admin',    'priority' => 75,  'is_default' => false],
        ['name' => 'manager',  'display_name' => 'Manager',  'priority' => 50,  'is_default' => false],
        ['name' => 'employee', 'display_name' => 'Employee', 'priority' => 10,  'is_default' => true],
    ];

    /**
     * After RefreshDatabase runs migrations, seed the permissions table.
     * Role-to-permission mappings are seeded per-org in seedSystemRoles().
     */
    protected function afterRefreshingDatabase()
    {
        $seeder = new PermissionSeeder();
        $seeder->seedPermissionsOnly();
    }

    protected function createOrganization(array $attributes = []): Organization
    {
        $org = Organization::factory()->create($attributes);
        $this->seedSystemRoles($org->id);
        return $org;
    }

    protected function createUser(Organization $org, string $role = 'employee', array $attributes = []): User
    {
        $user = User::factory()->create(array_merge([
            'organization_id' => $org->id,
            'role' => $role,
        ], $attributes));

        $this->assignUserRole($user, $org->id, $role);

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
     * Seed the 4 system roles + their role_permissions for a given organization.
     * Called automatically by createOrganization().
     */
    protected function seedSystemRoles(string $orgId): void
    {
        $seeder = new PermissionSeeder();
        $seeder->seedRolesForOrg($orgId);
    }

    /**
     * Create a user_roles entry linking the user to their system role in the org.
     * Called automatically by createUser().
     */
    protected function assignUserRole(User $user, string $orgId, string $roleName): void
    {
        $role = DB::table('roles')
            ->where('organization_id', $orgId)
            ->where('name', $roleName)
            ->where('is_system', true)
            ->first();

        if (! $role) {
            return;
        }

        // Avoid duplicate entries (idempotent)
        $exists = DB::table('user_roles')
            ->where('user_id', $user->id)
            ->where('role_id', $role->id)
            ->exists();

        if (! $exists) {
            DB::table('user_roles')->insert([
                'id'          => Str::uuid()->toString(),
                'user_id'     => $user->id,
                'role_id'     => $role->id,
                'assigned_by' => null,
                'assigned_at' => now(),
            ]);
        }
    }
}
