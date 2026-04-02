<?php

namespace Tests\Feature\Hr;

use App\Models\Shift;
use App\Models\ShiftSwapRequest;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class ShiftSwapTest extends TestCase
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

    // ── Create Swap ─────────────────────────────────────

    public function test_employee_can_create_swap_request(): void
    {
        $org = $this->createOrganization();
        $requester = $this->createUser($org, 'employee');
        $target = $this->createUser($org, 'employee');
        $this->actingAs($requester, 'sanctum');

        $shiftA = Shift::factory()->weekdays()->create(['organization_id' => $org->id]);
        $shiftB = Shift::factory()->weekdays()->create(['organization_id' => $org->id]);

        $swapDate = now()->addDays(7)->toDateString();

        $this->assignShiftToUser($org->id, $requester->id, $shiftA->id);
        $this->assignShiftToUser($org->id, $target->id, $shiftB->id);

        $response = $this->postJson('/api/v1/hr/shift-swaps', [
            'target_user_id' => $target->id,
            'swap_date' => $swapDate,
            'reason' => 'Personal appointment.',
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('data.requester_id', $requester->id)
            ->assertJsonPath('data.target_user_id', $target->id);
    }

    public function test_self_swap_rejected(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $response = $this->postJson('/api/v1/hr/shift-swaps', [
            'target_user_id' => $user->id,
            'swap_date' => now()->addDays(5)->toDateString(),
            'reason' => 'Self swap attempt.',
        ]);

        $response->assertStatus(422);
    }

    public function test_swap_requires_future_date(): void
    {
        $org = $this->createOrganization();
        $requester = $this->createUser($org, 'employee');
        $target = $this->createUser($org, 'employee');
        $this->actingAs($requester, 'sanctum');

        $response = $this->postJson('/api/v1/hr/shift-swaps', [
            'target_user_id' => $target->id,
            'swap_date' => now()->subDay()->toDateString(),
            'reason' => 'Past date attempt.',
        ]);

        $response->assertStatus(422);
    }

    // ── Approve ─────────────────────────────────────────

    public function test_manager_can_approve_swap(): void
    {
        $org = $this->createOrganization();
        $requester = $this->createUser($org, 'employee');
        $target = $this->createUser($org, 'employee');
        $manager = $this->createUser($org, 'manager');

        $shiftA = Shift::factory()->create(['organization_id' => $org->id]);
        $shiftB = Shift::factory()->create(['organization_id' => $org->id]);

        $swap = ShiftSwapRequest::factory()->create([
            'organization_id' => $org->id,
            'requester_id' => $requester->id,
            'target_user_id' => $target->id,
            'requester_shift_id' => $shiftA->id,
            'target_shift_id' => $shiftB->id,
            'swap_date' => now()->addDays(5)->toDateString(),
            'status' => 'pending',
        ]);

        $this->actingAs($manager, 'sanctum');

        $response = $this->putJson("/api/v1/hr/shift-swaps/{$swap->id}/approve");

        $response->assertOk()
            ->assertJsonPath('data.status', 'approved')
            ->assertJsonPath('data.reviewed_by', $manager->id);

        $this->assertDatabaseHas('shift_swap_requests', [
            'id' => $swap->id,
            'status' => 'approved',
            'reviewed_by' => $manager->id,
        ]);
    }

    public function test_self_approval_rejected(): void
    {
        $org = $this->createOrganization();
        $requester = $this->createUser($org, 'manager');
        $target = $this->createUser($org, 'employee');

        $shiftA = Shift::factory()->create(['organization_id' => $org->id]);
        $shiftB = Shift::factory()->create(['organization_id' => $org->id]);

        $swap = ShiftSwapRequest::factory()->create([
            'organization_id' => $org->id,
            'requester_id' => $requester->id,
            'target_user_id' => $target->id,
            'requester_shift_id' => $shiftA->id,
            'target_shift_id' => $shiftB->id,
            'swap_date' => now()->addDays(5)->toDateString(),
            'status' => 'pending',
        ]);

        $this->actingAs($requester, 'sanctum');

        $response = $this->putJson("/api/v1/hr/shift-swaps/{$swap->id}/approve");

        $response->assertStatus(403);
    }

    // ── Reject ──────────────────────────────────────────

    public function test_manager_can_reject_swap(): void
    {
        $org = $this->createOrganization();
        $requester = $this->createUser($org, 'employee');
        $target = $this->createUser($org, 'employee');
        $manager = $this->createUser($org, 'manager');

        $shiftA = Shift::factory()->create(['organization_id' => $org->id]);
        $shiftB = Shift::factory()->create(['organization_id' => $org->id]);

        $swap = ShiftSwapRequest::factory()->create([
            'organization_id' => $org->id,
            'requester_id' => $requester->id,
            'target_user_id' => $target->id,
            'requester_shift_id' => $shiftA->id,
            'target_shift_id' => $shiftB->id,
            'swap_date' => now()->addDays(5)->toDateString(),
            'status' => 'pending',
        ]);

        $this->actingAs($manager, 'sanctum');

        $response = $this->putJson("/api/v1/hr/shift-swaps/{$swap->id}/reject", [
            'reviewer_note' => 'Insufficient staffing on that day.',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.status', 'rejected');

        $this->assertDatabaseHas('shift_swap_requests', [
            'id' => $swap->id,
            'status' => 'rejected',
            'reviewed_by' => $manager->id,
            'reviewer_note' => 'Insufficient staffing on that day.',
        ]);
    }

    // ── Cancel ──────────────────────────────────────────

    public function test_employee_can_cancel_own_pending_swap(): void
    {
        $org = $this->createOrganization();
        $requester = $this->createUser($org, 'employee');
        $target = $this->createUser($org, 'employee');

        $shiftA = Shift::factory()->create(['organization_id' => $org->id]);
        $shiftB = Shift::factory()->create(['organization_id' => $org->id]);

        $swap = ShiftSwapRequest::factory()->create([
            'organization_id' => $org->id,
            'requester_id' => $requester->id,
            'target_user_id' => $target->id,
            'requester_shift_id' => $shiftA->id,
            'target_shift_id' => $shiftB->id,
            'swap_date' => now()->addDays(5)->toDateString(),
            'status' => 'pending',
        ]);

        $this->actingAs($requester, 'sanctum');

        $response = $this->deleteJson("/api/v1/hr/shift-swaps/{$swap->id}");

        $response->assertStatus(204);

        $this->assertDatabaseHas('shift_swap_requests', [
            'id' => $swap->id,
            'status' => 'cancelled',
        ]);
    }

    public function test_employee_cannot_cancel_approved_swap(): void
    {
        $org = $this->createOrganization();
        $requester = $this->createUser($org, 'employee');
        $target = $this->createUser($org, 'employee');
        $manager = $this->createUser($org, 'manager');

        $shiftA = Shift::factory()->create(['organization_id' => $org->id]);
        $shiftB = Shift::factory()->create(['organization_id' => $org->id]);

        $swap = ShiftSwapRequest::factory()->create([
            'organization_id' => $org->id,
            'requester_id' => $requester->id,
            'target_user_id' => $target->id,
            'requester_shift_id' => $shiftA->id,
            'target_shift_id' => $shiftB->id,
            'swap_date' => now()->addDays(5)->toDateString(),
            'status' => 'approved',
            'reviewed_by' => $manager->id,
            'reviewed_at' => now(),
        ]);

        $this->actingAs($requester, 'sanctum');

        $response = $this->deleteJson("/api/v1/hr/shift-swaps/{$swap->id}");

        // Policy denies deletion of non-pending swaps for non-admin users
        $response->assertStatus(403);
    }

    // ── Role-Scoped List ────────────────────────────────

    public function test_list_swaps_role_scoped(): void
    {
        $org = $this->createOrganization();
        $emp1 = $this->createUser($org, 'employee');
        $emp2 = $this->createUser($org, 'employee');
        $emp3 = $this->createUser($org, 'employee');
        $admin = $this->createUser($org, 'admin');

        $shiftA = Shift::factory()->create(['organization_id' => $org->id]);
        $shiftB = Shift::factory()->create(['organization_id' => $org->id]);

        // Swap between emp1 and emp2
        ShiftSwapRequest::factory()->create([
            'organization_id' => $org->id,
            'requester_id' => $emp1->id,
            'target_user_id' => $emp2->id,
            'requester_shift_id' => $shiftA->id,
            'target_shift_id' => $shiftB->id,
            'swap_date' => now()->addDays(5)->toDateString(),
            'status' => 'pending',
        ]);

        // Swap between emp2 and emp3 (emp1 is not involved)
        ShiftSwapRequest::factory()->create([
            'organization_id' => $org->id,
            'requester_id' => $emp2->id,
            'target_user_id' => $emp3->id,
            'requester_shift_id' => $shiftB->id,
            'target_shift_id' => $shiftA->id,
            'swap_date' => now()->addDays(6)->toDateString(),
            'status' => 'pending',
        ]);

        // emp1 should see only the first swap (involved as requester)
        $this->actingAs($emp1, 'sanctum');
        $response = $this->getJson('/api/v1/hr/shift-swaps');
        $response->assertOk();
        $this->assertEquals(1, $response->json('total'));

        // admin should see all swaps
        $this->actingAs($admin, 'sanctum');
        $response = $this->getJson('/api/v1/hr/shift-swaps');
        $response->assertOk();
        $this->assertEquals(2, $response->json('total'));
    }

    // ── Cross-Org Isolation ─────────────────────────────

    public function test_cross_org_swap_isolation(): void
    {
        $orgA = $this->createOrganization();
        $orgB = $this->createOrganization();

        $adminA = $this->createUser($orgA, 'admin');
        $empB1 = $this->createUser($orgB, 'employee');
        $empB2 = $this->createUser($orgB, 'employee');

        $shiftB1 = Shift::factory()->create(['organization_id' => $orgB->id]);
        $shiftB2 = Shift::factory()->create(['organization_id' => $orgB->id]);

        $swapB = ShiftSwapRequest::factory()->create([
            'organization_id' => $orgB->id,
            'requester_id' => $empB1->id,
            'target_user_id' => $empB2->id,
            'requester_shift_id' => $shiftB1->id,
            'target_shift_id' => $shiftB2->id,
            'swap_date' => now()->addDays(5)->toDateString(),
            'status' => 'pending',
        ]);

        $this->actingAs($adminA, 'sanctum');

        // Listing should not include org B's swap
        $response = $this->getJson('/api/v1/hr/shift-swaps');
        $response->assertOk();
        $this->assertEquals(0, $response->json('total'));

        // Direct approve should 404
        $response = $this->putJson("/api/v1/hr/shift-swaps/{$swapB->id}/approve");
        $response->assertStatus(404);
    }
}
