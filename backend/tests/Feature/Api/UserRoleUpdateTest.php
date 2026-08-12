<?php

namespace Tests\Feature\Api;

use App\Models\Organization;
use App\Models\Role;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * PATCH /api/v1/users/{id} — role changes.
 *
 * The rule used to be a hardcoded `in:owner,admin,manager,employee`, which named two
 * roles migration 2026_05_13_000004 retired and omitted the three current ones. HR,
 * Finance and Organization Manager could not be assigned through this endpoint at all.
 */
class UserRoleUpdateTest extends TestCase
{
    private Organization $org;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->org = $this->createOrganization();
        $this->owner = $this->createUser($this->org, 'owner');
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function currentSystemRoles(): array
    {
        return [
            'org_manager' => ['org_manager'],
            'hr_manager' => ['hr_manager'],
            'finance_manager' => ['finance_manager'],
            'employee' => ['employee'],
        ];
    }

    #[DataProvider('currentSystemRoles')]
    public function test_every_current_system_role_can_be_assigned(string $roleName): void
    {
        $target = $this->createUser($this->org, 'employee');
        $this->actingAs($this->owner, 'sanctum');

        $response = $this->putJson("/api/v1/users/{$target->id}", ['role' => $roleName]);

        $response->assertOk();
        $this->assertSame($roleName, $target->fresh()->getRawOriginal('role'));
    }

    public function test_role_change_syncs_the_user_roles_pivot(): void
    {
        $target = $this->createUser($this->org, 'employee');
        $this->actingAs($this->owner, 'sanctum');

        $this->putJson("/api/v1/users/{$target->id}", ['role' => 'hr_manager'])->assertOk();

        $assigned = DB::table('user_roles')
            ->join('roles', 'roles.id', '=', 'user_roles.role_id')
            ->where('user_roles.user_id', $target->id)
            ->pluck('roles.name')
            ->all();

        $this->assertSame(['hr_manager'], $assigned);
    }

    public function test_a_retired_role_name_is_rejected(): void
    {
        $target = $this->createUser($this->org, 'employee');
        $this->actingAs($this->owner, 'sanctum');

        // 'admin' and 'manager' were consolidated into 'org_manager'. Accepting either
        // would write a string that resolves to NO system role, leaving the account
        // with an empty permission map — it signs in and sees nothing.
        foreach (['admin', 'manager'] as $retired) {
            $this->putJson("/api/v1/users/{$target->id}", ['role' => $retired])
                ->assertStatus(422)
                ->assertJsonPath('errors.role.0', 'The selected role does not exist in your organization.');
        }

        $this->assertSame('employee', $target->fresh()->getRawOriginal('role'));
    }

    public function test_an_unknown_role_is_rejected(): void
    {
        $target = $this->createUser($this->org, 'employee');
        $this->actingAs($this->owner, 'sanctum');

        $this->putJson("/api/v1/users/{$target->id}", ['role' => 'wizard'])
            ->assertStatus(422);

        $this->assertSame('employee', $target->fresh()->getRawOriginal('role'));
    }

    public function test_a_custom_org_role_can_be_assigned(): void
    {
        $custom = Role::create([
            'organization_id' => $this->org->id,
            'name' => 'auditor',
            'display_name' => 'Auditor',
            'is_system' => false,
            'is_default' => false,
            'priority' => 20,
        ]);

        $target = $this->createUser($this->org, 'employee');
        $this->actingAs($this->owner, 'sanctum');

        $this->putJson("/api/v1/users/{$target->id}", ['role' => $custom->name])->assertOk();

        $this->assertSame('auditor', $target->fresh()->getRawOriginal('role'));
    }

    public function test_a_role_from_another_organization_is_rejected(): void
    {
        $otherOrg = $this->createOrganization();
        Role::create([
            'organization_id' => $otherOrg->id,
            'name' => 'outsider',
            'display_name' => 'Outsider',
            'is_system' => false,
            'is_default' => false,
            'priority' => 20,
        ]);

        $target = $this->createUser($this->org, 'employee');
        $this->actingAs($this->owner, 'sanctum');

        $this->putJson("/api/v1/users/{$target->id}", ['role' => 'outsider'])
            ->assertStatus(422);

        $this->assertSame('employee', $target->fresh()->getRawOriginal('role'));
    }

    public function test_a_non_owner_cannot_promote_anyone_to_owner(): void
    {
        $orgManager = $this->createUser($this->org, 'org_manager');
        $target = $this->createUser($this->org, 'employee');

        // Grant roles.edit so the request clears the manageRoles policy and actually
        // reaches the owner guard — otherwise this would assert a 403 raised one layer
        // earlier and prove nothing about the guard under test.
        $this->grantPermissionToRole('org_manager', 'roles.edit');

        $this->actingAs($orgManager, 'sanctum');

        $this->putJson("/api/v1/users/{$target->id}", ['role' => 'owner'])
            ->assertStatus(403)
            ->assertJsonPath('message', 'Only owners can assign the owner role.');

        $this->assertSame('employee', $target->fresh()->getRawOriginal('role'));
    }

    public function test_a_non_owner_with_roles_edit_can_still_assign_a_lesser_role(): void
    {
        $orgManager = $this->createUser($this->org, 'org_manager');
        $target = $this->createUser($this->org, 'employee');

        $this->grantPermissionToRole('org_manager', 'roles.edit');

        $this->actingAs($orgManager, 'sanctum');

        $this->putJson("/api/v1/users/{$target->id}", ['role' => 'hr_manager'])->assertOk();

        $this->assertSame('hr_manager', $target->fresh()->getRawOriginal('role'));
    }

    public function test_an_owner_can_grant_the_owner_role(): void
    {
        $target = $this->createUser($this->org, 'employee');
        $this->actingAs($this->owner, 'sanctum');

        $this->putJson("/api/v1/users/{$target->id}", ['role' => 'owner'])->assertOk();

        $this->assertSame('owner', $target->fresh()->getRawOriginal('role'));
    }

    public function test_updating_other_fields_does_not_require_a_role(): void
    {
        $target = $this->createUser($this->org, 'employee');
        $this->actingAs($this->owner, 'sanctum');

        $this->putJson("/api/v1/users/{$target->id}", ['name' => 'Renamed'])->assertOk();

        $fresh = $target->fresh();
        $this->assertSame('Renamed', $fresh->name);
        $this->assertSame('employee', $fresh->getRawOriginal('role'));
    }

    /**
     * Attach a permission to one of this org's system roles at organization scope.
     */
    private function grantPermissionToRole(string $roleName, string $permissionKey): void
    {
        $roleId = Role::where('organization_id', $this->org->id)
            ->where('name', $roleName)
            ->value('id');

        $permissionId = DB::table('permissions')->where('key', $permissionKey)->value('id');

        DB::table('role_permissions')->updateOrInsert(
            ['role_id' => $roleId, 'permission_id' => $permissionId],
            ['id' => (string) Str::uuid(), 'scope' => 'organization']
        );
    }
}
