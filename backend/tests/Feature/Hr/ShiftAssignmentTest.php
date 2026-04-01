<?php

namespace Tests\Feature\Hr;

use App\Models\Organization;
use App\Models\Shift;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class ShiftAssignmentTest extends TestCase
{
    /**
     * Helper to assign a user to a shift via the pivot table.
     */
    private function assignShiftToUser(
        string $orgId,
        string $userId,
        string $shiftId,
        string $effectiveFrom = '2026-01-01',
        ?string $effectiveTo = null,
    ): void {
        DB::table('user_shifts')->insert([
            'id' => (string) Str::uuid(),
            'organization_id' => $orgId,
            'user_id' => $userId,
            'shift_id' => $shiftId,
            'effective_from' => $effectiveFrom,
            'effective_to' => $effectiveTo,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    // ── View Assignments ────────────────────────────────

    public function test_manager_can_view_assignments(): void
    {
        $org = $this->createOrganization();
        $manager = $this->createUser($org, 'manager');
        $employee = $this->createUser($org, 'employee');
        $this->actingAs($manager, 'sanctum');

        $shift = Shift::factory()->create(['organization_id' => $org->id]);
        $this->assignShiftToUser($org->id, $employee->id, $shift->id);

        $response = $this->getJson("/api/v1/hr/shifts/{$shift->id}/assignments");

        $response->assertOk()
            ->assertJsonStructure([
                'data' => [['id', 'name', 'email']],
            ]);
        $this->assertCount(1, $response->json('data'));
    }

    // ── Assign ──────────────────────────────────────────

    public function test_manager_can_assign_user(): void
    {
        $org = $this->createOrganization();
        $manager = $this->createUser($org, 'manager');
        $employee = $this->createUser($org, 'employee');
        $this->actingAs($manager, 'sanctum');

        $shift = Shift::factory()->create(['organization_id' => $org->id]);

        $response = $this->postJson("/api/v1/hr/shifts/{$shift->id}/assign", [
            'user_id' => $employee->id,
            'effective_from' => '2026-04-01',
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('message', 'User assigned to shift.');

        $this->assertDatabaseHas('user_shifts', [
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'shift_id' => $shift->id,
            'effective_from' => '2026-04-01',
        ]);
    }

    public function test_assign_rejects_overlapping_shift(): void
    {
        $org = $this->createOrganization();
        $manager = $this->createUser($org, 'manager');
        $employee = $this->createUser($org, 'employee');
        $this->actingAs($manager, 'sanctum');

        $shift1 = Shift::factory()->create(['organization_id' => $org->id]);
        $shift2 = Shift::factory()->create(['organization_id' => $org->id]);

        // Assign employee to shift1 first
        $this->assignShiftToUser($org->id, $employee->id, $shift1->id, '2026-04-01', '2026-06-30');

        // Try overlapping assignment to shift2
        $response = $this->postJson("/api/v1/hr/shifts/{$shift2->id}/assign", [
            'user_id' => $employee->id,
            'effective_from' => '2026-05-01',
            'effective_to' => '2026-07-31',
        ]);

        $response->assertStatus(422);
    }

    // ── Unassign ────────────────────────────────────────

    public function test_manager_can_unassign_user(): void
    {
        $org = $this->createOrganization();
        $manager = $this->createUser($org, 'manager');
        $employee = $this->createUser($org, 'employee');
        $this->actingAs($manager, 'sanctum');

        $shift = Shift::factory()->create(['organization_id' => $org->id]);
        $this->assignShiftToUser($org->id, $employee->id, $shift->id);

        $response = $this->postJson("/api/v1/hr/shifts/{$shift->id}/unassign", [
            'user_id' => $employee->id,
        ]);

        $response->assertOk()
            ->assertJsonPath('message', 'User unassigned from shift.');

        $pivot = DB::table('user_shifts')
            ->where('shift_id', $shift->id)
            ->where('user_id', $employee->id)
            ->first();

        $this->assertEquals(now()->toDateString(), $pivot->effective_to);
    }

    // ── Bulk Assign ─────────────────────────────────────

    public function test_manager_can_bulk_assign(): void
    {
        $org = $this->createOrganization();
        $manager = $this->createUser($org, 'manager');
        $emp1 = $this->createUser($org, 'employee');
        $emp2 = $this->createUser($org, 'employee');
        $emp3 = $this->createUser($org, 'employee');
        $this->actingAs($manager, 'sanctum');

        $shift = Shift::factory()->create(['organization_id' => $org->id]);

        $response = $this->postJson("/api/v1/hr/shifts/{$shift->id}/bulk-assign", [
            'user_ids' => [$emp1->id, $emp2->id, $emp3->id],
            'effective_from' => '2026-04-01',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.assigned_count', 3);

        $pivotCount = DB::table('user_shifts')
            ->where('shift_id', $shift->id)
            ->where('organization_id', $org->id)
            ->count();

        $this->assertEquals(3, $pivotCount);
    }

    // ── Authorization ───────────────────────────────────

    public function test_employee_cannot_assign(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $otherEmployee = $this->createUser($org, 'employee');
        $this->actingAs($employee, 'sanctum');

        $shift = Shift::factory()->create(['organization_id' => $org->id]);

        $response = $this->postJson("/api/v1/hr/shifts/{$shift->id}/assign", [
            'user_id' => $otherEmployee->id,
            'effective_from' => '2026-04-01',
        ]);

        $response->assertStatus(403);
    }

    // ── Validation ──────────────────────────────────────

    public function test_assign_validates_user_exists_in_org(): void
    {
        $org = $this->createOrganization();
        $manager = $this->createUser($org, 'manager');
        $this->actingAs($manager, 'sanctum');

        $shift = Shift::factory()->create(['organization_id' => $org->id]);

        // Non-existent UUID
        $response = $this->postJson("/api/v1/hr/shifts/{$shift->id}/assign", [
            'user_id' => (string) Str::uuid(),
            'effective_from' => '2026-04-01',
        ]);

        $response->assertStatus(422);
    }

    // ── Cross-Org Isolation ─────────────────────────────

    public function test_cross_org_assignment_isolation(): void
    {
        $orgA = $this->createOrganization();
        $orgB = $this->createOrganization();

        $managerA = $this->createUser($orgA, 'manager');
        $employeeB = $this->createUser($orgB, 'employee');

        $shiftA = Shift::factory()->create(['organization_id' => $orgA->id]);

        $this->actingAs($managerA, 'sanctum');

        // Try to assign user from org B to org A's shift
        $response = $this->postJson("/api/v1/hr/shifts/{$shiftA->id}/assign", [
            'user_id' => $employeeB->id,
            'effective_from' => '2026-04-01',
        ]);

        $response->assertStatus(422);
    }
}
