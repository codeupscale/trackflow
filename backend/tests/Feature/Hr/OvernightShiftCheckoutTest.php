<?php

namespace Tests\Feature\Hr;

use App\Models\AttendanceRecord;
use App\Models\CheckInSession;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Shift;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\CheckInService;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Checkout arithmetic for an OVERNIGHT shift — one whose end_time is at or before its
 * start_time, e.g. the 16:00 → 01:00 evening shift.
 *
 * The off time of such a shift lands on the day AFTER the record's own date. Anchoring
 * it to the record's date put it ~15 hours BEFORE the shift began, so every checkout
 * compared "at or after the off time" and a 23:59 finish was booked as ~23 hours of
 * overtime instead of an hour short of the end. The same mis-anchoring made the
 * forced-checkout fallback unreachable (the off time was before check-in), collapsing a
 * forgotten checkout to the check_in + 1s guard, and made the org-local-midnight
 * force-checkout truncate a shift that was still running.
 *
 * Karachi reference (UTC+5, no DST), evening shift 16:00 / +15 grace = 16:15 late / 01:00 off:
 *   Mon local 16:10 = Mon 11:10 UTC  (on-time check-in)
 *   Mon local 23:59 = Mon 18:59 UTC  (finish before the off time — EARLY by 61m)
 *   Tue local 00:00 = Mon 19:00 UTC  (the org-local midnight the force-checkout fires)
 *   Tue local 01:00 = Mon 20:00 UTC  (the off time — boundary, 0 overtime)
 *   Tue local 02:00 = Mon 21:00 UTC  (60m overtime)
 */
class OvernightShiftCheckoutTest extends TestCase
{
    private const MONDAY = '2026-03-16';

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function freezeUtc(string $utc): void
    {
        Carbon::setTestNow(Carbon::parse($utc, 'UTC'));
    }

    private function service(): CheckInService
    {
        return app(CheckInService::class);
    }

    /** Assign an overnight evening shift (16:00 → 01:00 Karachi) unless overridden. */
    private function assignShift(Organization $org, User $user, array $overrides = []): Shift
    {
        $shift = Shift::create(array_merge([
            'organization_id' => $org->id,
            'name' => 'Evening Shift',
            'start_time' => '16:00:00',
            'end_time' => '01:00:00',
            'grace_period_minutes' => 15,
            'timezone' => 'Asia/Karachi',
            'allow_early_check_in' => true,
            'is_active' => true,
            'days_of_week' => ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
        ], $overrides));

        DB::table('user_shifts')->insert([
            'id' => (string) Str::uuid(),
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'shift_id' => $shift->id,
            'effective_from' => '2000-01-01',
            'effective_to' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $shift;
    }

    /** A tracked time entry for the user; $endedUtc null leaves it running. */
    private function trackedEntry(Organization $org, User $user, string $startedUtc, ?string $endedUtc): TimeEntry
    {
        $project = Project::factory()->create([
            'organization_id' => $org->id,
            'created_by' => $user->id,
        ]);

        return TimeEntry::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'project_id' => $project->id,
            'type' => 'tracked',
            'started_at' => Carbon::parse($startedUtc, 'UTC'),
            'ended_at' => $endedUtc ? Carbon::parse($endedUtc, 'UTC') : null,
        ]);
    }

    /** Check in on the Monday evening, leaving the session open. */
    private function checkInMondayEvening(User $user): void
    {
        $this->freezeUtc(self::MONDAY . ' 11:10:00'); // 16:10 local — on time
        $this->postJson('/api/v1/hr/attendance/check-in')->assertStatus(201);
    }

    /** Monday's attendance record — the one an overnight shift owns past midnight. */
    private function mondayRecord(User $user): AttendanceRecord
    {
        return AttendanceRecord::withoutGlobalScopes()
            ->where('user_id', $user->id)
            ->where('date', self::MONDAY)
            ->firstOrFail();
    }

    // ── the reported defect ───────────────────────────────────────────────

