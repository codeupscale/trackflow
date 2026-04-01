<?php

namespace Tests\Feature\Hr;

use App\Models\LeaveType;
use Tests\TestCase;

class LeaveTypeTest extends TestCase
{
    // ── Index ────────────────────────────────────────────

    public function test_can_list_active_leave_types(): void
    {
        $user = $this->actingAsUser('owner');

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
                'data' => [['id', 'name', 'code', 'is_paid', 'days_per_year']],
                'current_page',
                'last_page',
                'total',
            ]);

        // Only the 2 active leave types should be returned
        $this->assertCount(2, $response->json('data'));
    }

    // ── Store ────────────────────────────────────────────

    public function test_admin_can_create_leave_type(): void
    {
        $user = $this->actingAsUser('admin');

        $response = $this->postJson('/api/v1/hr/leave-types', [
            'name' => 'Annual Leave',
            'code' => 'AL',
            'days_per_year' => 20,
            'is_paid' => true,
            'accrual_type' => 'upfront',
            'carryover_days' => 5,
            'max_consecutive_days' => 10,
            'requires_document' => false,
            'requires_approval' => true,
            'applicable_genders' => 'all',
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('data.name', 'Annual Leave')
            ->assertJsonPath('data.code', 'AL')
            ->assertJsonPath('data.days_per_year', '20.0');

        $this->assertDatabaseHas('leave_types', [
            'organization_id' => $user->organization_id,
            'name' => 'Annual Leave',
            'code' => 'AL',
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
            'name' => 'Annual Leave',
            'code' => 'AL',
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
            ->assertJsonValidationErrors(['name', 'code', 'days_per_year']);
    }
}
