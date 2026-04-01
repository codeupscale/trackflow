<?php

namespace Tests\Feature\Hr;

use App\Models\LeaveBalance;
use App\Models\LeaveType;
use Tests\TestCase;

class LeaveBalanceTest extends TestCase
{
    // ── Index (own balances) ─────────────────────────────

    public function test_employee_can_view_own_balances(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $this->actingAs($employee, 'sanctum');

        $leaveType = LeaveType::factory()->create([
            'organization_id' => $org->id,
            'is_active' => true,
        ]);

        LeaveBalance::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'leave_type_id' => $leaveType->id,
            'year' => now()->year,
            'total_days' => 20,
            'used_days' => 3,
            'pending_days' => 2,
        ]);

        $response = $this->getJson('/api/v1/hr/leave-balances?year=' . now()->year);

        $response->assertOk()
            ->assertJsonStructure([
                'balances' => [['id', 'user_id', 'leave_type_id', 'year', 'total_days', 'used_days', 'pending_days']],
            ]);

        $balances = $response->json('balances');
        $this->assertNotEmpty($balances);
        $this->assertEquals($employee->id, $balances[0]['user_id']);
    }

    // ── Admin viewing other user balances ────────────────

    public function test_admin_can_view_other_user_balances(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'admin');
        $employee = $this->createUser($org, 'employee');
        $this->actingAs($admin, 'sanctum');

        $leaveType = LeaveType::factory()->create([
            'organization_id' => $org->id,
            'is_active' => true,
        ]);

        LeaveBalance::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'leave_type_id' => $leaveType->id,
            'year' => now()->year,
            'total_days' => 15,
            'used_days' => 5,
            'pending_days' => 1,
        ]);

        $response = $this->getJson('/api/v1/hr/leave-balances?user_id=' . $employee->id . '&year=' . now()->year);

        $response->assertOk();

        $balances = $response->json('balances');
        $this->assertNotEmpty($balances);
        $this->assertEquals($employee->id, $balances[0]['user_id']);
    }

    // ── Employee cannot view other user balances ─────────

    public function test_employee_cannot_view_other_user_balances(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $otherEmployee = $this->createUser($org, 'employee');
        $this->actingAs($employee, 'sanctum');

        $leaveType = LeaveType::factory()->create([
            'organization_id' => $org->id,
            'is_active' => true,
        ]);

        LeaveBalance::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $otherEmployee->id,
            'leave_type_id' => $leaveType->id,
            'year' => now()->year,
            'total_days' => 20,
            'used_days' => 0,
            'pending_days' => 0,
        ]);

        // Employee passes user_id of another employee — should be ignored (returns own balances)
        $response = $this->getJson('/api/v1/hr/leave-balances?user_id=' . $otherEmployee->id . '&year=' . now()->year);

        $response->assertOk();

        $balances = $response->json('balances');
        // Should see only own balances, not the other employee's
        foreach ($balances as $balance) {
            $this->assertEquals($employee->id, $balance['user_id']);
        }
    }

    // ── Auto-initialization ─────────────────────────────

    public function test_balances_auto_initialize_if_empty(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $this->actingAs($employee, 'sanctum');

        // Create 2 active leave types with no existing balances
        LeaveType::factory()->create([
            'organization_id' => $org->id,
            'is_active' => true,
            'days_per_year' => 20,
        ]);
        LeaveType::factory()->create([
            'organization_id' => $org->id,
            'is_active' => true,
            'days_per_year' => 10,
        ]);

        // No LeaveBalance records exist yet — the controller should auto-initialize
        $this->assertDatabaseMissing('leave_balances', [
            'user_id' => $employee->id,
            'year' => now()->year,
        ]);

        $response = $this->getJson('/api/v1/hr/leave-balances?year=' . now()->year);

        $response->assertOk();

        // After the request, balances should exist for both leave types
        $balances = $response->json('balances');
        $this->assertCount(2, $balances);

        $this->assertDatabaseCount('leave_balances', 2);
    }

    // ── Cross-Org Isolation ──────────────────────────────

    public function test_cross_org_isolation(): void
    {
        $orgA = $this->createOrganization();
        $orgB = $this->createOrganization();

        $employeeA = $this->createUser($orgA, 'employee');
        $employeeB = $this->createUser($orgB, 'employee');

        $leaveTypeA = LeaveType::factory()->create([
            'organization_id' => $orgA->id,
            'is_active' => true,
        ]);

        $leaveTypeB = LeaveType::factory()->create([
            'organization_id' => $orgB->id,
            'is_active' => true,
        ]);

        LeaveBalance::factory()->create([
            'organization_id' => $orgA->id,
            'user_id' => $employeeA->id,
            'leave_type_id' => $leaveTypeA->id,
            'year' => now()->year,
        ]);

        LeaveBalance::factory()->create([
            'organization_id' => $orgB->id,
            'user_id' => $employeeB->id,
            'leave_type_id' => $leaveTypeB->id,
            'year' => now()->year,
        ]);

        // Employee A should only see their own balances
        $this->actingAs($employeeA, 'sanctum');

        $response = $this->getJson('/api/v1/hr/leave-balances?year=' . now()->year);
        $response->assertOk();

        $userIds = collect($response->json('balances'))->pluck('user_id')->unique()->toArray();
        $this->assertContains($employeeA->id, $userIds);
        $this->assertNotContains($employeeB->id, $userIds);
    }
}
