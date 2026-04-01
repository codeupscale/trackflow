<?php

namespace Tests\Unit\Services;

use App\Models\LeaveBalance;
use App\Models\LeaveRequest;
use App\Models\LeaveType;
use App\Models\PublicHoliday;
use App\Services\LeaveService;
use Carbon\Carbon;
use Tests\TestCase;

/**
 * Additional unit tests for LeaveService.
 * The existing Feature/Hr/LeaveServiceTest covers: apply, approve, reject, cancel, calculate working days.
 * This test covers: initializeBalances, getLeaveCalendar, edge cases.
 */
class LeaveServiceUnitTest extends TestCase
{
    private LeaveService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = app(LeaveService::class);
    }

    // ── Initialize Balances ─────────────────────────────

    public function test_initialize_balances_creates_records_for_all_active_leave_types(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $annualLeave = LeaveType::factory()->create([
            'organization_id' => $org->id,
            'name' => 'Annual Leave',
            'days_per_year' => 20,
            'is_active' => true,
        ]);

        $sickLeave = LeaveType::factory()->create([
            'organization_id' => $org->id,
            'name' => 'Sick Leave',
            'days_per_year' => 10,
            'is_active' => true,
        ]);

        // Inactive leave type should NOT get a balance
        LeaveType::factory()->create([
            'organization_id' => $org->id,
            'name' => 'Parental Leave',
            'is_active' => false,
        ]);

        $this->service->initializeBalances($user, $org->id, 2026);

        $this->assertDatabaseHas('leave_balances', [
            'user_id' => $user->id,
            'leave_type_id' => $annualLeave->id,
            'year' => 2026,
            'total_days' => 20,
            'used_days' => 0,
            'pending_days' => 0,
        ]);

        $this->assertDatabaseHas('leave_balances', [
            'user_id' => $user->id,
            'leave_type_id' => $sickLeave->id,
            'year' => 2026,
            'total_days' => 10,
        ]);

        // Only 2 balances should exist (not the inactive one)
        $count = LeaveBalance::where('user_id', $user->id)->where('year', 2026)->count();
        $this->assertEquals(2, $count);
    }

    public function test_initialize_balances_is_idempotent(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $leaveType = LeaveType::factory()->create([
            'organization_id' => $org->id,
            'days_per_year' => 15,
            'is_active' => true,
        ]);

        // Initialize once
        $this->service->initializeBalances($user, $org->id, 2026);

        // Manually update used_days
        LeaveBalance::where('user_id', $user->id)
            ->where('leave_type_id', $leaveType->id)
            ->update(['used_days' => 5]);

        // Initialize again — should NOT overwrite existing balance
        $this->service->initializeBalances($user, $org->id, 2026);

        $balance = LeaveBalance::where('user_id', $user->id)
            ->where('leave_type_id', $leaveType->id)
            ->where('year', 2026)
            ->first();

        $this->assertEquals(5.0, (float) $balance->used_days);

        // Still only 1 balance record
        $count = LeaveBalance::where('user_id', $user->id)->where('year', 2026)->count();
        $this->assertEquals(1, $count);
    }

    public function test_initialize_balances_with_no_active_leave_types_creates_nothing(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        // Only inactive leave types
        LeaveType::factory()->create([
            'organization_id' => $org->id,
            'is_active' => false,
        ]);

        $this->service->initializeBalances($user, $org->id, 2026);

        $count = LeaveBalance::where('user_id', $user->id)->where('year', 2026)->count();
        $this->assertEquals(0, $count);
    }

    // ── Get Leave Calendar ──────────────────────────────

    public function test_get_leave_calendar_returns_grouped_by_date(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $leaveType = LeaveType::factory()->create(['organization_id' => $org->id]);

        // Leave request spanning Jan 6-8 2026 (Mon-Wed)
        LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'leave_type_id' => $leaveType->id,
            'start_date' => '2026-01-06',
            'end_date' => '2026-01-08',
            'days_count' => 3,
            'status' => 'approved',
        ]);

        $calendar = $this->service->getLeaveCalendar($org->id, 1, 2026);

        // Should have entries for Jan 6, 7, and 8
        $this->assertArrayHasKey('2026-01-06', $calendar);
        $this->assertArrayHasKey('2026-01-07', $calendar);
        $this->assertArrayHasKey('2026-01-08', $calendar);
        $this->assertCount(1, $calendar['2026-01-06']);
    }

    public function test_get_leave_calendar_includes_pending_and_approved_only(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $leaveType = LeaveType::factory()->create(['organization_id' => $org->id]);

        // Approved
        LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'leave_type_id' => $leaveType->id,
            'start_date' => '2026-03-02',
            'end_date' => '2026-03-02',
            'days_count' => 1,
            'status' => 'approved',
        ]);

        // Pending
        LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'leave_type_id' => $leaveType->id,
            'start_date' => '2026-03-03',
            'end_date' => '2026-03-03',
            'days_count' => 1,
            'status' => 'pending',
        ]);

        // Rejected — should NOT appear
        LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'leave_type_id' => $leaveType->id,
            'start_date' => '2026-03-04',
            'end_date' => '2026-03-04',
            'days_count' => 1,
            'status' => 'rejected',
        ]);

        $calendar = $this->service->getLeaveCalendar($org->id, 3, 2026);

        $this->assertArrayHasKey('2026-03-02', $calendar);
        $this->assertArrayHasKey('2026-03-03', $calendar);
        $this->assertArrayNotHasKey('2026-03-04', $calendar);
    }

    public function test_get_leave_calendar_clips_to_month_boundaries(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $leaveType = LeaveType::factory()->create(['organization_id' => $org->id]);

        // Leave request spanning Jan 29 - Feb 3 2026
        LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'leave_type_id' => $leaveType->id,
            'start_date' => '2026-01-29',
            'end_date' => '2026-02-03',
            'days_count' => 4,
            'status' => 'approved',
        ]);

        // Querying February — should only show Feb 1-3
        $calendar = $this->service->getLeaveCalendar($org->id, 2, 2026);

        $this->assertArrayHasKey('2026-02-01', $calendar);
        $this->assertArrayHasKey('2026-02-02', $calendar);
        $this->assertArrayHasKey('2026-02-03', $calendar);
        $this->assertArrayNotHasKey('2026-01-29', $calendar);
        $this->assertArrayNotHasKey('2026-01-30', $calendar);
    }

    public function test_get_leave_calendar_returns_empty_array_when_no_leave(): void
    {
        $org = $this->createOrganization();

        $calendar = $this->service->getLeaveCalendar($org->id, 6, 2026);

        $this->assertIsArray($calendar);
        $this->assertEmpty($calendar);
    }

    public function test_get_leave_calendar_entry_contains_expected_fields(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $leaveType = LeaveType::factory()->create([
            'organization_id' => $org->id,
            'name' => 'Sick Leave',
            'code' => 'SL-001',
        ]);

        LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'leave_type_id' => $leaveType->id,
            'start_date' => '2026-04-15',
            'end_date' => '2026-04-15',
            'days_count' => 1,
            'status' => 'pending',
        ]);

        $calendar = $this->service->getLeaveCalendar($org->id, 4, 2026);

        $entry = $calendar['2026-04-15'][0];
        $this->assertArrayHasKey('id', $entry);
        $this->assertArrayHasKey('user', $entry);
        $this->assertArrayHasKey('leave_type', $entry);
        $this->assertArrayHasKey('status', $entry);
        $this->assertArrayHasKey('days_count', $entry);
        $this->assertArrayHasKey('start_date', $entry);
        $this->assertArrayHasKey('end_date', $entry);
        $this->assertEquals('pending', $entry['status']);
    }

    // ── Calculate Working Days — Edge Cases ──────────────

    public function test_calculate_working_days_half_day_returns_0_5(): void
    {
        $org = $this->createOrganization();

        // A Wednesday
        $date = Carbon::parse('2026-04-01');

        $days = $this->service->calculateWorkingDays($date, $date, $org->id, halfDay: true);

        $this->assertEquals(0.5, $days);
    }

    public function test_calculate_working_days_half_day_on_last_day_of_month(): void
    {
        $org = $this->createOrganization();

        // April 30, 2026 is a Thursday
        $date = Carbon::parse('2026-04-30');

        $days = $this->service->calculateWorkingDays($date, $date, $org->id, halfDay: true);

        $this->assertEquals(0.5, $days);
    }

    public function test_calculate_working_days_excludes_public_holidays_in_range(): void
    {
        $org = $this->createOrganization();

        // Mon Jan 5 to Fri Jan 9 2026 = 5 weekdays
        $monday = Carbon::parse('2026-01-05');
        $friday = Carbon::parse('2026-01-09');

        // Add 2 holidays on Wed and Thu
        PublicHoliday::factory()->create([
            'organization_id' => $org->id,
            'date' => '2026-01-07',
        ]);
        PublicHoliday::factory()->create([
            'organization_id' => $org->id,
            'date' => '2026-01-08',
        ]);

        $days = $this->service->calculateWorkingDays($monday, $friday, $org->id);

        // 5 weekdays - 2 holidays = 3
        $this->assertEquals(3.0, $days);
    }

    public function test_calculate_working_days_holiday_on_weekend_has_no_effect(): void
    {
        $org = $this->createOrganization();

        // Mon Jan 5 to Fri Jan 9 2026 = 5 weekdays
        $monday = Carbon::parse('2026-01-05');
        $friday = Carbon::parse('2026-01-09');

        // Holiday on a Saturday (Jan 10) — outside the range anyway
        // Let's put a holiday on the Sat within a wider range
        // Actually, our range is Mon-Fri, so a Saturday holiday wouldn't be in range.
        // For clarity, use a Mon-Sun range: Mon Jan 5 - Sun Jan 11
        $sunday = Carbon::parse('2026-01-11');

        PublicHoliday::factory()->create([
            'organization_id' => $org->id,
            'date' => '2026-01-10', // Saturday
        ]);

        $days = $this->service->calculateWorkingDays($monday, $sunday, $org->id);

        // Weekdays: Mon-Fri = 5, no weekday holidays
        $this->assertEquals(5.0, $days);
    }

    public function test_calculate_working_days_single_weekend_day_returns_zero(): void
    {
        $org = $this->createOrganization();

        $saturday = Carbon::parse('2026-01-10'); // Saturday

        $days = $this->service->calculateWorkingDays($saturday, $saturday, $org->id);

        $this->assertEquals(0.0, $days);
    }

    // ── Team Threshold (>30% on leave) ──────────────────

    public function test_leave_calendar_shows_multiple_users_on_same_day(): void
    {
        $org = $this->createOrganization();
        $leaveType = LeaveType::factory()->create(['organization_id' => $org->id]);

        // Create 4 users, put 2 on leave on the same day
        $users = [];
        for ($i = 0; $i < 4; $i++) {
            $users[] = $this->createUser($org, 'employee');
        }

        // Authenticate as first user for org scoping
        $this->actingAs($users[0], 'sanctum');

        LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $users[0]->id,
            'leave_type_id' => $leaveType->id,
            'start_date' => '2026-05-04',
            'end_date' => '2026-05-04',
            'days_count' => 1,
            'status' => 'approved',
        ]);

        LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $users[1]->id,
            'leave_type_id' => $leaveType->id,
            'start_date' => '2026-05-04',
            'end_date' => '2026-05-04',
            'days_count' => 1,
            'status' => 'approved',
        ]);

        $calendar = $this->service->getLeaveCalendar($org->id, 5, 2026);

        // 2 users on leave on May 4 — callers can compute 2/4 = 50% > 30% threshold
        $this->assertCount(2, $calendar['2026-05-04']);
    }
}
