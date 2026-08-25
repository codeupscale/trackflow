<?php

namespace Tests\Feature\Hr;

use App\Models\LeaveBalance;
use App\Models\LeaveRequest;
use App\Models\LeaveType;
use Carbon\Carbon;
use Tests\TestCase;

class LeaveRequestTest extends TestCase
{
    // ── Store (apply) ────────────────────────────────────

    public function test_employee_can_apply_for_leave(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $leaveType = LeaveType::factory()->create([
            'organization_id' => $org->id,
            'days_per_year' => 20,
        ]);

        LeaveBalance::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'leave_type_id' => $leaveType->id,
            'year' => now()->year,
            'total_days' => 20,
            'used_days' => 0,
            'pending_days' => 0,
        ]);

        $date = Carbon::now()->next('Wednesday');

        $response = $this->postJson('/api/v1/hr/leave-requests', [
            'leave_type_id' => $leaveType->id,
            'start_date' => $date->toDateString(),
            'end_date' => $date->toDateString(),
            'reason' => 'Personal appointment',
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('data.status', 'pending')
            ->assertJsonStructure([
                'data' => ['id', 'start_date', 'end_date', 'days_count', 'status'],
            ]);
    }

    public function test_apply_returns_422_when_insufficient_balance(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $leaveType = LeaveType::factory()->create([
            'organization_id' => $org->id,
            'days_per_year' => 1,
        ]);

        LeaveBalance::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'leave_type_id' => $leaveType->id,
            'year' => now()->year,
            'total_days' => 1,
            'used_days' => 1,
            'pending_days' => 0,
        ]);

        $date = Carbon::now()->next('Wednesday');

        $response = $this->postJson('/api/v1/hr/leave-requests', [
            'leave_type_id' => $leaveType->id,
            'start_date' => $date->toDateString(),
            'end_date' => $date->toDateString(),
            'reason' => 'No balance left',
        ]);

        $response->assertStatus(422);
    }

    // ── Index (role scoping) ─────────────────────────────

    public function test_employee_can_only_see_own_requests(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $otherEmployee = $this->createUser($org, 'employee');

        $leaveType = LeaveType::factory()->create(['organization_id' => $org->id]);

        // Employee's own request
        LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'leave_type_id' => $leaveType->id,
        ]);

        // Other employee's request
        LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $otherEmployee->id,
            'leave_type_id' => $leaveType->id,
        ]);

        $this->actingAs($employee, 'sanctum');

        $response = $this->getJson('/api/v1/hr/leave-requests');

        $response->assertOk();
        $data = $response->json('data');
        $this->assertCount(1, $data);
        $this->assertEquals($employee->id, $data[0]['user_id']);
    }

    public function test_org_manager_can_see_all_requests(): void
    {
        $org = $this->createOrganization();
        $manager = $this->createUser($org, 'org_manager');
        $emp1 = $this->createUser($org, 'employee');
        $emp2 = $this->createUser($org, 'employee');

        $leaveType = LeaveType::factory()->create(['organization_id' => $org->id]);

        // First employee's request
        LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $emp1->id,
            'leave_type_id' => $leaveType->id,
        ]);

        // Second employee's request
        LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $emp2->id,
            'leave_type_id' => $leaveType->id,
        ]);

        $this->actingAs($manager, 'sanctum');

        $response = $this->getJson('/api/v1/hr/leave-requests');

        $response->assertOk();
        $userIds = collect($response->json('data'))->pluck('user_id')->toArray();
        $this->assertContains($emp1->id, $userIds);
        $this->assertContains($emp2->id, $userIds);
    }

    public function test_org_manager_sees_full_org_leave_requests(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'org_manager');
        $emp1 = $this->createUser($org, 'employee');
        $emp2 = $this->createUser($org, 'employee');

        $leaveType = LeaveType::factory()->create(['organization_id' => $org->id]);

        LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $emp1->id,
            'leave_type_id' => $leaveType->id,
        ]);
        LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $emp2->id,
            'leave_type_id' => $leaveType->id,
        ]);

        $this->actingAs($admin, 'sanctum');

        $response = $this->getJson('/api/v1/hr/leave-requests');

        $response->assertOk();
        $this->assertCount(2, $response->json('data'));
    }

    // ── Approve ──────────────────────────────────────────

    public function test_manager_can_approve_leave(): void
    {
        $org = $this->createOrganization();
        $manager = $this->createUser($org, 'org_manager');
        $employee = $this->createUser($org, 'employee');

        $leaveType = LeaveType::factory()->create(['organization_id' => $org->id]);

        $monday = Carbon::now()->next('Monday');

        $leaveRequest = LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'leave_type_id' => $leaveType->id,
            'start_date' => $monday->toDateString(),
            'end_date' => $monday->toDateString(),
            'days_count' => 1.0,
            'status' => 'pending',
        ]);

        LeaveBalance::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'leave_type_id' => $leaveType->id,
            'year' => $monday->year,
            'total_days' => 20,
            'used_days' => 0,
            'pending_days' => 1.0,
        ]);

        $this->actingAs($manager, 'sanctum');

        $response = $this->putJson("/api/v1/hr/leave-requests/{$leaveRequest->id}/approve");

        $response->assertOk()
            ->assertJsonPath('data.status', 'approved');
    }

    public function test_approver_cannot_approve_own_leave(): void
    {
        // An hr_manager holds org-scoped leave.approve, but their OWN request
        // must go to someone above them (owner) — self-approval is blocked for
        // every role except owner.
        $org = $this->createOrganization();
        $hr = $this->createUser($org, 'hr_manager');

        $leaveType = LeaveType::factory()->create(['organization_id' => $org->id]);
        $leaveRequest = LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $hr->id,
            'leave_type_id' => $leaveType->id,
            'status' => 'pending',
        ]);

        $this->actingAs($hr, 'sanctum');

        $this->putJson("/api/v1/hr/leave-requests/{$leaveRequest->id}/approve")
            ->assertStatus(403);
        $this->putJson("/api/v1/hr/leave-requests/{$leaveRequest->id}/reject", [
            'rejection_reason' => 'self reject attempt',
        ])->assertStatus(403);
    }

    public function test_owner_can_approve_own_leave(): void
    {
        // The owner is the single exception to the self-approval block: there is
        // nobody above them, so blocking them would strand their requests in
        // pending forever.
        $org = $this->createOrganization();
        $owner = $this->createUser($org, 'owner');

        $leaveType = LeaveType::factory()->create(['organization_id' => $org->id]);
        $monday = Carbon::now()->next('Monday');

        $leaveRequest = LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $owner->id,
            'leave_type_id' => $leaveType->id,
            'start_date' => $monday->toDateString(),
            'end_date' => $monday->toDateString(),
            'days_count' => 1.0,
            'status' => 'pending',
        ]);

        LeaveBalance::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $owner->id,
            'leave_type_id' => $leaveType->id,
            'year' => $monday->year,
            'total_days' => 20,
            'used_days' => 0,
            'pending_days' => 1.0,
        ]);

        $this->actingAs($owner, 'sanctum');

        $this->putJson("/api/v1/hr/leave-requests/{$leaveRequest->id}/approve")
            ->assertOk()
            ->assertJsonPath('data.status', 'approved');
    }

    public function test_employee_cannot_approve_leave(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $otherEmployee = $this->createUser($org, 'employee');

        $leaveType = LeaveType::factory()->create(['organization_id' => $org->id]);

        $leaveRequest = LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $otherEmployee->id,
            'leave_type_id' => $leaveType->id,
            'status' => 'pending',
        ]);

        $this->actingAs($employee, 'sanctum');

        $response = $this->putJson("/api/v1/hr/leave-requests/{$leaveRequest->id}/approve");

        $response->assertStatus(403);
    }

    // ── Reject ───────────────────────────────────────────

    public function test_manager_can_reject_leave(): void
    {
        $org = $this->createOrganization();
        $manager = $this->createUser($org, 'org_manager');
        $employee = $this->createUser($org, 'employee');

        $leaveType = LeaveType::factory()->create(['organization_id' => $org->id]);

        $monday = Carbon::now()->next('Monday');

        $leaveRequest = LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'leave_type_id' => $leaveType->id,
            'start_date' => $monday->toDateString(),
            'end_date' => $monday->toDateString(),
            'days_count' => 1.0,
            'status' => 'pending',
        ]);

        LeaveBalance::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'leave_type_id' => $leaveType->id,
            'year' => $monday->year,
            'total_days' => 20,
            'used_days' => 0,
            'pending_days' => 1.0,
        ]);

        $this->actingAs($manager, 'sanctum');

        $response = $this->putJson("/api/v1/hr/leave-requests/{$leaveRequest->id}/reject", [
            'rejection_reason' => 'Team is short-staffed',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.status', 'rejected')
            ->assertJsonPath('data.rejection_reason', 'Team is short-staffed');
    }

    // ── Cancel (destroy) ─────────────────────────────────

    public function test_employee_can_edit_own_pending_leave_and_balances_rebalance(): void
    {
        // Replicates the risky shape: the edit changes TYPE and DAY COUNT at
        // once, so the old reservation must be released in full and the new
        // one taken on a different balance row.
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $casual = LeaveType::factory()->create(['organization_id' => $org->id]);
        $annual = LeaveType::factory()->create(['organization_id' => $org->id]);

        $monday = Carbon::now()->next('Monday');
        $tuesday = $monday->copy()->addDay();

        $this->actingAs($employee, 'sanctum');

        // Apply through the API so the reservation exists exactly as in prod.
        $this->postJson('/api/v1/hr/leave-requests', [
            'leave_type_id' => $casual->id,
            'start_date' => $monday->toDateString(),
            'end_date' => $monday->toDateString(),
            'reason' => 'original',
        ])->assertStatus(201);

        $reqId = LeaveRequest::where('user_id', $employee->id)->firstOrFail()->id;

        $this->putJson("/api/v1/hr/leave-requests/{$reqId}", [
            'leave_type_id' => $annual->id,
            'start_date' => $monday->toDateString(),
            'end_date' => $tuesday->toDateString(),
            'reason' => 'edited',
        ])->assertOk()->assertJsonPath('data.days_count', '2.0');

        $casualBal = LeaveBalance::where('user_id', $employee->id)->where('leave_type_id', $casual->id)->first();
        $annualBal = LeaveBalance::where('user_id', $employee->id)->where('leave_type_id', $annual->id)->first();

        // Old reservation fully released; new one holds exactly the new days.
        $this->assertEquals(0.0, (float) $casualBal->pending_days);
        $this->assertEquals(2.0, (float) $annualBal->pending_days);
    }

    public function test_approver_cannot_edit_someone_elses_leave(): void
    {
        // HR/admin/owner may VIEW everyone's requests but never edit them —
        // rewriting another person's dates or reason falsifies their request.
        $org = $this->createOrganization();
        $owner = $this->createUser($org, 'owner');
        $employee = $this->createUser($org, 'employee');
        $type = LeaveType::factory()->create(['organization_id' => $org->id]);

        $monday = Carbon::now()->next('Monday');
        $leaveRequest = LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'leave_type_id' => $type->id,
            'start_date' => $monday->toDateString(),
            'end_date' => $monday->toDateString(),
            'status' => 'pending',
        ]);

        $this->actingAs($owner, 'sanctum');

        $this->putJson("/api/v1/hr/leave-requests/{$leaveRequest->id}", [
            'leave_type_id' => $type->id,
            'start_date' => $monday->toDateString(),
            'end_date' => $monday->toDateString(),
            'reason' => 'tamper',
        ])->assertStatus(403);
    }

    public function test_cannot_edit_a_resolved_leave_request(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $type = LeaveType::factory()->create(['organization_id' => $org->id]);

        $monday = Carbon::now()->next('Monday');
        $leaveRequest = LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'leave_type_id' => $type->id,
            'start_date' => $monday->toDateString(),
            'end_date' => $monday->toDateString(),
            'status' => 'approved',
        ]);

        $this->actingAs($employee, 'sanctum');

        $this->putJson("/api/v1/hr/leave-requests/{$leaveRequest->id}", [
            'leave_type_id' => $type->id,
            'start_date' => $monday->toDateString(),
            'end_date' => $monday->toDateString(),
            'reason' => 'too late',
        ])->assertStatus(422);
    }

    public function test_date_filter_uses_overlap_so_boundary_spanning_leave_appears_in_both_months(): void
    {
        // A request spanning a month edge must show in BOTH months' windows.
        // Containment semantics dropped it from both — an Aug 31 → Sep 1 leave
        // was invisible under either month filter.
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'org_manager');
        $employee = $this->createUser($org, 'employee');
        $type = LeaveType::factory()->create(['organization_id' => $org->id]);

        LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'leave_type_id' => $type->id,
            'start_date' => '2026-08-31',
            'end_date' => '2026-09-01',
            'status' => 'pending',
        ]);

        $this->actingAs($admin, 'sanctum');

        $this->getJson('/api/v1/hr/leave-requests?start_date=2026-08-01&end_date=2026-08-31')
            ->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/v1/hr/leave-requests?start_date=2026-09-01&end_date=2026-09-30')
            ->assertOk()->assertJsonCount(1, 'data');
        // A window it does NOT touch stays empty.
        $this->getJson('/api/v1/hr/leave-requests?start_date=2026-10-01&end_date=2026-10-31')
            ->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_employee_can_cancel_own_pending_leave(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');

        $leaveType = LeaveType::factory()->create(['organization_id' => $org->id]);

        $monday = Carbon::now()->next('Monday');

        $leaveRequest = LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'leave_type_id' => $leaveType->id,
            'start_date' => $monday->toDateString(),
            'end_date' => $monday->toDateString(),
            'days_count' => 1.0,
            'status' => 'pending',
        ]);

        LeaveBalance::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'leave_type_id' => $leaveType->id,
            'year' => $monday->year,
            'total_days' => 20,
            'used_days' => 0,
            'pending_days' => 1.0,
        ]);

        $this->actingAs($employee, 'sanctum');

        $response = $this->deleteJson("/api/v1/hr/leave-requests/{$leaveRequest->id}");

        $response->assertStatus(204);

        $this->assertDatabaseHas('leave_requests', [
            'id' => $leaveRequest->id,
            'status' => 'cancelled',
        ]);
    }

    // ── Cross-Org Isolation ──────────────────────────────

    public function test_cross_org_isolation(): void
    {
        $orgA = $this->createOrganization();
        $orgB = $this->createOrganization();

        $adminA = $this->createUser($orgA, 'org_manager');
        $employeeB = $this->createUser($orgB, 'employee');

        $leaveType = LeaveType::factory()->create(['organization_id' => $orgB->id]);

        $leaveRequestB = LeaveRequest::factory()->create([
            'organization_id' => $orgB->id,
            'user_id' => $employeeB->id,
            'leave_type_id' => $leaveType->id,
        ]);

        $this->actingAs($adminA, 'sanctum');

        // List should not include org B's request
        $response = $this->getJson('/api/v1/hr/leave-requests');
        $response->assertOk();
        $ids = collect($response->json('data'))->pluck('id')->toArray();
        $this->assertNotContains($leaveRequestB->id, $ids);

        // Direct access should 404
        $response = $this->getJson("/api/v1/hr/leave-requests/{$leaveRequestB->id}");
        $response->assertStatus(404);
    }
}
