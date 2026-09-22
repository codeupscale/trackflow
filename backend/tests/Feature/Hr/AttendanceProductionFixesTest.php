<?php

namespace Tests\Feature\Hr;

use App\Models\AttendanceRecord;
use App\Models\Organization;
use App\Models\Shift;
use App\Models\User;
use App\Notifications\OrgActivity;
use App\Services\AttendanceService;
use App\Services\CheckInService;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Bugs reported from production on 2026-09-22.
 *
 *  - "Checked in late, 0 minutes" for someone who arrived on the dot
 *  - Check-ins by the desktop tracker never reaching the notification panel
 *  - Today shown as Absent before anyone had checked in
 *  - No status filter on the Team tab
 */
class AttendanceProductionFixesTest extends TestCase
{
    /** A Monday. Shift 16:30–01:30 Karachi = 11:30–20:30 UTC. */
    private const MONDAY = '2026-03-16';

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    /**
     * The shift from the report: starts at 16:30 with NO grace, so the late
     * threshold is exactly the start time — the case that exposed the bug.
     */
    private function assignShift(User $user): Shift
    {
        $shift = Shift::create([
            'organization_id' => $user->organization_id,
            'name' => 'Evening Shift',
            'start_time' => '16:30:00',
            'end_time' => '23:30:00',
            'grace_period_minutes' => 0,
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

    /** 16:30 Karachi is 11:30 UTC. */
    private function karachi(string $time): Carbon
    {
        return Carbon::parse(self::MONDAY . ' ' . $time, 'Asia/Karachi')->utc();
    }

    // ── "Checked in late, 0 minutes" ─────────────────────────────────────

    public function test_checking_in_on_the_dot_is_on_time(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->assignShift($user);

        Carbon::setTestNow($this->karachi('16:30:00'));
        $record = app(CheckInService::class)->checkIn($user);

        $this->assertSame('on_time', $record->check_in_status);
        $this->assertSame(0, (int) $record->check_in_late_minutes);
    }

    public function test_seconds_past_the_start_are_still_on_time(): void
    {
        // The exact production report: the button pressed at 16:30 on the
        // clock, 40 seconds past the threshold. It used to read "late", then
        // "0 minutes late", because lateness was judged to the second.
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->assignShift($user);

        Carbon::setTestNow($this->karachi('16:30:40'));
        $record = app(CheckInService::class)->checkIn($user);

        $this->assertSame('on_time', $record->check_in_status);
        $this->assertSame(0, (int) $record->check_in_late_minutes);
    }

    public function test_a_full_minute_past_the_start_is_late(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->assignShift($user);

        Carbon::setTestNow($this->karachi('16:31:00'));
        $record = app(CheckInService::class)->checkIn($user);

        $this->assertSame('late', $record->check_in_status);
        $this->assertSame(1, (int) $record->check_in_late_minutes);
    }

    public function test_late_is_never_reported_with_zero_minutes(): void
    {
        // The invariant the bug broke, stated directly: across the whole first
        // minute, "late" and "0 minutes" never appear together.
        $org = $this->createOrganization();

        foreach (['16:30:00', '16:30:01', '16:30:30', '16:30:59', '16:31:00', '16:31:59', '16:35:10'] as $time) {
            $user = $this->createUser($org, 'employee');
            $this->assignShift($user);

            Carbon::setTestNow($this->karachi($time));
            $record = app(CheckInService::class)->checkIn($user);

            if ($record->check_in_status === 'late') {
                $this->assertGreaterThanOrEqual(1, (int) $record->check_in_late_minutes, "late at {$time} must carry minutes");
            } else {
                $this->assertSame(0, (int) $record->check_in_late_minutes, "on time at {$time} carries no minutes");
            }
        }
    }

    public function test_the_notification_does_not_call_an_on_time_check_in_late(): void
    {
        Notification::fake();

        $org = $this->createOrganization();
        $owner = $this->createUser($org, 'owner');
        $user = $this->createUser($org, 'employee');
        $this->assignShift($user);

        Carbon::setTestNow($this->karachi('16:30:40'));
        app(CheckInService::class)->checkIn($user);

        Notification::assertSentTo($owner, OrgActivity::class, function (OrgActivity $n) use ($owner) {
            $title = $n->title($owner);

            return str_contains($title, 'checked in') && ! str_contains($title, 'late');
        });
    }

    public function test_late_minutes_read_as_a_duration(): void
    {
        $n = OrgActivity::checkedIn(employeeName: 'Alice', at: '05:35 PM', late: true, lateMinutes: 65);
        $owner = new User;

        $this->assertStringContainsString('1h 5m late', $n->body($owner));
        $this->assertStringNotContainsString('65 minutes', $n->body($owner));
    }

    // ── Tracker check-ins missing from the panel ─────────────────────────

    private function orgWithAutoCheckIn(): Organization
    {
        $org = $this->createOrganization();
        $org->update(['settings' => array_merge($org->settings ?? [], [
            'auto_check_in_on_track' => true,
            // The org default blocks auto check-in before 11:00 local; the
            // shift here starts in the evening.
            'auto_check_in_min_time' => '00:00:00',
        ])]);

        return $org->refresh();
    }

    public function test_a_tracker_check_in_is_announced(): void
    {
        // Reported from production: people checked in by starting the desktop
        // tracker appeared on the attendance screens and never in the panel.
        // This path created the session and said nothing.
        Notification::fake();

        $org = $this->orgWithAutoCheckIn();
        $owner = $this->createUser($org, 'owner');
        $hr = $this->createUser($org, 'hr_manager');
        $user = $this->createUser($org, 'employee');
        $this->assignShift($user);

        $record = app(CheckInService::class)->autoCheckInFromTracking($user, $this->karachi('16:40:00'));

        $this->assertNotNull($record, 'the tracker check-in was created');
        Notification::assertSentTo($owner, OrgActivity::class);
        Notification::assertSentTo($hr, OrgActivity::class);
        Notification::assertNotSentTo($user, OrgActivity::class);
    }

    public function test_a_skipped_tracker_check_in_announces_nothing(): void
    {
        // The listener is queued and retried, and the tracker fires on every
        // timer start. A day already checked in must not notify again.
        $org = $this->orgWithAutoCheckIn();
        $this->createUser($org, 'owner');
        $user = $this->createUser($org, 'employee');
        $this->assignShift($user);

        app(CheckInService::class)->autoCheckInFromTracking($user, $this->karachi('16:40:00'));

        Notification::fake();
        $again = app(CheckInService::class)->autoCheckInFromTracking($user, $this->karachi('17:10:00'));

        $this->assertNull($again, 'already checked in, so skipped');
        Notification::assertNothingSent();
    }

    public function test_the_tracker_path_judges_lateness_the_same_way(): void
    {
        $org = $this->orgWithAutoCheckIn();
        $user = $this->createUser($org, 'employee');
        $this->assignShift($user);

        $record = app(CheckInService::class)->autoCheckInFromTracking($user, $this->karachi('16:30:40'));

        $this->assertSame('on_time', $record->check_in_status);
        $this->assertSame(0, (int) $record->check_in_late_minutes);
    }

    // ── Today shown as Absent before check-in ────────────────────────────

    public function test_today_without_a_check_in_is_not_an_absence(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->assignShift($user);

        // Monday morning, nobody in yet.
        Carbon::setTestNow($this->karachi('09:00:00'));

        $row = collect(app(AttendanceService::class)->getAttendance($user->id, $org->id, [
            'start_date' => self::MONDAY,
            'end_date' => self::MONDAY,
        ])->items())->first();

        $this->assertSame('not_checked_in', $row['status']);
    }

    public function test_a_past_day_without_a_check_in_is_still_an_absence(): void
    {
        // The change is about TODAY only. A working day that has ended with
        // no attendance is an absence, exactly as before.
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->assignShift($user);

        Carbon::setTestNow(Carbon::parse('2026-03-17 04:00:00', 'UTC')); // Tuesday

        $rows = collect(app(AttendanceService::class)->getAttendance($user->id, $org->id, [
            'start_date' => self::MONDAY,
            'end_date' => '2026-03-17',
        ])->items())->keyBy('date');

        $this->assertSame('absent', $rows[self::MONDAY]['status']);
        $this->assertSame('not_checked_in', $rows['2026-03-17']['status']);
    }

    public function test_the_absent_count_does_not_include_today(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->assignShift($user);

        Carbon::setTestNow(Carbon::parse('2026-03-17 04:00:00', 'UTC')); // Tuesday morning

        $summary = app(AttendanceService::class)->getAttendanceSummary(
            $user->id, $org->id, 3, 2026, self::MONDAY, '2026-03-17',
        );

        $this->assertSame(1, $summary['absent_days'], 'Monday is absent; Tuesday has not happened yet');
    }

    public function test_the_team_view_does_not_mark_today_absent(): void
    {
        $org = $this->createOrganization();
        $hr = $this->createUser($org, 'hr_manager');
        $employee = $this->createUser($org, 'employee');
        $this->assignShift($employee);

        Carbon::setTestNow($this->karachi('09:00:00'));

        $response = $this->actingAs($hr, 'sanctum')
            ->getJson('/api/v1/hr/attendance/team?start_date=' . self::MONDAY . '&end_date=' . self::MONDAY)
            ->assertOk();

        $row = collect($response->json('data'))->firstWhere('user_id', $employee->id);
        $this->assertSame('not_checked_in', $row['status']);
        $this->assertSame(0, $response->json('stats.absent'), 'nobody is absent from a day still in progress');
    }

    public function test_the_team_view_never_lists_days_that_have_not_happened(): void
    {
        // Found while verifying the fix above: a "this month" filter on the
        // 22nd listed the 23rd onwards as Absent — the Team view had no ceiling
        // at today, so every future day was synthesised as an absence and
        // counted in the Absent card.
        $org = $this->createOrganization();
        $hr = $this->createUser($org, 'hr_manager');
        $employee = $this->createUser($org, 'employee');
        $this->assignShift($employee);

        Carbon::setTestNow($this->karachi('09:00:00')); // Monday the 16th

        $response = $this->actingAs($hr, 'sanctum')
            ->getJson('/api/v1/hr/attendance/team?user_id=' . $employee->id . '&start_date=2026-03-01&end_date=2026-03-31&per_page=100')
            ->assertOk();

        $dates = collect($response->json('data'))->pluck('date');

        $this->assertSame('2026-03-16', $dates->max(), 'the list stops at today');
        $this->assertFalse($dates->contains('2026-03-17'), 'tomorrow is not listed');
        $this->assertFalse(
            collect($response->json('data'))->contains(fn ($r) => $r['date'] > '2026-03-16' && $r['status'] === 'absent'),
            'no future day is ever called an absence',
        );
    }

    // ── Team tab status filter ───────────────────────────────────────────

    public function test_the_team_list_filters_by_status(): void
    {
        $org = $this->createOrganization();
        $hr = $this->createUser($org, 'hr_manager');
        $present = $this->createUser($org, 'employee');
        $notYet = $this->createUser($org, 'employee');
        $this->assignShift($present);
        $this->assignShift($notYet);

        Carbon::setTestNow($this->karachi('16:30:00'));
        app(CheckInService::class)->checkIn($present);

        $url = '/api/v1/hr/attendance/team?start_date=' . self::MONDAY . '&end_date=' . self::MONDAY;

        $presentIds = collect($this->actingAs($hr, 'sanctum')->getJson($url . '&status=present')->assertOk()->json('data'))->pluck('user_id');
        $this->assertTrue($presentIds->contains($present->id));
        $this->assertFalse($presentIds->contains($notYet->id));

        $waitingIds = collect($this->actingAs($hr, 'sanctum')->getJson($url . '&status=not_checked_in')->assertOk()->json('data'))->pluck('user_id');
        $this->assertTrue($waitingIds->contains($notYet->id), 'HR can list who has not arrived yet');
        $this->assertFalse($waitingIds->contains($present->id));
    }

    // ── Repairing the rows the bug already wrote ─────────────────────────

    public function test_the_data_fix_clears_only_zero_minute_lates(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');

        $make = fn (string $date, string $status, int $minutes) => AttendanceRecord::withoutGlobalScopes()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'date' => $date,
            'status' => 'present',
            'check_in_at' => Carbon::parse($date . ' 11:30:00', 'UTC'),
            'check_in_status' => $status,
            'check_in_late_minutes' => $minutes,
        ]);

        $wronglyLate = $make('2026-03-02', 'late', 0);
        $reallyLate = $make('2026-03-03', 'late', 12);
        $onTime = $make('2026-03-04', 'on_time', 0);

        (require database_path('migrations/2026_09_22_000001_correct_zero_minute_late_check_ins.php'))->up();

        $this->assertSame('on_time', $wronglyLate->fresh()->check_in_status, 'late by seconds was on time');
        $this->assertSame('late', $reallyLate->fresh()->check_in_status, 'a real twelve minutes is untouched');
        $this->assertSame(12, (int) $reallyLate->fresh()->check_in_late_minutes);
        $this->assertSame('on_time', $onTime->fresh()->check_in_status);
    }
}
