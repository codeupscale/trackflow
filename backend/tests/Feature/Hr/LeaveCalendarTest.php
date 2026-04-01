<?php

namespace Tests\Feature\Hr;

use App\Models\LeaveRequest;
use App\Models\LeaveType;
use Carbon\Carbon;
use Tests\TestCase;

class LeaveCalendarTest extends TestCase
{
    // ── Index ────────────────────────────────────────────

    public function test_can_get_leave_calendar(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'admin');
        $employee = $this->createUser($org, 'employee');
        $this->actingAs($admin, 'sanctum');

        $leaveType = LeaveType::factory()->create(['organization_id' => $org->id]);

        // Create an approved leave request in June 2026
        LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'leave_type_id' => $leaveType->id,
            'start_date' => '2026-06-15',
            'end_date' => '2026-06-16',
            'days_count' => 2,
            'status' => 'approved',
        ]);

        $response = $this->getJson('/api/v1/hr/leave-calendar?month=6&year=2026');

        $response->assertOk()
            ->assertJsonStructure(['calendar']);

        $calendar = $response->json('calendar');
        $this->assertNotEmpty($calendar);

        // Should have entries for 2026-06-15 and 2026-06-16
        $this->assertArrayHasKey('2026-06-15', $calendar);
        $this->assertArrayHasKey('2026-06-16', $calendar);
    }

    // ── Validation ───────────────────────────────────────

    public function test_calendar_requires_month_and_year(): void
    {
        $this->actingAsUser('owner');

        // Missing both
        $response = $this->getJson('/api/v1/hr/leave-calendar');
        $response->assertStatus(422)
            ->assertJsonValidationErrors(['month', 'year']);

        // Missing year
        $response = $this->getJson('/api/v1/hr/leave-calendar?month=6');
        $response->assertStatus(422)
            ->assertJsonValidationErrors(['year']);

        // Missing month
        $response = $this->getJson('/api/v1/hr/leave-calendar?year=2026');
        $response->assertStatus(422)
            ->assertJsonValidationErrors(['month']);
    }

    // ── Status filtering ────────────────────────────────

    public function test_calendar_only_shows_approved_and_pending_leaves(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'admin');
        $employee = $this->createUser($org, 'employee');
        $this->actingAs($admin, 'sanctum');

        $leaveType = LeaveType::factory()->create(['organization_id' => $org->id]);

        // Approved request — should appear
        LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'leave_type_id' => $leaveType->id,
            'start_date' => '2026-07-01',
            'end_date' => '2026-07-01',
            'days_count' => 1,
            'status' => 'approved',
        ]);

        // Pending request — should appear
        LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'leave_type_id' => $leaveType->id,
            'start_date' => '2026-07-10',
            'end_date' => '2026-07-10',
            'days_count' => 1,
            'status' => 'pending',
        ]);

        // Rejected request — should NOT appear
        LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'leave_type_id' => $leaveType->id,
            'start_date' => '2026-07-15',
            'end_date' => '2026-07-15',
            'days_count' => 1,
            'status' => 'rejected',
        ]);

        // Cancelled request — should NOT appear
        LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'leave_type_id' => $leaveType->id,
            'start_date' => '2026-07-20',
            'end_date' => '2026-07-20',
            'days_count' => 1,
            'status' => 'cancelled',
        ]);

        $response = $this->getJson('/api/v1/hr/leave-calendar?month=7&year=2026');

        $response->assertOk();

        $calendar = $response->json('calendar');

        // Approved and pending dates should be present
        $this->assertArrayHasKey('2026-07-01', $calendar);
        $this->assertArrayHasKey('2026-07-10', $calendar);

        // Rejected and cancelled dates should be absent
        $this->assertArrayNotHasKey('2026-07-15', $calendar);
        $this->assertArrayNotHasKey('2026-07-20', $calendar);
    }

    // ── Cross-Org Isolation ──────────────────────────────

    public function test_cross_org_isolation(): void
    {
        $orgA = $this->createOrganization();
        $orgB = $this->createOrganization();

        $adminA = $this->createUser($orgA, 'admin');
        $employeeB = $this->createUser($orgB, 'employee');

        $leaveTypeA = LeaveType::factory()->create(['organization_id' => $orgA->id]);
        $leaveTypeB = LeaveType::factory()->create(['organization_id' => $orgB->id]);

        // Org A leave
        LeaveRequest::factory()->create([
            'organization_id' => $orgA->id,
            'user_id' => $adminA->id,
            'leave_type_id' => $leaveTypeA->id,
            'start_date' => '2026-08-01',
            'end_date' => '2026-08-01',
            'days_count' => 1,
            'status' => 'approved',
        ]);

        // Org B leave
        LeaveRequest::factory()->create([
            'organization_id' => $orgB->id,
            'user_id' => $employeeB->id,
            'leave_type_id' => $leaveTypeB->id,
            'start_date' => '2026-08-05',
            'end_date' => '2026-08-05',
            'days_count' => 1,
            'status' => 'approved',
        ]);

        $this->actingAs($adminA, 'sanctum');

        $response = $this->getJson('/api/v1/hr/leave-calendar?month=8&year=2026');

        $response->assertOk();

        $calendar = $response->json('calendar');

        // Should see org A's leave
        $this->assertArrayHasKey('2026-08-01', $calendar);

        // Should NOT see org B's leave
        $this->assertArrayNotHasKey('2026-08-05', $calendar);
    }
}
