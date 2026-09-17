<?php

namespace Tests\Feature\Hr;

use App\Models\Shift;
use App\Models\User;
use App\Services\CheckInService;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * WHO may read why someone left early, and WHEN a day may be judged at all.
 *
 * The reason is a personal circumstance attached to an attendance row. Being
 * able to see the row is not the same as being entitled to the circumstance —
 * finance reads everyone's hours for payroll and must not read this.
 */
class EarlyCheckoutVisibilityTest extends TestCase
{
    private const MONDAY = '2026-03-16';

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function assignShift(User $user): Shift
    {
        $shift = Shift::create([
            'organization_id' => $user->organization_id,
            'name' => 'Morning Shift',
            'start_time' => '11:30:00',
            'end_time' => '20:30:00',
            'grace_period_minutes' => 15,
            'timezone' => 'Asia/Karachi',
            'is_active' => true,
            'days_of_week' => [1, 2, 3, 4, 5],
        ]);

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

    /** A short day, explained. */
    private function shortDayWithReason(User $user): void
    {
        Carbon::setTestNow(Carbon::parse(self::MONDAY . ' 06:30:00', 'UTC'));
        app(CheckInService::class)->checkIn($user);

        Carbon::setTestNow(Carbon::parse(self::MONDAY . ' 12:30:00', 'UTC'));
        app(CheckInService::class)->checkOut($user, [
            'category' => 'medical',
            'reason' => 'Dentist appointment at 5 PM',
        ]);
    }

    private function teamRowFor(User $viewer, User $subject): ?array
    {
        $rows = $this->actingAs($viewer, 'sanctum')
            ->getJson('/api/v1/hr/attendance/team?start_date=' . self::MONDAY . '&end_date=' . self::MONDAY)
            ->assertOk()
            ->json('data');

        foreach ($rows as $row) {
            if (($row['user_id'] ?? null) === $subject->id) {
                return $row;
            }
        }

        return null;
    }

    public function test_hr_and_the_owner_may_read_the_reason(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $this->assignShift($employee);
        $this->shortDayWithReason($employee);

        foreach (['owner', 'hr_manager', 'org_manager'] as $role) {
            $viewer = $this->createUser($org, $role);
            $row = $this->teamRowFor($viewer, $employee);

            $this->assertNotNull($row, "{$role} should see the row");
            $this->assertNotNull($row['early_checkout_reason'], "{$role} should read the reason");
            $this->assertSame('medical', $row['early_checkout_reason']['category']);
        }
    }

    public function test_finance_sees_the_row_but_not_the_reason(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $this->assignShift($employee);
        $this->shortDayWithReason($employee);

        $finance = $this->createUser($org, 'finance_manager');
        $row = $this->teamRowFor($finance, $employee);

        $this->assertNotNull($row, 'finance still reads attendance for payroll');
        $this->assertFalse($row['met_required_hours'], 'and still sees that the day was short');
        $this->assertNull($row['early_checkout_reason'], 'but not the personal circumstance behind it');
    }

    public function test_the_reason_never_leaks_through_a_raw_record(): void
    {
        // The check-in list returns AttendanceRecord models directly, with no
        // chance to apply the visibility rule — so the columns must be hidden.
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $this->assignShift($employee);
        $this->shortDayWithReason($employee);

        $finance = $this->createUser($org, 'finance_manager');

        $body = $this->actingAs($finance, 'sanctum')
            ->getJson('/api/v1/hr/attendance/check-ins?start_date=' . self::MONDAY . '&end_date=' . self::MONDAY)
            ->assertOk()
            ->content();

        $this->assertStringNotContainsString('Dentist appointment', $body);
        $this->assertStringNotContainsString('early_checkout_category', $body);
    }

    public function test_the_csv_export_withholds_it_from_finance_too(): void
    {
        // An export must never be the back door to something the screen hides.
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $this->assignShift($employee);
        $this->shortDayWithReason($employee);

        $finance = $this->createUser($org, 'finance_manager');
        $hr = $this->createUser($org, 'hr_manager');
        $url = '/api/v1/hr/attendance/check-ins/export?period=day&date=' . self::MONDAY . '&view=detail';

        $financeCsv = $this->actingAs($finance, 'sanctum')->get($url)->assertOk()->content();
        $this->assertStringNotContainsString('Dentist appointment', $financeCsv);

        $hrCsv = $this->actingAs($hr, 'sanctum')->get($url)->assertOk()->content();
        $this->assertStringContainsString('Dentist appointment', $hrCsv);
    }

    public function test_an_employee_always_reads_their_own_reason(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $this->assignShift($employee);
        $this->shortDayWithReason($employee);

        $row = $this->actingAs($employee, 'sanctum')
            ->getJson('/api/v1/hr/attendance?start_date=' . self::MONDAY . '&end_date=' . self::MONDAY)
            ->assertOk()
            ->json('data.0');

        $this->assertNotNull($row['early_checkout_reason']);
        $this->assertSame('Dentist appointment at 5 PM', $row['early_checkout_reason']['note']);
    }

    public function test_a_day_with_an_open_session_is_not_judged_short(): void
    {
        // In at 11:30, out at 12:30 for lunch, back at 13:00 and still working.
        // The old rule measured to the 12:30 checkout and called the day short
        // while the person was sitting at their desk.
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $this->assignShift($employee);

        Carbon::setTestNow(Carbon::parse(self::MONDAY . ' 06:30:00', 'UTC'));
        app(CheckInService::class)->checkIn($employee);

        Carbon::setTestNow(Carbon::parse(self::MONDAY . ' 07:30:00', 'UTC'));
        app(CheckInService::class)->checkOut($employee);

        Carbon::setTestNow(Carbon::parse(self::MONDAY . ' 08:00:00', 'UTC'));
        $record = app(CheckInService::class)->checkIn($employee);

        $this->assertNull($record->met_required_hours, 'an unfinished day has no verdict');
        $this->assertFalse((bool) $record->is_early_checkout);
        $this->assertSame(0, (int) $record->check_out_early_minutes);
    }

    public function test_the_verdict_arrives_once_the_last_session_closes(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $this->assignShift($employee);

        Carbon::setTestNow(Carbon::parse(self::MONDAY . ' 06:30:00', 'UTC'));
        app(CheckInService::class)->checkIn($employee);
        Carbon::setTestNow(Carbon::parse(self::MONDAY . ' 07:30:00', 'UTC'));
        app(CheckInService::class)->checkOut($employee);
        Carbon::setTestNow(Carbon::parse(self::MONDAY . ' 08:00:00', 'UTC'));
        app(CheckInService::class)->checkIn($employee);
        Carbon::setTestNow(Carbon::parse(self::MONDAY . ' 09:00:00', 'UTC'));
        $record = app(CheckInService::class)->checkOut($employee);

        $this->assertFalse($record->met_required_hours, 'now the day is over, and it was short');
        $this->assertTrue((bool) $record->is_early_checkout);
    }

    public function test_the_row_tells_the_client_the_day_is_still_open(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $this->assignShift($employee);

        Carbon::setTestNow(Carbon::parse(self::MONDAY . ' 06:30:00', 'UTC'));
        app(CheckInService::class)->checkIn($employee);

        $row = $this->actingAs($employee, 'sanctum')
            ->getJson('/api/v1/hr/attendance?start_date=' . self::MONDAY . '&end_date=' . self::MONDAY)
            ->assertOk()
            ->json('data.0');

        $this->assertTrue($row['has_open_session']);
    }
}
