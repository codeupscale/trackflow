<?php

namespace Tests\Feature\Hr;

use App\Models\AttendanceRecord;
use App\Models\CheckInSession;
use App\Services\CheckInService;
use Carbon\Carbon;
use Tests\TestCase;

/**
 * Multi-session check-in redesign coverage (HR Module 3.1).
 *
 * A user may check in / out MULTIPLE times per org-local day. Each pair is a
 * CheckInSession row; the attendance_records columns are ROLLUPS derived from the
 * session set:
 *   - check_in_at    = FIRST session start (drives late; owned by first check-in)
 *   - check_out_at   = LAST CLOSED session's checkout (drives early/overtime)
 *   - worked_seconds = SUM of CLOSED session durations (open gaps excluded), null if none closed
 *   - sessions_count = number of sessions
 *   - is_early_checkout / early / overtime minutes = recomputed on EVERY checkout
 *
 * Timezone contract: policy tz Asia/Karachi (UTC+5, no DST). Local wall-clock maps
 * to a fixed UTC instant; the frozen "server now" below is always UTC.
 *
 * Karachi (UTC+5) reference on the working Monday 2026-03-16:
 *   local 11:30 = 06:30 UTC (official start)
 *   local 11:40 = 06:40 UTC (on time)
 *   local 11:45 = 06:45 UTC (late boundary)
 *   local 14:00 = 09:00 UTC
 *   local 14:34 = 09:34 UTC
 *   local 15:00 = 10:00 UTC
 *   local 20:30 = 15:30 UTC (official off boundary)
 *   local 20:45 = 15:45 UTC (15 min overtime)
 */
class CheckInMultiSessionTest extends TestCase
{
    private const MONDAY = '2026-03-16';   // working Monday
    private const TUESDAY = '2026-03-17';  // working Tuesday
    private const TZ = 'Asia/Karachi';

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function freezeUtc(string $utc): void
    {
        Carbon::setTestNow(Carbon::parse($utc, 'UTC'));
    }

    private function checkInService(): CheckInService
    {
        return app(CheckInService::class);
    }

