<?php

namespace Tests\Feature\Hr;

use App\Models\LeaveBalance;
use App\Models\LeaveRequest;
use App\Models\LeaveType;
use App\Models\Team;
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
            ->assertJsonPath('leave_request.status', 'pending')
            ->assertJsonStructure([
                'leave_request' => ['id', 'start_date', 'end_date', 'days_count', 'status'],
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

    public function test_manager_can_see_team_requests(): void
    {
        $org = $this->createOrganization();
        $manager = $this->createUser($org, 'manager');
        $teamMember = $this->createUser($org, 'employee');
        $outsider = $this->createUser($org, 'employee');

        // Create team with manager and member
        $team = Team::factory()->create([
            'organization_id' => $org->id,
            'manager_id' => $manager->id,
        ]);
        $team->members()->attach($teamMember->id);

        $leaveType = LeaveType::factory()->create(['organization_id' => $org->id]);

        // Team member's request
        LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $teamMember->id,
            'leave_type_id' => $leaveType->id,
        ]);

        // Outsider's request
        LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $outsider->id,
            'leave_type_id' => $leaveType->id,
        ]);

        $this->actingAs($manager, 'sanctum');

        $response = $this->getJson('/api/v1/hr/leave-requests');

        $response->assertOk();
        $userIds = collect($response->json('data'))->pluck('user_id')->toArray();
        $this->assertContains($teamMember->id, $userIds);
        $this->assertNotContains($outsider->id, $userIds);
    }

    public function test_admin_can_see_all_requests(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'admin');
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
        $manager = $this->createUser($org, 'manager');
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
            ->assertJsonPath('leave_request.status', 'approved');
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
        $manager = $this->createUser($org, 'manager');
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
            ->assertJsonPath('leave_request.status', 'rejected')
            ->assertJsonPath('leave_request.rejection_reason', 'Team is short-staffed');
    }

    // ── Cancel (destroy) ─────────────────────────────────

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

        $adminA = $this->createUser($orgA, 'admin');
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