    public function test_finishing_before_the_overnight_off_time_is_early_not_a_full_day_of_overtime(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->assignShift($org, $user);
        $this->actingAs($user, 'sanctum');

        $this->checkInMondayEvening($user);

        $this->freezeUtc(self::MONDAY . ' 18:59:00'); // 23:59 local — 61m short of 01:00
        $response = $this->postJson('/api/v1/hr/attendance/check-out');

        $response->assertStatus(200)
            ->assertJsonPath('data.is_early_checkout', true)
            ->assertJsonPath('data.check_out_early_minutes', 61)
            ->assertJsonPath('data.check_out_overtime_minutes', 0);

        // The defect booked this as ~23h of overtime.
        $this->assertDatabaseHas('attendance_records', [
            'user_id' => $user->id,
            'date' => self::MONDAY,
            'is_early_checkout' => true,
            'check_out_overtime_minutes' => 0,
        ]);
    }

    public function test_working_past_the_overnight_off_time_earns_overtime(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->assignShift($org, $user);
        $this->actingAs($user, 'sanctum');

        $this->checkInMondayEvening($user);

        $this->freezeUtc(self::MONDAY . ' 21:00:00'); // Tue 02:00 local — 60m past 01:00
        $this->postJson('/api/v1/hr/attendance/check-out')->assertStatus(200);

        // Assert on MONDAY's record, not the response: the checkout body reports
        // getTodayStatus(), and by 02:00 local "today" is already Tuesday.
        $record = $this->mondayRecord($user);

        $this->assertFalse((bool) $record->is_early_checkout);
        $this->assertSame(0, $record->check_out_early_minutes);
        $this->assertSame(60, $record->check_out_overtime_minutes);
    }

    public function test_checkout_exactly_at_the_overnight_off_time_is_neither_early_nor_overtime(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->assignShift($org, $user);
        $this->actingAs($user, 'sanctum');

        $this->checkInMondayEvening($user);

        $this->freezeUtc(self::MONDAY . ' 20:00:00'); // Tue 01:00 local — exactly the off time
        $this->postJson('/api/v1/hr/attendance/check-out')->assertStatus(200);

        // Monday's record — "today" has already rolled to Tuesday at 01:00 local.
        $record = $this->mondayRecord($user);

        $this->assertFalse((bool) $record->is_early_checkout);
        $this->assertSame(0, $record->check_out_early_minutes);
        $this->assertSame(0, $record->check_out_overtime_minutes);
        // Genuinely closed at the boundary, not merely an absent Tuesday row.
        $this->assertSame(
            self::MONDAY . ' 20:00:00',
            $record->check_out_at->utc()->format('Y-m-d H:i:s')
        );
    }

    // ── the midnight force-checkout must not cut a running shift short ────

    public function test_midnight_force_checkout_leaves_a_still_running_overnight_shift_open(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->assignShift($org, $user);
        $this->actingAs($user, 'sanctum');

        $this->checkInMondayEvening($user);

        // 00:00 Tuesday Karachi — the job's scheduled instant. The shift runs to 01:00,
        // so the worker is still on shift and must not be checked out.
        $this->freezeUtc(self::MONDAY . ' 19:00:00');
        $closed = $this->service()->autoCheckOutOpenSessions($org->id);

        $this->assertSame(0, $closed);
        $this->assertDatabaseHas('check_in_sessions', [
            'user_id' => $user->id,
            'check_out_at' => null,
        ]);
    }

    public function test_midnight_force_checkout_still_closes_an_overnight_shift_that_has_ended(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->assignShift($org, $user);
        $this->actingAs($user, 'sanctum');

        $this->checkInMondayEvening($user);

        // 02:00 Tuesday Karachi — an hour past the 01:00 off time, session still open.
        $this->freezeUtc(self::MONDAY . ' 21:00:00');
        $closed = $this->service()->autoCheckOutOpenSessions($org->id);

        $this->assertSame(1, $closed);

        // With no tracked activity the fallback is the shift's off time — Tue 01:00
        // local = Mon 20:00 UTC. The defect made that unreachable (it resolved to Mon
        // 01:00, before the check-in) and collapsed the session to check_in + 1s.
        $session = CheckInSession::withoutGlobalScopes()->where('user_id', $user->id)->firstOrFail();
        $this->assertSame(
            self::MONDAY . ' 20:00:00',
            $session->check_out_at->utc()->format('Y-m-d H:i:s')
        );

        $record = AttendanceRecord::withoutGlobalScopes()
            ->where('user_id', $user->id)->where('date', self::MONDAY)->firstOrFail();

        // 16:10 → 01:00 = 8h50m of work, not one second.
        $this->assertSame(8 * 3600 + 50 * 60, $record->worked_seconds);
    }