    private function checkIn(): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api/v1/hr/attendance/check-in');
    }

    private function checkOut(): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api/v1/hr/attendance/check-out');
    }

    /** Reload the day's record fresh from the DB. */
    private function record(string $userId, string $date): AttendanceRecord
    {
        return AttendanceRecord::where('user_id', $userId)->where('date', $date)->firstOrFail();
    }

    /** Render a UTC instant as HH:MM in the org timezone. */
    private function localHm(?Carbon $instant): ?string
    {
        return $instant?->copy()->setTimezone(self::TZ)->format('H:i');
    }

    // ── 1: two sessions, early first out then overtime last out ────────────

    public function test_two_sessions_rollup_uses_first_in_last_out_and_summed_worked(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $this->freezeUtc(self::MONDAY . ' 06:40:00'); // in 11:40 local (on time)
        $this->checkIn()->assertStatus(201);

        $this->freezeUtc(self::MONDAY . ' 09:00:00'); // out 14:00 local (early)
        $this->checkOut()->assertOk();

        $this->freezeUtc(self::MONDAY . ' 10:00:00'); // in 15:00 local
        $this->checkIn()->assertStatus(201);

        $this->freezeUtc(self::MONDAY . ' 15:45:00'); // out 20:45 local (15 min OT)
        $this->checkOut()->assertOk();

        $record = $this->record($user->id, self::MONDAY);

        $this->assertSame(2, $record->sessions_count);
        // (14:00-11:40) + (20:45-15:00) = 8400 + 20700 = 29100
        $this->assertSame(29100, $record->worked_seconds);
        $this->assertSame('on_time', $record->check_in_status);
        $this->assertFalse((bool) $record->is_early_checkout);
        $this->assertSame(0, (int) $record->check_out_early_minutes);
        // Extra hours are presence MINUS the requirement: 11:40 -> 20:45 is
        // 9h05m against a 9h day, so 5 minutes. The old rule measured the
        // clock-out against the 20:30 off time and called it 15.
        $this->assertSame(5, (int) $record->check_out_overtime_minutes);
        // Rollup instants: first-in 11:40, last-out 20:45.
        $this->assertSame('11:40', $this->localHm($record->check_in_at));
        $this->assertSame('20:45', $this->localHm($record->check_out_at));
    }

    // ── 2: early-checkout flag recomputes false on a later normal checkout ──

    public function test_early_checkout_flag_is_recomputed_on_each_checkout(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $this->freezeUtc(self::MONDAY . ' 06:40:00'); // in 11:40
        $this->checkIn()->assertStatus(201);

        $this->freezeUtc(self::MONDAY . ' 09:34:00'); // out 14:34 (early)
        $this->checkOut()->assertOk();

        // After the first (early) checkout the record reflects early=true.
        $afterFirst = $this->record($user->id, self::MONDAY);
        $this->assertTrue((bool) $afterFirst->is_early_checkout);

        $this->freezeUtc(self::MONDAY . ' 10:00:00'); // in 15:00
        $this->checkIn()->assertStatus(201);

        $this->freezeUtc(self::MONDAY . ' 15:45:00'); // out 20:45 (15 min OT)
        $this->checkOut()->assertOk();

        // The LAST closed checkout (20:45) now drives early/overtime → not early.
        $record = $this->record($user->id, self::MONDAY);
        $this->assertFalse((bool) $record->is_early_checkout);
        $this->assertSame(0, (int) $record->check_out_early_minutes);
        $this->assertSame(5, (int) $record->check_out_overtime_minutes);
        $this->assertSame(2, $record->sessions_count);
    }

    // ── 3: backstop leaves the trailing open session open, keeps closed sum ─

    public function test_backstop_keeps_closed_worked_and_leaves_open_session(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $this->freezeUtc(self::MONDAY . ' 06:40:00'); // in 11:40
        $this->checkIn()->assertStatus(201);

        $this->freezeUtc(self::MONDAY . ' 09:00:00'); // out 14:00 (closed 8400s)
        $this->checkOut()->assertOk();

        $this->freezeUtc(self::MONDAY . ' 10:00:00'); // in 15:00, never checks out
        $this->checkIn()->assertStatus(201);

        // Two org-local days later, run the backstop directly (scheduler is prod-only).
        $this->freezeUtc('2026-03-18 06:00:00');
        $closed = $this->checkInService()->autoCloseStaleCheckIns($org->id);
        $this->assertSame(1, $closed);

        $record = $this->record($user->id, self::MONDAY);
        $this->assertTrue((bool) $record->missing_checkout);
        $this->assertTrue($record->check_in_flags['auto_closed'] ?? false);
        // Closed-session sum is preserved; the open one is not fabricated.
        $this->assertSame(8400, $record->worked_seconds);
        $this->assertSame('14:00', $this->localHm($record->check_out_at));

        // The trailing session is still open (never given a check_out_at).
        $openSessions = CheckInSession::where('attendance_record_id', $record->id)
            ->whereNull('check_out_at')
            ->get();
        $this->assertCount(1, $openSessions);
    }

    // ── 4: forgotten checkout spans midnight, next day is independent ──────

    public function test_cross_midnight_checkout_and_independent_next_day(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        // Check in Monday 11:40 local (06:40 UTC).
        $this->freezeUtc(self::MONDAY . ' 06:40:00');
        $this->checkIn()->assertStatus(201);

        // Check out Tuesday 00:30 local (Monday 19:30 UTC).
        $this->freezeUtc(self::MONDAY . ' 19:30:00');
        $this->checkOut()->assertOk();

        $monday = $this->record($user->id, self::MONDAY);
        $this->assertSame(1, $monday->sessions_count);
        // 06:40 UTC -> 19:30 UTC = 12h50m = 46200s.
        $this->assertSame(46200, $monday->worked_seconds);

        // Tuesday 11:40 local (06:40 UTC) first check-in opens a fresh Tuesday record.
        $this->freezeUtc(self::TUESDAY . ' 06:40:00');
        $this->checkIn()->assertStatus(201);

        $tuesday = $this->record($user->id, self::TUESDAY);
        $this->assertSame(1, $tuesday->sessions_count);
        $this->assertSame('on_time', $tuesday->check_in_status);
        // Monday is untouched by the Tuesday check-in.
        $this->assertSame(46200, $this->record($user->id, self::MONDAY)->worked_seconds);
    }

    // ── 5: guards — open-session check-in and no-open checkout both 422 ─────

    public function test_guards_reject_double_check_in_and_orphan_check_out(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $this->freezeUtc(self::MONDAY . ' 06:40:00');
        $this->checkIn()->assertStatus(201);

        // With an open session, a second check-in is rejected and creates no session.
        $this->freezeUtc(self::MONDAY . ' 06:50:00');
        $this->checkIn()->assertStatus(422);
        $this->assertSame(
            1,
            CheckInSession::where('user_id', $user->id)->count(),
            'A rejected check-in must not create a second session row.'
        );

        // Close the only session.
        $this->freezeUtc(self::MONDAY . ' 15:30:00');
        $this->checkOut()->assertOk();

        // With no open session, a checkout is rejected.
        $this->freezeUtc(self::MONDAY . ' 15:40:00');
        $this->checkOut()->assertStatus(422);
    }

    // ── 6: double-click re-check-in yields exactly one new open session ────

    public function test_double_click_re_check_in_opens_exactly_one_session(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        // First session opened and closed.
        $this->freezeUtc(self::MONDAY . ' 06:40:00');
        $this->checkIn()->assertStatus(201);
        $this->freezeUtc(self::MONDAY . ' 09:00:00');
        $this->checkOut()->assertOk();

        // Two check-ins fire "at once" (same frozen instant). The open-session guard
        // lets exactly one through; the loser is rejected with 422.
        $this->freezeUtc(self::MONDAY . ' 10:00:00');
        $first = $this->checkIn();
        $second = $this->checkIn();

        $statuses = [$first->getStatusCode(), $second->getStatusCode()];
        sort($statuses);
        $this->assertSame([201, 422], $statuses);

        $record = $this->record($user->id, self::MONDAY);
        // One closed + one new open = 2 sessions total, exactly one open.
        $this->assertSame(2, CheckInSession::where('attendance_record_id', $record->id)->count());
        $this->assertSame(
            1,
            CheckInSession::where('attendance_record_id', $record->id)->whereNull('check_out_at')->count()
        );
    }

    // ── 7: single session, checkout exactly at the off boundary ────────────

    /**
     * Leaving exactly at the off time is NOT automatically a complete day.
     * The employee owes nine hours of PRESENCE, so arriving 10 minutes after the
     * official start means owing 10 minutes at the end. Under the old
     * grace-deducted rule this counted as a clean day.
     */
    public function test_single_session_checkout_at_off_boundary_is_short_when_arrival_was_late(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $this->freezeUtc(self::MONDAY . ' 06:40:00'); // in 11:40
        $this->checkIn()->assertStatus(201);

        $this->freezeUtc(self::MONDAY . ' 15:30:00'); // out exactly 20:30 local
        $this->checkOut()->assertOk();

        $record = $this->record($user->id, self::MONDAY);
        // 11:40 -> 20:30 is 8h50m of a 9h day: 10 minutes short.
        $this->assertTrue((bool) $record->is_early_checkout);
        $this->assertSame(10, (int) $record->check_out_early_minutes);
        $this->assertSame(0, (int) $record->check_out_overtime_minutes);
    }

    /** Arriving on the official start and serving the full nine hours. */
    public function test_a_full_nine_hours_is_neither_short_nor_extra(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $this->freezeUtc(self::MONDAY . ' 06:30:00'); // in 11:30 local
        $this->checkIn()->assertStatus(201);

        $this->freezeUtc(self::MONDAY . ' 15:30:00'); // out 20:30 local
        $this->checkOut()->assertOk();

        $record = $this->record($user->id, self::MONDAY);
        $this->assertTrue((bool) $record->met_required_hours);
        $this->assertFalse((bool) $record->is_early_checkout);
        $this->assertSame(0, (int) $record->check_out_early_minutes);
        $this->assertSame(0, (int) $record->check_out_overtime_minutes);
        $this->assertSame(9 * 3600, (int) $record->required_day_seconds);
    }

    // ── 8: rollup parity with the pre-migration single-pair invariant ──────

    public function test_single_pair_rollup_parity_with_pre_migration_shape(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        // A single in 11:40 → out 20:30 pair, exactly what a pre-migration record held.
        $this->freezeUtc(self::MONDAY . ' 06:40:00');
        $this->checkIn()->assertStatus(201);
        $this->freezeUtc(self::MONDAY . ' 15:30:00');
        $this->checkOut()->assertOk();

        $record = $this->record($user->id, self::MONDAY);

        $this->assertSame(1, $record->sessions_count);
        // 06:40 UTC -> 15:30 UTC = 8h50m = 31800s.
        $this->assertSame(31800, $record->worked_seconds);
        $this->assertSame('on_time', $record->check_in_status);
        $this->assertSame(0, (int) $record->check_in_late_minutes);
        // 8h50m of presence against a 9h day — short by 10 minutes.
        $this->assertTrue((bool) $record->is_early_checkout);
        $this->assertSame(10, (int) $record->check_out_early_minutes);
        $this->assertSame(0, (int) $record->check_out_overtime_minutes);
        $this->assertSame('11:40', $this->localHm($record->check_in_at));
        $this->assertSame('20:30', $this->localHm($record->check_out_at));
    }
}
