<?php

namespace Tests\Feature\Hr;

use App\Models\AttendanceRecord;
use App\Models\Shift;
use App\Models\User;
use App\Services\CheckInService;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The day row must say which shift it was worked against from the FIRST
 * check-in — not from the nightly job the following night.
 *
 * Reported from production: the attendance screens showed an empty Shift
 * column all day for someone who had just checked in, and it filled itself in
 * overnight. generateDailyAttendance was the only writer of shift_id.
 */
class CheckInStampsShiftTest extends TestCase
{
    private const MONDAY = '2026-03-16';

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function assignShift(User $user, array $overrides = []): Shift
    {
        $shift = Shift::create(array_merge([
            'organization_id' => $user->organization_id,
            'name' => 'Morning Shift',
            'start_time' => '11:30:00',
            'end_time' => '20:30:00',
            'grace_period_minutes' => 15,
            'timezone' => 'Asia/Karachi',
            'is_active' => true,
            'days_of_week' => [1, 2, 3, 4, 5],
        ], $overrides));

        DB::table('user_shifts')->insert([
            'id' => (string) Str::uuid(),
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'shift_id' => $shift->id,
            'effective_from' => Carbon::parse(self::MONDAY)->subWeek()->toDateString(),
            'effective_to' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $shift;
    }

    public function test_checking_in_records_the_shift_on_the_day_row(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $shift = $this->assignShift($user);

        Carbon::setTestNow(Carbon::parse(self::MONDAY . ' 06:40:00', 'UTC')); // 11:40 Karachi
        $record = app(CheckInService::class)->checkIn($user);

        $this->assertSame($shift->id, $record->shift_id, 'the shift is stamped at check-in, not overnight');
        $this->assertDatabaseHas('attendance_records', [
            'id' => $record->id,
            'shift_id' => $shift->id,
            'expected_start' => '11:30:00',
            'expected_end' => '20:30:00',
        ]);
    }

    public function test_every_role_gets_the_shift_stamped(): void
    {
        // The fix is in the service, so it cannot differ by role — asserted
        // because the report said "for all roles".
        $org = $this->createOrganization();

        foreach (['owner', 'hr_manager', 'org_manager', 'finance_manager', 'employee'] as $role) {
            $user = $this->createUser($org, $role);
            $shift = $this->assignShift($user, ['name' => "Shift for {$role}"]);

            Carbon::setTestNow(Carbon::parse(self::MONDAY . ' 06:40:00', 'UTC'));
            $record = app(CheckInService::class)->checkIn($user);

            $this->assertSame($shift->id, $record->shift_id, "{$role} should have the shift stamped");
        }
    }

    public function test_the_api_returns_the_shift_for_the_day_just_checked_in(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $shift = $this->assignShift($user);

        Carbon::setTestNow(Carbon::parse(self::MONDAY . ' 06:40:00', 'UTC'));

        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/hr/attendance/check-in')
            ->assertStatus(201);

        $row = $this->getJson('/api/v1/hr/attendance?start_date=' . self::MONDAY . '&end_date=' . self::MONDAY)
            ->assertOk()
            ->json('data.0');

        $this->assertNotNull($row['shift'] ?? null, 'the row carries the shift the same day');
        $this->assertSame($shift->name, $row['shift']['name']);
    }

    public function test_an_existing_shift_on_the_row_is_never_overwritten(): void
    {
        // The nightly job is authoritative for a day it has already judged, and
        // a shift reassigned mid-day must not rewrite the morning's schedule.
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $judged = $this->assignShift($user, ['name' => 'Already judged']);

        AttendanceRecord::withoutGlobalScopes()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'date' => self::MONDAY,
            'status' => 'absent',
            'shift_id' => $judged->id,
            'expected_start' => '09:00:00',
            'expected_end' => '18:00:00',
        ]);

        Carbon::setTestNow(Carbon::parse(self::MONDAY . ' 06:40:00', 'UTC'));
        $record = app(CheckInService::class)->checkIn($user);

        $this->assertSame($judged->id, $record->shift_id);
        $this->assertDatabaseHas('attendance_records', [
            'id' => $record->id,
            'expected_start' => '09:00:00',
        ]);
    }

    public function test_a_user_with_no_shift_still_checks_in(): void
    {
        // The org fallback has no shift row to point at; the day must still work.
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');

        Carbon::setTestNow(Carbon::parse(self::MONDAY . ' 06:40:00', 'UTC'));
        $record = app(CheckInService::class)->checkIn($user);

        $this->assertNull($record->shift_id);
        $this->assertNotNull($record->check_in_at);
    }
}
