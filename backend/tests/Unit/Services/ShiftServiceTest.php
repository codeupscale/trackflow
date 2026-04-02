<?php

namespace Tests\Unit\Services;

use App\Models\Shift;
use App\Models\ShiftSwapRequest;
use App\Models\User;
use App\Services\ShiftService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

class ShiftServiceTest extends TestCase
{
    private ShiftService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = app(ShiftService::class);
    }

    // ── Helper ──────────────────────────────────────────

    /**
     * Assign a user to a shift via the pivot table directly.
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

    // ── CRUD ────────────────────────────────────────────

    public function test_create_shift_with_valid_data(): void
    {
        $org = $this->createOrganization();

        $shift = $this->service->createShift($org->id, [
            'name' => 'Morning Shift',
            'start_time' => '06:00',
            'end_time' => '14:00',
            'days_of_week' => ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
            'break_minutes' => 30,
            'color' => '#FF5733',
        ]);

        $this->assertInstanceOf(Shift::class, $shift);
        $this->assertEquals($org->id, $shift->organization_id);
        $this->assertEquals('Morning Shift', $shift->name);
        $this->assertEquals('06:00', $shift->start_time);
        $this->assertEquals('14:00', $shift->end_time);
        $this->assertEquals(30, $shift->break_minutes);
        $this->assertDatabaseHas('shifts', [
            'id' => $shift->id,
            'organization_id' => $org->id,
            'name' => 'Morning Shift',
        ]);
    }

    public function test_list_shifts_paginates(): void
    {
        $org = $this->createOrganization();

        Shift::factory()->count(5)->create([
            'organization_id' => $org->id,
        ]);

        $result = $this->service->listShifts($org->id, ['per_page' => 3]);

        $this->assertInstanceOf(\Illuminate\Contracts\Pagination\LengthAwarePaginator::class, $result);
        $this->assertEquals(5, $result->total());
        $this->assertCount(3, $result->items());
    }

    public function test_list_shifts_filters_by_is_active(): void
    {
        $org = $this->createOrganization();

        Shift::factory()->create([
            'organization_id' => $org->id,
            'is_active' => true,
            'name' => 'Active Shift',
        ]);
        Shift::factory()->create([
            'organization_id' => $org->id,
            'is_active' => false,
            'name' => 'Inactive Shift',
        ]);

        $active = $this->service->listShifts($org->id, ['is_active' => 'true']);
        $this->assertEquals(1, $active->total());
        $this->assertEquals('Active Shift', $active->first()->name);

        $inactive = $this->service->listShifts($org->id, ['is_active' => 'false']);
        $this->assertEquals(1, $inactive->total());
        $this->assertEquals('Inactive Shift', $inactive->first()->name);
    }

    public function test_update_shift_changes_fields(): void
    {
        $org = $this->createOrganization();

        $shift = Shift::factory()->create([
            'organization_id' => $org->id,
            'name' => 'Old Name',
            'break_minutes' => 15,
        ]);

        $updated = $this->service->updateShift($shift, [
            'name' => 'New Name',
            'break_minutes' => 45,
        ]);

        $this->assertEquals('New Name', $updated->name);
        $this->assertEquals(45, $updated->break_minutes);
        $this->assertDatabaseHas('shifts', [
            'id' => $shift->id,
            'name' => 'New Name',
            'break_minutes' => 45,
        ]);
    }

    public function test_delete_shift_soft_deletes_and_ends_assignments(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');

        $shift = Shift::factory()->create([
            'organization_id' => $org->id,
        ]);

        // Create an active assignment (no end date)
        $this->assignShiftToUser($org->id, $user->id, $shift->id, '2026-01-01');

        $this->service->deleteShift($shift);

        // Shift should be soft deleted
        $this->assertSoftDeleted('shifts', ['id' => $shift->id]);

        // Active assignment should have effective_to set to today
        $pivot = DB::table('user_shifts')
            ->where('shift_id', $shift->id)
            ->where('user_id', $user->id)
            ->first();

        $this->assertEquals(now()->toDateString(), $pivot->effective_to);
    }

    // ── Assignments ─────────────────────────────────────

    public function test_assign_user_creates_pivot_record(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $shift = Shift::factory()->create(['organization_id' => $org->id]);

        $this->service->assignUser(
            $org->id,
            $user->id,
            $shift->id,
            '2026-04-01',
            '2026-12-31',
        );

        $this->assertDatabaseHas('user_shifts', [
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'shift_id' => $shift->id,
            'effective_from' => '2026-04-01',
            'effective_to' => '2026-12-31',
        ]);
    }

    public function test_assign_user_rejects_overlapping_assignment(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $shift1 = Shift::factory()->create(['organization_id' => $org->id]);
        $shift2 = Shift::factory()->create(['organization_id' => $org->id]);

        // Assign user to shift1 from April to June
        $this->assignShiftToUser($org->id, $user->id, $shift1->id, '2026-04-01', '2026-06-30');

        // Try to assign to shift2 with overlapping period (May - July)
        $this->expectException(HttpException::class);

        $this->service->assignUser(
            $org->id,
            $user->id,
            $shift2->id,
            '2026-05-01',
            '2026-07-31',
        );
    }

    public function test_unassign_user_sets_effective_to(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $shift = Shift::factory()->create(['organization_id' => $org->id]);

        // Assign with no end date (open-ended)
        $this->assignShiftToUser($org->id, $user->id, $shift->id, '2026-01-01');

        $this->service->unassignUser($org->id, $user->id, $shift->id);

        $pivot = DB::table('user_shifts')
            ->where('shift_id', $shift->id)
            ->where('user_id', $user->id)
            ->first();

        $this->assertEquals(now()->toDateString(), $pivot->effective_to);
    }

    public function test_bulk_assign_creates_multiple_pivots(): void
    {
        $org = $this->createOrganization();
        $user1 = $this->createUser($org, 'employee');
        $user2 = $this->createUser($org, 'employee');
        $user3 = $this->createUser($org, 'employee');
        $shift = Shift::factory()->create(['organization_id' => $org->id]);

        $count = $this->service->bulkAssign(
            $org->id,
            $shift->id,
            [$user1->id, $user2->id, $user3->id],
            '2026-04-01',
            null,
        );

        $this->assertEquals(3, $count);

        $pivotCount = DB::table('user_shifts')
            ->where('shift_id', $shift->id)
            ->where('organization_id', $org->id)
            ->count();

        $this->assertEquals(3, $pivotCount);
    }

    public function test_get_user_current_shift_returns_active_shift(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');

        $shift = Shift::factory()->create([
            'organization_id' => $org->id,
            'name' => 'Day Shift',
        ]);

        // Assign from past to open-ended
        $this->assignShiftToUser($org->id, $user->id, $shift->id, '2026-01-01');

        $result = $this->service->getUserCurrentShift($org->id, $user->id, now()->toDateString());

        $this->assertNotNull($result);
        $this->assertEquals($shift->id, $result->id);
        $this->assertEquals('Day Shift', $result->name);
    }

    // ── Roster ──────────────────────────────────────────

    public function test_get_shift_roster_returns_7_day_structure(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');

        $shift = Shift::factory()->create([
            'organization_id' => $org->id,
            'name' => 'Day Shift',
            'start_time' => '09:00:00',
            'end_time' => '17:00:00',
            'days_of_week' => ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        ]);

        $this->assignShiftToUser($org->id, $user->id, $shift->id, '2026-01-01');

        // Use a Monday as week start
        $roster = $this->service->getShiftRoster($org->id, '2026-04-06');

        // Should have exactly 7 keys
        $this->assertCount(7, $roster);

        // Keys should be consecutive dates
        $dates = array_keys($roster);
        $this->assertEquals('2026-04-06', $dates[0]);
        $this->assertEquals('2026-04-12', $dates[6]);

        // Monday (2026-04-06) should have an entry with the user
        $monday = $roster['2026-04-06'];
        $this->assertNotEmpty($monday);
        $this->assertEquals('Day Shift', $monday[0]['shift']['name']);
        $this->assertNotEmpty($monday[0]['users']);
    }

    // ── Swap Requests ───────────────────────────────────

    public function test_create_swap_request_validates_different_users(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');

        $this->expectException(HttpException::class);

        $this->service->createSwapRequest($user, [
            'target_user_id' => $user->id,
            'swap_date' => now()->addDays(5)->toDateString(),
            'reason' => 'Self swap attempt',
        ]);
    }

    public function test_create_swap_request_validates_active_shifts(): void
    {
        $org = $this->createOrganization();
        $requester = $this->createUser($org, 'employee');
        $target = $this->createUser($org, 'employee');

        // Neither user has a shift assigned
        $this->expectException(HttpException::class);

        $this->service->createSwapRequest($requester, [
            'target_user_id' => $target->id,
            'swap_date' => now()->addDays(5)->toDateString(),
            'reason' => 'No shift assigned',
        ]);
    }

    public function test_create_swap_request_prevents_duplicate_pending(): void
    {
        $org = $this->createOrganization();
        $requester = $this->createUser($org, 'employee');
        $target = $this->createUser($org, 'employee');

        $shiftA = Shift::factory()->weekdays()->create(['organization_id' => $org->id]);
        $shiftB = Shift::factory()->weekdays()->create(['organization_id' => $org->id]);

        $swapDate = now()->addDays(5)->toDateString();

        $this->assignShiftToUser($org->id, $requester->id, $shiftA->id, '2026-01-01');
        $this->assignShiftToUser($org->id, $target->id, $shiftB->id, '2026-01-01');

        // First swap should succeed
        $this->service->createSwapRequest($requester, [
            'target_user_id' => $target->id,
            'swap_date' => $swapDate,
            'reason' => 'First request',
        ]);

        // Duplicate pending should fail
        $this->expectException(HttpException::class);

        $this->service->createSwapRequest($requester, [
            'target_user_id' => $target->id,
            'swap_date' => $swapDate,
            'reason' => 'Duplicate request',
        ]);
    }

    public function test_approve_swap_creates_day_overrides(): void
    {
        $org = $this->createOrganization();
        $requester = $this->createUser($org, 'employee');
        $target = $this->createUser($org, 'employee');
        $manager = $this->createUser($org, 'manager');

        $shiftA = Shift::factory()->weekdays()->create(['organization_id' => $org->id]);
        $shiftB = Shift::factory()->weekdays()->create(['organization_id' => $org->id]);

        $swapDate = now()->addDays(5)->toDateString();

        $swap = ShiftSwapRequest::factory()->create([
            'organization_id' => $org->id,
            'requester_id' => $requester->id,
            'target_user_id' => $target->id,
            'requester_shift_id' => $shiftA->id,
            'target_shift_id' => $shiftB->id,
            'swap_date' => $swapDate,
            'status' => 'pending',
        ]);

        $result = $this->service->approveSwap($swap, $manager);

        $this->assertEquals('approved', $result->status);
        $this->assertEquals($manager->id, $result->reviewed_by);

        // Requester should get target's shift for swap date
        $requesterOverride = DB::table('user_shifts')
            ->where('user_id', $requester->id)
            ->where('shift_id', $shiftB->id)
            ->where('effective_from', $swapDate)
            ->where('effective_to', $swapDate)
            ->first();
        $this->assertNotNull($requesterOverride);

        // Target should get requester's shift for swap date
        $targetOverride = DB::table('user_shifts')
            ->where('user_id', $target->id)
            ->where('shift_id', $shiftA->id)
            ->where('effective_from', $swapDate)
            ->where('effective_to', $swapDate)
            ->first();
        $this->assertNotNull($targetOverride);
    }

    public function test_approve_swap_prevents_self_approval(): void
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
            'status' => 'pending',
        ]);

        $this->expectException(HttpException::class);

        $this->service->approveSwap($swap, $requester);
    }

    public function test_reject_swap_sets_status_and_note(): void
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
            'status' => 'pending',
        ]);

        $result = $this->service->rejectSwap($swap, $manager, 'Insufficient staffing.');

        $this->assertEquals('rejected', $result->status);
        $this->assertEquals($manager->id, $result->reviewed_by);
        $this->assertEquals('Insufficient staffing.', $result->reviewer_note);
        $this->assertNotNull($result->reviewed_at);
    }

    public function test_cancel_swap_only_pending(): void
    {
        $org = $this->createOrganization();

        $shiftA = Shift::factory()->create(['organization_id' => $org->id]);
        $shiftB = Shift::factory()->create(['organization_id' => $org->id]);

        $swap = ShiftSwapRequest::factory()->approved()->create([
            'organization_id' => $org->id,
            'requester_shift_id' => $shiftA->id,
            'target_shift_id' => $shiftB->id,
        ]);

        $this->expectException(HttpException::class);

        $this->service->cancelSwap($swap);
    }
}
