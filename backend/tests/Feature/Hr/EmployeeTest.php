<?php

namespace Tests\Feature\Hr;

use App\Models\Department;
use App\Models\EmployeeProfile;
use App\Models\Position;
use Tests\TestCase;

class EmployeeTest extends TestCase
{
    // ── Directory ────────────────────────────────────────

    public function test_can_list_employees_directory(): void
    {
        $user = $this->actingAsUser('owner');

        // Create a couple more users in the same org
        $this->createUser($user->organization, 'employee');
        $this->createUser($user->organization, 'employee');

        $response = $this->getJson('/api/v1/hr/employees');

        $response->assertOk()
            ->assertJsonStructure([
                'data',
                'current_page',
                'last_page',
                'total',
            ]);

        // Owner + 2 employees = 3 users
        $this->assertEquals(3, $response->json('total'));
    }

    public function test_can_search_employees_by_name(): void
    {
        $user = $this->actingAsUser('owner');

        $this->createUser($user->organization, 'employee', ['name' => 'Alice Johnson']);
        $this->createUser($user->organization, 'employee', ['name' => 'Bob Smith']);

        $response = $this->getJson('/api/v1/hr/employees?search=Alice');

        $response->assertOk();
        $this->assertEquals(1, $response->json('total'));
        $this->assertEquals('Alice Johnson', $response->json('data.0.name'));
    }

    public function test_can_filter_employees_by_department(): void
    {
        $user = $this->actingAsUser('owner');

        $dept = Department::factory()->create([
            'organization_id' => $user->organization_id,
        ]);

        $emp1 = $this->createUser($user->organization, 'employee');
        $emp2 = $this->createUser($user->organization, 'employee');

        EmployeeProfile::factory()->create([
            'organization_id' => $user->organization_id,
            'user_id' => $emp1->id,
            'department_id' => $dept->id,
        ]);

        EmployeeProfile::factory()->create([
            'organization_id' => $user->organization_id,
            'user_id' => $emp2->id,
            'department_id' => null,
        ]);

        $response = $this->getJson("/api/v1/hr/employees?department_id={$dept->id}");

        $response->assertOk();
        $this->assertEquals(1, $response->json('total'));
    }

    // ── Show Profile ────────────────────────────────────

    public function test_can_view_employee_profile(): void
    {
        $user = $this->actingAsUser('owner');

        $employee = $this->createUser($user->organization, 'employee');

        $response = $this->getJson("/api/v1/hr/employees/{$employee->id}");

        $response->assertOk()
            ->assertJsonStructure([
                'data' => [
                    'id',
                    'user_id',
                    'employee_id',
                    'employment_status',
                    'employment_type',
                    'user',
                ],
            ]);
    }

    public function test_financial_fields_masked_for_non_admin(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');

        EmployeeProfile::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'bank_account_number' => '1234567890',
            'tax_id' => '999-88-7777',
        ]);

        $this->actingAs($employee, 'sanctum');

        $response = $this->getJson("/api/v1/hr/employees/{$employee->id}");

        $response->assertOk();

        $data = $response->json('data');
        $this->assertEquals('****7890', $data['bank_account_number']);
        $this->assertEquals('****7777', $data['tax_id']);
    }

    public function test_admin_sees_full_financial_fields(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'admin');
        $employee = $this->createUser($org, 'employee');

        EmployeeProfile::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'bank_account_number' => '1234567890',
            'tax_id' => '999-88-7777',
        ]);

        $this->actingAs($admin, 'sanctum');

        $response = $this->getJson("/api/v1/hr/employees/{$employee->id}");

        $response->assertOk();

        $data = $response->json('data');
        $this->assertEquals('1234567890', $data['bank_account_number']);
        $this->assertEquals('999-88-7777', $data['tax_id']);
    }

    // ── Update Profile ──────────────────────────────────

    public function test_employee_can_update_own_personal_fields(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');

        EmployeeProfile::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
        ]);

        $this->actingAs($employee, 'sanctum');

        $response = $this->putJson("/api/v1/hr/employees/{$employee->id}/profile", [
            'blood_group' => 'O+',
            'marital_status' => 'single',
            'emergency_contact_name' => 'Jane Doe',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.blood_group', 'O+')
            ->assertJsonPath('data.marital_status', 'single')
            ->assertJsonPath('data.emergency_contact_name', 'Jane Doe');
    }

    public function test_employee_cannot_update_department(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');

        $dept = Department::factory()->create([
            'organization_id' => $org->id,
        ]);

        EmployeeProfile::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'department_id' => null,
        ]);

        $this->actingAs($employee, 'sanctum');

        $response = $this->putJson("/api/v1/hr/employees/{$employee->id}/profile", [
            'department_id' => $dept->id,
            'blood_group' => 'A+',
        ]);

        // Request succeeds but department_id is stripped by validation (not in employee rules)
        $response->assertOk()
            ->assertJsonPath('data.blood_group', 'A+');

        // department_id should NOT have been updated
        $this->assertDatabaseHas('employee_profiles', [
            'user_id' => $employee->id,
            'department_id' => null,
        ]);
    }

    public function test_admin_can_update_all_fields(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'admin');
        $employee = $this->createUser($org, 'employee');

        $dept = Department::factory()->create([
            'organization_id' => $org->id,
        ]);

        $position = Position::factory()->create([
            'organization_id' => $org->id,
            'department_id' => $dept->id,
        ]);

        EmployeeProfile::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
        ]);

        $this->actingAs($admin, 'sanctum');

        $response = $this->putJson("/api/v1/hr/employees/{$employee->id}/profile", [
            'department_id' => $dept->id,
            'position_id' => $position->id,
            'employment_status' => 'probation',
            'blood_group' => 'B+',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.department_id', $dept->id)
            ->assertJsonPath('data.position_id', $position->id)
            ->assertJsonPath('data.employment_status', 'probation')
            ->assertJsonPath('data.blood_group', 'B+');
    }

    // ── Cross-Org Isolation ─────────────────────────────

    public function test_cross_org_isolation(): void
    {
        $orgA = $this->createOrganization();
        $orgB = $this->createOrganization();

        $userA = $this->createUser($orgA, 'owner');
        $userB = $this->createUser($orgB, 'employee');

        $this->actingAs($userA, 'sanctum');

        // User A should not see user B in directory
        $response = $this->getJson('/api/v1/hr/employees');
        $response->assertOk();
        $ids = collect($response->json('data'))->pluck('id')->toArray();
        $this->assertNotContains($userB->id, $ids);

        // User A should get 404 trying to view user B's profile
        $response = $this->getJson("/api/v1/hr/employees/{$userB->id}");
        $response->assertStatus(404);
    }
}