    // ── work done past midnight belongs to the shift that was running ─────

    public function test_forced_checkout_keeps_overnight_work_done_after_midnight(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->assignShift($org, $user);
        $this->actingAs($user, 'sanctum');

        $this->checkInMondayEvening($user);

        // Tracked work running from check-in until Tue 00:45 local (Mon 19:45 UTC) —
        // 45 minutes PAST the org-local midnight, still inside the 01:00 shift.
        $this->trackedEntry($org, $user, self::MONDAY . ' 11:10:00', self::MONDAY . ' 19:45:00');

        // The 06:00 PKT sweep (01:00 UTC Tue), after the shift has ended.
        $this->freezeUtc('2026-03-17 01:00:00');
        $this->assertSame(1, $this->service()->autoCheckOutOpenSessions($org->id));

        $record = AttendanceRecord::withoutGlobalScopes()
            ->where('user_id', $user->id)->where('date', self::MONDAY)->firstOrFail();

        // Bounded to the calendar day the search stopped at 23:59:59 and threw away the
        // last 45 minutes; the window now runs to the 01:00 off time.
        $this->assertSame(
            self::MONDAY . ' 19:45:00',
            $record->check_out_at->utc()->format('Y-m-d H:i:s')
        );
        $this->assertSame(8 * 3600 + 35 * 60, $record->worked_seconds); // 16:10 → 00:45
        $this->assertTrue((bool) $record->is_early_checkout);
        $this->assertSame(15, $record->check_out_early_minutes); // 00:45 → 01:00
        $this->assertSame(0, $record->check_out_overtime_minutes);
    }

    public function test_forced_checkout_never_stamps_past_the_overnight_off_time(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->assignShift($org, $user);
        $this->actingAs($user, 'sanctum');

        $this->checkInMondayEvening($user);

        // Activity running well past the 01:00 off time — a fabricated checkout must be
        // capped at the shift end rather than following it indefinitely.
        $this->trackedEntry($org, $user, self::MONDAY . ' 11:10:00', self::MONDAY . ' 22:30:00');

        $this->freezeUtc('2026-03-17 01:00:00');
        $this->assertSame(1, $this->service()->autoCheckOutOpenSessions($org->id));

        $record = AttendanceRecord::withoutGlobalScopes()
            ->where('user_id', $user->id)->where('date', self::MONDAY)->firstOrFail();

        $this->assertSame(
            self::MONDAY . ' 20:00:00', // Tue 01:00 local — the off time, not 03:30
            $record->check_out_at->utc()->format('Y-m-d H:i:s')
        );
    }

    // ── a same-day shift must be completely unaffected ────────────────────

    public function test_same_day_shift_checkout_arithmetic_is_unchanged(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->assignShift($org, $user, [
            'name' => 'Morning Shift',
            'start_time' => '11:30:00',
            'end_time' => '20:30:00',
        ]);
        $this->actingAs($user, 'sanctum');

        $this->freezeUtc(self::MONDAY . ' 06:40:00'); // 11:40 local
        $this->postJson('/api/v1/hr/attendance/check-in')->assertStatus(201);

        $this->freezeUtc(self::MONDAY . ' 16:00:00'); // 21:00 local — 30m past 20:30
        $this->postJson('/api/v1/hr/attendance/check-out')
            ->assertStatus(200)
            ->assertJsonPath('data.is_early_checkout', false)
            ->assertJsonPath('data.check_out_overtime_minutes', 30);
    }

    public function test_midnight_force_checkout_still_closes_a_finished_same_day_shift(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->assignShift($org, $user, [
            'name' => 'Morning Shift',
            'start_time' => '11:30:00',
            'end_time' => '20:30:00',
        ]);
        $this->actingAs($user, 'sanctum');

        $this->freezeUtc(self::MONDAY . ' 06:40:00');
        $this->postJson('/api/v1/hr/attendance/check-in')->assertStatus(201);

        $this->freezeUtc(self::MONDAY . ' 19:00:00'); // 00:00 Tue local
        $this->assertSame(1, $this->service()->autoCheckOutOpenSessions($org->id));
    }
}
