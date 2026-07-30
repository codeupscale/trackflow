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
    protected function tearDown(): void
    {
        Carbon::setTestNow(); // reset any pinned clock
        parent::tearDown();
    }

    // ── Own Attendance ──────────────────────────────────

    public function test_can_view_own_attendance(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        AttendanceRecord::factory()->present()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'date' => '2026-05-05',
        ]);

        // Single-day range matching the record → exactly the one real row.
        $response = $this->getJson('/api/v1/hr/attendance?start_date=2026-05-05&end_date=2026-05-05');

        $response->assertOk()
            ->assertJsonStructure([
                'data' => [
                    '*' => ['id', 'date', 'status', 'total_hours'],
                ],
            ]);
        $this->assertCount(1, $response->json('data'));
        $this->assertEquals('present', $response->json('data.0.status'));
    }

    public function test_own_attendance_synthesises_missing_days_as_absent_or_weekend(): void
    {
        // Regression: the self "My Attendance" table must show EVERY day in range —
        // days with no generated attendance_record (the common case on environments
        // where GenerateDailyAttendanceJob never runs) are synthesised as
        // holiday/on_leave/weekend/absent, not simply omitted.
        Carbon::setTestNow(Carbon::parse('2026-03-05 12:00:00'));

        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        // Only one real record in the window; the other days have none.
        AttendanceRecord::factory()->present()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'date' => '2026-03-03', // Tuesday
        ]);

        $response = $this->getJson('/api/v1/hr/attendance?start_date=2026-03-01&end_date=2026-03-05');

        $response->assertOk();
        $rows = collect($response->json('data'));
        $this->assertCount(5, $rows); // 03-01 .. 03-05, every day present

        $byDate = $rows->keyBy('date');
        $this->assertEquals('present', $byDate['2026-03-03']['status']); // real record
        $this->assertFalse($byDate['2026-03-03']['is_synthetic']);
        $this->assertEquals('absent', $byDate['2026-03-04']['status']);  // Wed, synthesised
        $this->assertTrue($byDate['2026-03-04']['is_synthetic']);
        $this->assertEquals('weekend', $byDate['2026-03-01']['status']); // Sunday, synthesised
    }

    public function test_own_attendance_does_not_synthesise_future_days(): void
    {
        // Future days in the requested range are not absences yet — never synthesised.
        Carbon::setTestNow(Carbon::parse('2026-03-03 12:00:00'));

        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        // Whole month requested, but only 03-01..03-03 has happened.
        $response = $this->getJson('/api/v1/hr/attendance?start_date=2026-03-01&end_date=2026-03-31');

        $response->assertOk();
        $rows = collect($response->json('data'));
        $this->assertCount(3, $rows); // capped at today (03-03)
        $this->assertNull($rows->firstWhere('date', '2026-03-04'));
    }

    public function test_cannot_view_other_user_attendance(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $otherEmployee = $this->createUser($org, 'employee');

        // Create a worked (present) record for the OTHER employee.
        AttendanceRecord::factory()->present()->create([
            'organization_id' => $org->id,
            'user_id' => $otherEmployee->id,
            'date' => '2026-05-05',
        ]);

        $this->actingAs($employee, 'sanctum');

        // The index endpoint only ever returns the authenticated user's rows. The self
        // view now synthesises a per-day roster, but every row must belong to the caller
        // and none may leak the other employee's worked record.
        $response = $this->getJson('/api/v1/hr/attendance?start_date=2026-05-05&end_date=2026-05-05');

        $response->assertOk();
        $rows = collect($response->json('data'));
        $this->assertTrue($rows->every(fn ($r) => $r['user_id'] === $employee->id));
        // The caller has no real record that day → the synthesised row is absent (0h),
        // proving the other employee's present record did not leak in.
        $this->assertTrue($rows->every(fn ($r) => (float) $r['total_hours'] === 0.0));
    }

    // ── Team Attendance ─────────────────────────────────

    public function test_manager_can_view_team_attendance(): void
    {
        $org = $this->createOrganization();
        $manager = $this->createUser($org, 'org_manager');
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

    public function test_team_attendance_can_be_searched_by_employee_name(): void
    {
        $org = $this->createOrganization();
        $manager = $this->createUser($org, 'org_manager');
        $target = $this->createUser($org, 'employee', ['name' => 'Ali Khan']);
        $other = $this->createUser($org, 'employee', ['name' => 'Faiz Rehmat']);

        $this->actingAs($manager, 'sanctum');

        $response = $this->getJson('/api/v1/hr/attendance/team?search=ali kh');

        $response->assertOk();
        $userIds = collect($response->json('data'))->pluck('user_id')->unique();
        $this->assertContains($target->id, $userIds);
        $this->assertNotContains($other->id, $userIds);
        $this->assertNotContains($manager->id, $userIds);
    }

    public function test_team_attendance_search_is_case_insensitive_and_matches_email(): void
    {
        $org = $this->createOrganization();
        $manager = $this->createUser($org, 'org_manager');
        $target = $this->createUser($org, 'employee', [
            'name' => 'Abdullah Iftikhar',
            'email' => 'abdullah.iftikhar@example.com',
        ]);
        $other = $this->createUser($org, 'employee', ['name' => 'Ahtisham Butt']);

        $this->actingAs($manager, 'sanctum');

        $response = $this->getJson('/api/v1/hr/attendance/team?search=ABDULLAH.IFTIKHAR@EXAMPLE');

        $response->assertOk();
        $userIds = collect($response->json('data'))->pluck('user_id')->unique();
        $this->assertContains($target->id, $userIds);
        $this->assertNotContains($other->id, $userIds);
    }

    public function test_team_attendance_search_wildcards_are_escaped(): void
    {
        $org = $this->createOrganization();
        $manager = $this->createUser($org, 'org_manager');
        $this->createUser($org, 'employee', ['name' => 'Ali Khan']);

        $this->actingAs($manager, 'sanctum');

        // A bare "%" must be treated literally, not as "match everything".
        $response = $this->getJson('/api/v1/hr/attendance/team?search=%25');

        $response->assertOk();
        $this->assertSame([], $response->json('data'));
    }

    public function test_team_attendance_search_cannot_cross_org(): void
    {
        $orgA = $this->createOrganization();
        $orgB = $this->createOrganization();
        $manager = $this->createUser($orgA, 'org_manager');
        $foreign = $this->createUser($orgB, 'employee', ['name' => 'Ali Khan']);

        $this->actingAs($manager, 'sanctum');

        $response = $this->getJson('/api/v1/hr/attendance/team?search=Ali Khan');

        $response->assertOk();
        $userIds = collect($response->json('data'))->pluck('user_id')->unique();
        $this->assertNotContains($foreign->id, $userIds);
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
        // Pin "today" to the 2nd so the month-to-date window is exactly the two days
        // that carry records — the summary now walks the real calendar, so an open
        // window would also count every intervening weekday as absent.
        Carbon::setTestNow(Carbon::parse('2026-03-02 12:00:00'));

        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        // Create records for the two days of the window (03-01 present, 03-02 absent).
        AttendanceRecord::factory()->present()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'date' => '2026-03-01',
        ]);
        AttendanceRecord::factory()->absent()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'date' => '2026-03-02',
        ]);

        $response = $this->getJson('/api/v1/hr/attendance/summary?month=3&year=2026');

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

    public function test_summary_counts_check_in_lateness_and_overtime(): void
    {
        // Regression: the Late Days / Overtime tiles must reflect manual
        // check-in signals (check_in_late_minutes / check_out_overtime_minutes),
        // not just the legacy tracker columns which stay 0 for clock-in flows.
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $month = now()->month;
        $year = now()->year;

        AttendanceRecord::factory()->present()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'date' => now()->startOfMonth()->toDateString(),
            // Legacy tracker columns are zero — lateness/overtime live in check-in cols.
            'late_minutes' => 0,
            'overtime_minutes' => 0,
            'check_in_status' => 'late',
            'check_in_late_minutes' => 15,
            'check_out_overtime_minutes' => 90,
        ]);

        $response = $this->getJson("/api/v1/hr/attendance/summary?month={$month}&year={$year}");

        $response->assertOk()
            ->assertJsonPath('data.late_days', 1)
            ->assertJsonPath('data.overtime_hours', 1.5); // 90 min = 1.5h
    }

    // ── Generate ────────────────────────────────────────

    public function test_admin_can_trigger_attendance_generation(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'org_manager');
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
        $manager = $this->createUser($org, 'org_manager');
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
        $admin = $this->createUser($org, 'org_manager');
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

        $adminA = $this->createUser($orgA, 'org_manager');
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

    // ── Regularization Rejection ────────────────────────

    public function test_manager_can_reject_regularization_with_review_note(): void
    {
        $org = $this->createOrganization();
        $manager = $this->createUser($org, 'org_manager');
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
            'status' => 'pending',
        ]);

        $this->actingAs($manager, 'sanctum');

        $response = $this->putJson("/api/v1/hr/attendance/regularizations/{$reg->id}/reject", [
            'review_note' => 'No evidence of remote work found.',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.status', 'rejected');

        $this->assertDatabaseHas('attendance_regularizations', [
            'id' => $reg->id,
            'status' => 'rejected',
            'reviewed_by' => $manager->id,
            'review_note' => 'No evidence of remote work found.',
        ]);

        // Attendance record should NOT be updated on rejection
        $this->assertDatabaseHas('attendance_records', [
            'id' => $record->id,
            'status' => 'absent',
            'is_regularized' => false,
        ]);
    }

    public function test_reject_regularization_requires_review_note(): void
    {
        $org = $this->createOrganization();
        $manager = $this->createUser($org, 'org_manager');
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
            'status' => 'pending',
        ]);

        $this->actingAs($manager, 'sanctum');

        $response = $this->putJson("/api/v1/hr/attendance/regularizations/{$reg->id}/reject", []);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['review_note']);
    }

    // ── Duplicate Regularization Prevention ─────────────

    public function test_duplicate_pending_regularization_returns_422(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $this->actingAs($employee, 'sanctum');

        $record = AttendanceRecord::factory()->absent()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'date' => now()->subDay()->toDateString(),
        ]);

        // First regularization request — should succeed
        $response = $this->postJson("/api/v1/hr/attendance/{$record->id}/regularize", [
            'requested_status' => 'present',
            'reason' => 'Was working remotely.',
        ]);
        $response->assertStatus(201);

        // Second regularization request on same record — should fail
        $response = $this->postJson("/api/v1/hr/attendance/{$record->id}/regularize", [
            'requested_status' => 'half_day',
            'reason' => 'Actually was half day.',
        ]);
        $response->assertStatus(422);
    }

    // ── Date Filtering ──────────────────────────────────

    public function test_attendance_date_filtering_works(): void
    {
        // Pin today after the window so the past-range synthesis is deterministic.
        Carbon::setTestNow(Carbon::parse('2026-04-01 12:00:00'));

        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        foreach (['2026-03-01', '2026-03-15', '2026-03-31'] as $d) {
            AttendanceRecord::factory()->present()->create([
                'organization_id' => $org->id,
                'user_id' => $user->id,
                'date' => $d,
            ]);
        }

        // Filter to March 10-20: the self roster fills every day in range, but only the
        // in-range real record (03-15) is present; out-of-range records don't appear.
        $response = $this->getJson('/api/v1/hr/attendance?start_date=2026-03-10&end_date=2026-03-20');

        $response->assertOk();
        $rows = collect($response->json('data'));
        $this->assertCount(11, $rows); // 03-10 .. 03-20
        $march15 = $rows->firstWhere('date', '2026-03-15');
        $this->assertNotNull($march15);
        $this->assertEquals('present', $march15['status']);
        // Out-of-range real records are excluded.
        $this->assertNull($rows->firstWhere('date', '2026-03-01'));
        $this->assertNull($rows->firstWhere('date', '2026-03-31'));
    }

    // ── Summary Validation ──────────────────────────────

    public function test_summary_validates_month_and_year_required(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        // Missing both month and year
        $response = $this->getJson('/api/v1/hr/attendance/summary');
        $response->assertStatus(422)
            ->assertJsonValidationErrors(['month', 'year']);

        // Missing year
        $response = $this->getJson('/api/v1/hr/attendance/summary?month=3');
        $response->assertStatus(422)
            ->assertJsonValidationErrors(['year']);

        // Missing month
        $response = $this->getJson('/api/v1/hr/attendance/summary?year=2026');
        $response->assertStatus(422)
            ->assertJsonValidationErrors(['month']);
    }

    // ── Team Attendance Filters ─────────────────────────

    public function test_team_attendance_filters_by_user_id(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'org_manager');
        $emp1 = $this->createUser($org, 'employee');
        $emp2 = $this->createUser($org, 'employee');

        AttendanceRecord::factory()->present()->create([
            'organization_id' => $org->id,
            'user_id' => $emp1->id,
            'date' => now()->subDay()->toDateString(),
        ]);
        AttendanceRecord::factory()->present()->create([
            'organization_id' => $org->id,
            'user_id' => $emp2->id,
            'date' => now()->subDay()->toDateString(),
        ]);

        $this->actingAs($admin, 'sanctum');

        $response = $this->getJson("/api/v1/hr/attendance/team?user_id={$emp1->id}");

        $response->assertOk();
        $data = $response->json('data');
        $this->assertCount(1, $data);
        $this->assertEquals($emp1->id, $data[0]['user_id']);
    }

    public function test_team_attendance_filters_by_department_id(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'org_manager');
        $emp1 = $this->createUser($org, 'employee');
        $emp2 = $this->createUser($org, 'employee');

        $dept = \App\Models\Department::factory()->create([
            'organization_id' => $org->id,
        ]);

        \App\Models\EmployeeProfile::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $emp1->id,
            'department_id' => $dept->id,
        ]);
        \App\Models\EmployeeProfile::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $emp2->id,
            'department_id' => null,
        ]);

        AttendanceRecord::factory()->present()->create([
            'organization_id' => $org->id,
            'user_id' => $emp1->id,
            'date' => now()->subDay()->toDateString(),
        ]);
        AttendanceRecord::factory()->present()->create([
            'organization_id' => $org->id,
            'user_id' => $emp2->id,
            'date' => now()->subDay()->toDateString(),
        ]);

        $this->actingAs($admin, 'sanctum');

        $response = $this->getJson("/api/v1/hr/attendance/team?department_id={$dept->id}");

        $response->assertOk();
        $data = $response->json('data');
        $this->assertCount(1, $data);
        $this->assertEquals($emp1->id, $data[0]['user_id']);
    }

    // ── Generate Attendance Status Thresholds ───────────

    public function test_generate_attendance_present_for_4_or_more_hours(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'org_manager');
        $employee = $this->createUser($org, 'employee');
        $this->actingAs($admin, 'sanctum');

        $targetDate = '2026-03-16'; // Monday

        // 5 hours of work => present
        TimeEntry::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'started_at' => Carbon::parse($targetDate)->setTime(9, 0),
            'ended_at' => Carbon::parse($targetDate)->setTime(14, 0),
            'duration_seconds' => 5 * 3600,
        ]);

        $this->postJson('/api/v1/hr/attendance/generate', ['date' => $targetDate])
            ->assertOk();

        $record = AttendanceRecord::where('organization_id', $org->id)
            ->where('user_id', $employee->id)
            ->whereDate('date', $targetDate)
            ->first();

        $this->assertNotNull($record);
        $this->assertEquals('present', $record->status);
    }

    public function test_generate_attendance_half_day_for_2_to_4_hours(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'org_manager');
        $employee = $this->createUser($org, 'employee');
        $this->actingAs($admin, 'sanctum');

        $targetDate = '2026-03-16'; // Monday

        // 3 hours of work => half_day
        TimeEntry::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'started_at' => Carbon::parse($targetDate)->setTime(9, 0),
            'ended_at' => Carbon::parse($targetDate)->setTime(12, 0),
            'duration_seconds' => 3 * 3600,
        ]);

        $this->postJson('/api/v1/hr/attendance/generate', ['date' => $targetDate])
            ->assertOk();

        $record = AttendanceRecord::where('organization_id', $org->id)
            ->where('user_id', $employee->id)
            ->whereDate('date', $targetDate)
            ->first();

        $this->assertNotNull($record);
        $this->assertEquals('half_day', $record->status);
    }

    public function test_generate_attendance_absent_for_less_than_2_hours(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'org_manager');
        $employee = $this->createUser($org, 'employee');
        $this->actingAs($admin, 'sanctum');

        $targetDate = '2026-03-16'; // Monday

        // 1 hour of work => absent
        TimeEntry::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'started_at' => Carbon::parse($targetDate)->setTime(9, 0),
            'ended_at' => Carbon::parse($targetDate)->setTime(10, 0),
            'duration_seconds' => 1 * 3600,
        ]);

        $this->postJson('/api/v1/hr/attendance/generate', ['date' => $targetDate])
            ->assertOk();

        $record = AttendanceRecord::where('organization_id', $org->id)
            ->where('user_id', $employee->id)
            ->whereDate('date', $targetDate)
            ->first();

        $this->assertNotNull($record);
        $this->assertEquals('absent', $record->status);
    }
}
