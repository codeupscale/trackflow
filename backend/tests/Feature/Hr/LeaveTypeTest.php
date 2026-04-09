<?php

namespace Tests\Feature\Hr;

use App\Models\LeaveType;
use Tests\TestCase;

class LeaveTypeTest extends TestCase
{
    // ── Index ────────────────────────────────────────────

    public function test_can_list_active_leave_types(): void
    {
        // Employees only see active types (apply-leave dropdown use case)
        $user = $this->actingAsUser('employee');

        LeaveType::factory()->count(2)->create([
            'organization_id' => $user->organization_id,
            'is_active' => true,
        ]);

        LeaveType::factory()->create([
            'organization_id' => $user->organization_id,
            'is_active' => false,
        ]);

        $response = $this->getJson('/api/v1/hr/leave-types');

        $response->assertOk()
            ->assertJsonStructure([
                'data' => [['id', 'name', 'code', 'type', 'days_per_year', 'accrual_method', 'max_carry_over']],
                'current_page',
                'last_page',
                'total',
            ]);

        // Employees see only the 2 active leave types
        $this->assertCount(2, $response->json('data'));
    }

    public function test_admin_can_list_all_leave_types_including_inactive(): void
    {
        // Admins see all types (management page use case)
        $user = $this->actingAsUser('admin');

        LeaveType::factory()->count(2)->create([
            'organization_id' => $user->organization_id,
            'is_active' => true,
        ]);

        LeaveType::factory()->create([
            'organization_id' => $user->organization_id,
            'is_active' => false,
        ]);

        $response = $this->getJson('/api/v1/hr/leave-types');

        $response->assertOk();
        $this->assertCount(3, $response->json('data'));
    }

    // ── Store ────────────────────────────────────────────

    public function test_admin_can_create_leave_type(): void
    {
        $user = $this->actingAsUser('admin');

        $response = $this->postJson('/api/v1/hr/leave-types', [
            'name'           => 'Annual Leave',
            'code'           => 'AL',
            'type'           => 'paid',
            'days_per_year'  => 20,
            'accrual_method' => 'annual',
            'max_carry_over' => 5,
            'is_active'      => true,
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('data.name', 'Annual Leave')
            ->assertJsonPath('data.code', 'AL')
            ->assertJsonPath('data.type', 'paid')
            ->assertJsonPath('data.days_per_year', 20.0)
            ->assertJsonPath('data.accrual_method', 'annual')
            ->assertJsonPath('data.max_carry_over', 5.0);

        $this->assertDatabaseHas('leave_types', [
            'organization_id' => $user->organization_id,
            'name'            => 'Annual Leave',
            'code'            => 'AL',
            'is_paid'         => true,
        ]);
    }

    public function test_cannot_create_leave_type_with_duplicate_code_in_same_org(): void
    {
        $user = $this->actingAsUser('admin');

        LeaveType::factory()->create([
            'organization_id' => $user->organization_id,
            'code' => 'AL',
        ]);

        $response = $this->postJson('/api/v1/hr/leave-types', [
            'name' => 'Another Annual Leave',
            'code' => 'AL',
            'days_per_year' => 15,
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['code']);
    }

    public function test_can_create_leave_type_with_same_code_in_different_org(): void
    {
        $orgA = $this->createOrganization();
        $orgB = $this->createOrganization();

        $adminA = $this->createUser($orgA, 'admin');
        $adminB = $this->createUser($orgB, 'admin');

        LeaveType::factory()->create([
            'organization_id' => $orgA->id,
            'code' => 'AL',
        ]);

        // Same code in a different org should succeed
        $this->actingAs($adminB, 'sanctum');

        $response = $this->postJson('/api/v1/hr/leave-types', [
            'name'          => 'Annual Leave',
            'code'          => 'AL',
            'type'          => 'paid',
            'days_per_year' => 20,
        ]);

        $response->assertStatus(201);
    }

    // ── Authorization ────────────────────────────────────

    public function test_employee_cannot_create_leave_type(): void
    {
        $this->actingAsUser('employee');

        $response = $this->postJson('/api/v1/hr/leave-types', [
            'name' => 'Sick Leave',
            'code' => 'SL',
            'days_per_year' => 10,
        ]);

        $response->assertStatus(403);
    }

    // ── Validation ───────────────────────────────────────

    public function test_store_uses_form_request_validation(): void
    {
        $this->actingAsUser('admin');

        // Missing all required fields
        $response = $this->postJson('/api/v1/hr/leave-types', []);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['name', 'code', 'type', 'days_per_year']);
    }
}
