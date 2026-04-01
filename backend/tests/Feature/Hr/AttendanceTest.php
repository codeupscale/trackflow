<?php

namespace Tests\Feature\Hr;

use App\Models\AttendanceRecord;
use App\Models\AttendanceRegularization;
use App\Models\LeaveRequest;
use App\Models\LeaveType;
use App\Models\OvertimeRule;
use App\Models\PublicHoliday;
use App\Models\Shift;
use App\Models\Team;
use App\Models\TimeEntry;
use Carbon\Carbon;
use Tests\TestCase;

class AttendanceTest extends TestCase
{
    // ── Own Attendance ──────────────────────────────────

    public function test_can_view_own_attendance(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        AttendanceRecord::factory()->present()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'date' => now()->subDay()->toDateString(),
        ]);

        $response = $this->getJson('/api/v1/hr/attendance');

        $response->assertOk()
            ->assertJsonStructure([
                'data' => [
                    '*' => ['id', 'date', 'status', 'total_hours'],
                ],
            ]);
        $this->assertCount(1, $response->json('data'));
    }

    public function test_cannot_view_other_user_attendance(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $otherEmployee = $this->createUser($org, 'employee');

        // Create record for otherEmployee
        AttendanceRecord::factory()->present()->create([
            'organization_id' => $org->id,
            'user_id' => $otherEmployee->id,
            'date' => now()->subDay()->toDateString(),
        ]);

        $this->actingAs($employee, 'sanctum');

        // The index endpoint only returns the authenticated user's own records
        $response = $this->getJson('/api/v1/hr/attendance');

        $response->assertOk();
        $data = $response->json('data');
        $this->assertCount(0, $data);
    }

    // ── Team Attendance ─────────────────────────────────

    public function test_manager_can_view_team_attendance(): void
    {
        $org = $this->createOrganization();
        $manager = $this->createUser($org, 'manager');
        $employee = $this->createUser($org, 'employee');

        AttendanceRecord::factory()->present()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'date' => now()->subDay()->toDateString(),
        ]);

        $this->actingAs($manager, 'sanctum');

        $response = $this->getJson('/api/v1/hr/attendance/team');

        $response->assertOk()
            ->assertJsonStructure([
                'data' => [
                    '*' => ['id', 'date', 'status', 'total_hours', 'user'],
                ],
            ]);
    }

    public function test_employee_cannot_view_team_attendance(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $this->actingAs($employee, 'sanctum');

        $response = $this->getJson('/api/v1/hr/attendance/team');

        $response->assertStatus(403);
    }

    // ── Summary ─────────────────────────────────────────

    public function test_can_get_attendance_summary(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $month = now()->month;
        $year = now()->year;

        // Create some attendance records for this month
        AttendanceRecord::factory()->present()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'date' => now()->startOfMonth()->toDateString(),
        ]);
        AttendanceRecord::factory()->absent()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'date' => now()->startOfMonth()->addDay()->toDateString(),
        ]);

        $response = $this->getJson("/api/v1/hr/attendance/summary?month={$month}&year={$year}");

        $response->assertOk()
            ->assertJsonStructure([
                'data' => [
                    'month',
                    'year',
                    'present_days',
                    'absent_days',
                    'half_days',
                    'late_days',
                    'on_leave_days',
                    'overtime_hours',
                    'total_working_days',
                ],
            ])
            ->assertJsonPath('data.present_days', 1)
            ->assertJsonPath('data.absent_days', 1);
    }

    // ── Generate ────────────────────────────────────────

    public function test_admin_can_trigger_attendance_generation(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'admin');
        $employee = $this->createUser($org, 'employee');
        $this->actingAs($admin, 'sanctum');

        // Use a fixed past date to avoid timezone issues between host and container
        $targetDate = '2026-03-15';

        // Create a time entry for the employee on the target date (Sunday check: March 15 2026 is a Sunday)
        // Use March 16 (Monday) instead to avoid weekend logic
        $targetDate = '2026-03-16';

        TimeEntry::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'started_at' => Carbon::parse($targetDate)->setTime(9, 0),
            'ended_at' => Carbon::parse($targetDate)->setTime(17, 0),
            'duration_seconds' => 8 * 3600,
        ]);

        $response = $this->postJson('/api/v1/hr/attendance/generate', [
            'date' => $targetDate,
        ]);

        $response->assertOk()
            ->assertJsonPath('data.users_processed', 2); // admin + employee

        // Verify the employee's record was created with present status
        $record = AttendanceRecord::where('organization_id', $org->id)
            ->where('user_id', $employee->id)
            ->whereDate('date', $targetDate)
            ->first();

        $this->assertNotNull($record);
        $this->assertEquals('present', $record->status);
    }

    public function test_employee_cannot_trigger_attendance_generation(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $this->actingAs($employee, 'sanctum');

        $response = $this->postJson('/api/v1/hr/attendance/generate', [
            'date' => now()->subDay()->toDateString(),
        ]);

        $response->assertStatus(403);
    }

    // ── Regularization ──────────────────────────────────

    public function test_employee_can_request_regularization(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $this->actingAs($employee, 'sanctum');

        $record = AttendanceRecord::factory()->absent()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'date' => now()->subDay()->toDateString(),
        ]);

        $response = $this->postJson("/api/v1/hr/attendance/{$record->id}/regularize", [
            'requested_status' => 'present',
            'reason' => 'Was working remotely, forgot to start tracker.',
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('data.requested_status', 'present');
    }

    public function test_cannot_regularize_leave_day(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $this->actingAs($employee, 'sanctum');

        $record = AttendanceRecord::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'date' => now()->subDay()->toDateString(),
            'status' => 'on_leave',
            'total_hours' => 0,
            'first_seen' => null,
            'last_seen' => null,
        ]);

        $response = $this->postJson("/api/v1/hr/attendance/{$record->id}/regularize", [
            'requested_status' => 'present',
            'reason' => 'Trying to regularize a leave day.',
        ]);

        $response->assertStatus(422);
    }

    public function test_manager_can_approve_regularization(): void
    {
        $org = $this->createOrganization();
        $manager = $this->createUser($org, 'manager');
        $employee = $this->createUser($org, 'employee');

        $record = AttendanceRecord::factory()->absent()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'date' => now()->subDay()->toDateString(),
        ]);

        $reg = AttendanceRegularization::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'attendance_record_id' => $record->id,
            'requested_status' => 'present',
            'reason' => 'Was working remotely.',
            'status' => 'pending',
        ]);

        $this->actingAs($manager, 'sanctum');

        $response = $this->putJson("/api/v1/hr/attendance/regularizations/{$reg->id}/approve");

        $response->assertOk()
            ->assertJsonPath('data.status', 'approved');

        $this->assertDatabaseHas('attendance_records', [
            'id' => $record->id,
            'status' => 'present',
            'is_regularized' => true,
        ]);
    }

    public function test_employee_cannot_approve_regularization(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $otherEmployee = $this->createUser($org, 'employee');

        $record = AttendanceRecord::factory()->absent()->create([
            'organization_id' => $org->id,
            'user_id' => $otherEmployee->id,
            'date' => now()->subDay()->toDateString(),
        ]);

        $reg = AttendanceRegularization::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $otherEmployee->id,
            'attendance_record_id' => $record->id,
            'requested_status' => 'present',
            'status' => 'pending',
        ]);

        $this->actingAs($employee, 'sanctum');

        $response = $this->putJson("/api/v1/hr/attendance/regularizations/{$reg->id}/approve");

        $response->assertStatus(403);
    }

    // ── Overtime Rules ──────────────────────────────────

    public function test_can_get_overtime_rules(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $response = $this->getJson('/api/v1/hr/overtime-rules');

        $response->assertOk()
            ->assertJsonStructure([
                'data' => [
                    'daily_threshold_hours',
                    'weekly_threshold_hours',
                    'overtime_multiplier',
                    'weekend_multiplier',
                ],
            ]);
    }

    public function test_admin_can_update_overtime_rules(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'admin');
        $this->actingAs($admin, 'sanctum');

        // Ensure the rule exists first
        OvertimeRule::factory()->create([
            'organization_id' => $org->id,
        ]);

        $response = $this->putJson('/api/v1/hr/overtime-rules', [
            'daily_threshold_hours' => 9,
            'overtime_multiplier' => 2.0,
        ]);

        $response->assertOk()
            ->assertJsonPath('data.daily_threshold_hours', '9.00')
            ->assertJsonPath('data.overtime_multiplier', '2.00');
    }

    public function test_employee_cannot_update_overtime_rules(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $this->actingAs($employee, 'sanctum');

        $response = $this->putJson('/api/v1/hr/overtime-rules', [
            'daily_threshold_hours' => 9,
        ]);

        $response->assertStatus(403);
    }

    // ── Cross-Org Isolation ─────────────────────────────

    public function test_cross_org_isolation(): void
    {
        $orgA = $this->createOrganization();
        $orgB = $this->createOrganization();

        $adminA = $this->createUser($orgA, 'admin');
        $employeeB = $this->createUser($orgB, 'employee');

        // Create attendance record in org B
        $recordB = AttendanceRecord::factory()->present()->create([
            'organization_id' => $orgB->id,
            'user_id' => $employeeB->id,
            'date' => now()->subDay()->toDateString(),
        ]);

        $this->actingAs($adminA, 'sanctum');

        // Team view should not include org B's records
        $response = $this->getJson('/api/v1/hr/attendance/team');
        $response->assertOk();
        $ids = collect($response->json('data'))->pluck('id')->toArray();
        $this->assertNotContains($recordB->id, $ids);

        // Trying to regularize org B's record should 404
        $response = $this->postJson("/api/v1/hr/attendance/{$recordB->id}/regularize", [
            'requested_status' => 'present',
            'reason' => 'Cross-org attempt.',
        ]);
        $response->assertStatus(404);
    }
}
