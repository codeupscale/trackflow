<?php

namespace Tests\Feature\Hr;

use App\Exceptions\InsufficientLeaveBalanceException;
use App\Exceptions\LeaveOverlapException;
use App\Models\LeaveBalance;
use App\Models\LeaveRequest;
use App\Models\LeaveType;
use App\Models\PublicHoliday;
use App\Services\LeaveService;
use Carbon\Carbon;
use Tests\TestCase;

class LeaveServiceTest extends TestCase
{
    private LeaveService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = app(LeaveService::class);
    }

    // ── Apply Leave ──────────────────────────────────────

    public function test_apply_leave_happy_path(): void
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

        // Pick a future Monday-to-Friday range (5 working days)
        $monday = Carbon::now()->next('Monday');
        $friday = $monday->copy()->addDays(4);

        $result = $this->service->applyLeave($user, [
            'leave_type_id' => $leaveType->id,
            'start_date' => $monday->toDateString(),
            'end_date' => $friday->toDateString(),
            'reason' => 'Vacation',
        ]);

        $this->assertEquals('pending', $result->status);
        $this->assertEquals(5.0, (float) $result->days_count);

        // Balance should reflect pending days
        $balance = LeaveBalance::where('user_id', $user->id)
            ->where('leave_type_id', $leaveType->id)
            ->first();
        $this->assertEquals(5.0, (float) $balance->pending_days);
    }

    public function test_apply_leave_throws_when_insufficient_balance(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $leaveType = LeaveType::factory()->create([
            'organization_id' => $org->id,
            'days_per_year' => 2,
        ]);

        LeaveBalance::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'leave_type_id' => $leaveType->id,
            'year' => now()->year,
            'total_days' => 2,
            'used_days' => 0,
            'pending_days' => 0,
        ]);

        // Request 5 working days but only 2 available
        $monday = Carbon::now()->next('Monday');
        $friday = $monday->copy()->addDays(4);

        $this->expectException(InsufficientLeaveBalanceException::class);

        $this->service->applyLeave($user, [
            'leave_type_id' => $leaveType->id,
            'start_date' => $monday->toDateString(),
            'end_date' => $friday->toDateString(),
            'reason' => 'Long vacation',
        ]);
    }

    public function test_apply_leave_throws_on_date_overlap(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $leaveType = LeaveType::factory()->create([
            'organization_id' => $org->id,
            'days_per_year' => 20,
        ]);

        $monday = Carbon::now()->next('Monday');

        // Create an existing pending leave request
        LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'leave_type_id' => $leaveType->id,
            'start_date' => $monday->toDateString(),
            'end_date' => $monday->toDateString(),
            'days_count' => 1,
            'status' => 'pending',
        ]);

        LeaveBalance::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'leave_type_id' => $leaveType->id,
            'year' => $monday->year,
            'total_days' => 20,
            'used_days' => 0,
            'pending_days' => 1,
        ]);

        $this->expectException(LeaveOverlapException::class);

        $this->service->applyLeave($user, [
            'leave_type_id' => $leaveType->id,
            'start_date' => $monday->toDateString(),
            'end_date' => $monday->toDateString(),
            'reason' => 'Overlap attempt',
        ]);
    }

    public function test_apply_leave_half_day_deducts_0_5_days(): void
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

        // Pick a future weekday for half-day
        $date = Carbon::now()->next('Wednesday');

        $result = $this->service->applyLeave($user, [
            'leave_type_id' => $leaveType->id,
            'start_date' => $date->toDateString(),
            'end_date' => $date->toDateString(),
            'reason' => 'Half day',
            'half_day' => true,
        ]);

        $this->assertEquals(0.5, (float) $result->days_count);

        $balance = LeaveBalance::where('user_id', $user->id)
            ->where('leave_type_id', $leaveType->id)
            ->first();
        $this->assertEquals(0.5, (float) $balance->pending_days);
    }

    // ── Approve Leave ────────────────────────────────────

    public function test_approve_leave_moves_pending_to_used(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $approver = $this->createUser($org, 'admin');
        $this->actingAs($approver, 'sanctum');

        $leaveType = LeaveType::factory()->create(['organization_id' => $org->id]);

        $monday = Carbon::now()->next('Monday');

        $request = LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'leave_type_id' => $leaveType->id,
            'start_date' => $monday->toDateString(),
            'end_date' => $monday->toDateString(),
            'days_count' => 1.0,
            'status' => 'pending',
        ]);

        LeaveBalance::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'leave_type_id' => $leaveType->id,
            'year' => $monday->year,
            'total_days' => 20,
            'used_days' => 0,
            'pending_days' => 1.0,
        ]);

        $result = $this->service->approveLeave($request, $approver);

        $this->assertEquals('approved', $result->status);
        $this->assertEquals($approver->id, $result->approved_by);

        $balance = LeaveBalance::where('user_id', $user->id)
            ->where('leave_type_id', $leaveType->id)
            ->first();
        $this->assertEquals(0.0, (float) $balance->pending_days);
        $this->assertEquals(1.0, (float) $balance->used_days);
    }

    // ── Reject Leave ─────────────────────────────────────

    public function test_reject_leave_restores_pending_days(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $approver = $this->createUser($org, 'admin');
        $this->actingAs($approver, 'sanctum');

        $leaveType = LeaveType::factory()->create(['organization_id' => $org->id]);

        $monday = Carbon::now()->next('Monday');

        $request = LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'leave_type_id' => $leaveType->id,
            'start_date' => $monday->toDateString(),
            'end_date' => $monday->toDateString(),
            'days_count' => 1.0,
            'status' => 'pending',
        ]);

        LeaveBalance::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'leave_type_id' => $leaveType->id,
            'year' => $monday->year,
            'total_days' => 20,
            'used_days' => 0,
            'pending_days' => 1.0,
        ]);

        $result = $this->service->rejectLeave($request, $approver, 'Not now');

        $this->assertEquals('rejected', $result->status);
        $this->assertEquals('Not now', $result->rejection_reason);

        $balance = LeaveBalance::where('user_id', $user->id)
            ->where('leave_type_id', $leaveType->id)
            ->first();
        $this->assertEquals(0.0, (float) $balance->pending_days);
    }

    // ── Cancel Leave ─────────────────────────────────────

    public function test_cancel_pending_leave_restores_pending_days(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $leaveType = LeaveType::factory()->create(['organization_id' => $org->id]);

        $monday = Carbon::now()->next('Monday');

        $request = LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'leave_type_id' => $leaveType->id,
            'start_date' => $monday->toDateString(),
            'end_date' => $monday->toDateString(),
            'days_count' => 1.0,
            'status' => 'pending',
        ]);

        LeaveBalance::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'leave_type_id' => $leaveType->id,
            'year' => $monday->year,
            'total_days' => 20,
            'used_days' => 0,
            'pending_days' => 1.0,
        ]);

        $result = $this->service->cancelLeave($request, $user);

        $this->assertEquals('cancelled', $result->status);

        $balance = LeaveBalance::where('user_id', $user->id)
            ->where('leave_type_id', $leaveType->id)
            ->first();
        $this->assertEquals(0.0, (float) $balance->pending_days);
    }

    public function test_cancel_approved_leave_restores_used_days(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $leaveType = LeaveType::factory()->create(['organization_id' => $org->id]);

        $monday = Carbon::now()->next('Monday');

        $request = LeaveRequest::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'leave_type_id' => $leaveType->id,
            'start_date' => $monday->toDateString(),
            'end_date' => $monday->toDateString(),
            'days_count' => 1.0,
            'status' => 'approved',
            'approved_at' => now(),
        ]);

        LeaveBalance::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'leave_type_id' => $leaveType->id,
            'year' => $monday->year,
            'total_days' => 20,
            'used_days' => 1.0,
            'pending_days' => 0,
        ]);

        $result = $this->service->cancelLeave($request, $user);

        $this->assertEquals('cancelled', $result->status);

        $balance = LeaveBalance::where('user_id', $user->id)
            ->where('leave_type_id', $leaveType->id)
            ->first();
        $this->assertEquals(0.0, (float) $balance->used_days);
    }

    // ── Calculate Working Days ───────────────────────────

    public function test_calculate_working_days_excludes_weekends(): void
    {
        $org = $this->createOrganization();

        // Monday to Sunday = 5 working days
        $monday = Carbon::now()->next('Monday');
        $sunday = $monday->copy()->addDays(6);

        $days = $this->service->calculateWorkingDays($monday, $sunday, $org->id);

        $this->assertEquals(5.0, $days);
    }

    public function test_calculate_working_days_excludes_public_holidays(): void
    {
        $org = $this->createOrganization();

        // Monday to Friday = normally 5 working days
        $monday = Carbon::now()->next('Monday');
        $friday = $monday->copy()->addDays(4);

        // Add a public holiday on Wednesday
        $wednesday = $monday->copy()->addDays(2);
        PublicHoliday::factory()->create([
            'organization_id' => $org->id,
            'name' => 'Test Holiday',
            'date' => $wednesday->toDateString(),
        ]);

        $days = $this->service->calculateWorkingDays($monday, $friday, $org->id);

        $this->assertEquals(4.0, $days);
    }
}
