<?php

namespace Tests\Feature\Hr;

use App\Models\AttendancePolicy;
use App\Models\AttendanceRecord;
use App\Models\CheckInSession;
use App\Models\LeaveRequest;
use App\Models\LeaveType;
use App\Models\PublicHoliday;
use App\Services\AttendanceService;
use App\Services\CheckInService;
use Carbon\Carbon;
use Tests\TestCase;

/**
 * Feature coverage for the check-in / checkout attendance feature (Phase 2).
 *
 * Timezone contract under test: the org AttendancePolicy timezone is authoritative
 * and server now() (UTC) is the source of truth. The default policy tz is
 * Asia/Karachi (UTC+5, no DST), so a given org-local wall-clock time maps to a
 * fixed UTC instant. Helpers below set the frozen "server now" in UTC.
 *
 * Karachi reference (UTC+5) on a working Monday (2026-03-16):
 *   local 11:00 = 06:00 UTC (before window)
 *   local 11:30 = 06:30 UTC (official start)
 *   local 11:45 = 06:45 UTC (late threshold boundary)
 *   local 11:50 = 06:50 UTC (late)
 *   local 20:00 = 15:00 UTC (before off — early checkout)
 *   local 20:30 = 15:30 UTC (official off boundary)
 *   local 21:00 = 16:00 UTC (overtime)
 */
class CheckInTest extends TestCase
{
    private const MONDAY = '2026-03-16';   // working Monday
    private const TUESDAY = '2026-03-17';  // working Tuesday
    private const SATURDAY = '2026-03-14'; // weekend

    protected function tearDown(): void
    {
        Carbon::setTestNow(); // clear frozen clock
        parent::tearDown();
    }

    /** Freeze the server clock at a UTC instant. */
    private function freezeUtc(string $utc): void
    {
        Carbon::setTestNow(Carbon::parse($utc, 'UTC'));
    }

    private function checkInService(): CheckInService
    {
        return app(CheckInService::class);
    }

    // ── Edge 1: check-in before the window is rejected ─────────────────────

    public function test_check_in_before_window_is_rejected(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $this->freezeUtc(self::MONDAY . ' 06:00:00'); // 11:00 local — before 11:30

        $response = $this->postJson('/api/v1/hr/attendance/check-in');

        $response->assertStatus(422);
        $this->assertDatabaseMissing('attendance_records', [
            'user_id' => $user->id,
        ]);
    }

    // ── Edge 2: within grace + exact boundary are on_time ──────────────────

    public function test_check_in_within_grace_is_on_time(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $this->freezeUtc(self::MONDAY . ' 06:40:00'); // 11:40 local — within grace

        $response = $this->postJson('/api/v1/hr/attendance/check-in');

        $response->assertStatus(201)
            ->assertJsonPath('data.check_in_status', 'on_time')
            ->assertJsonPath('data.check_in_late_minutes', 0);

        $this->assertDatabaseHas('attendance_records', [
            'user_id' => $user->id,
            'date' => self::MONDAY,
            'check_in_status' => 'on_time',
            'check_in_late_minutes' => 0,
        ]);
    }

    public function test_check_in_at_exact_late_boundary_is_on_time(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $this->freezeUtc(self::MONDAY . ' 06:45:00'); // exactly 11:45 local

        $response = $this->postJson('/api/v1/hr/attendance/check-in');

        $response->assertStatus(201)
            ->assertJsonPath('data.check_in_status', 'on_time')
            ->assertJsonPath('data.check_in_late_minutes', 0);
    }

    // ── Edge 3: after threshold is late; minutes from official start ───────

    public function test_check_in_after_threshold_is_late_with_minutes(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $this->freezeUtc(self::MONDAY . ' 06:50:00'); // 11:50 local — 20 min after 11:30

        $response = $this->postJson('/api/v1/hr/attendance/check-in');

        $response->assertStatus(201)
            ->assertJsonPath('data.check_in_status', 'late')
            ->assertJsonPath('data.check_in_late_minutes', 20);

        $this->assertDatabaseHas('attendance_records', [
            'user_id' => $user->id,
            'check_in_status' => 'late',
            'check_in_late_minutes' => 20,
        ]);
    }

    // ── Edge 4: check-in while a session is already OPEN → 422 ─────────────

    public function test_check_in_while_open_session_returns_422(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $this->freezeUtc(self::MONDAY . ' 06:40:00');
        $this->postJson('/api/v1/hr/attendance/check-in')->assertStatus(201);

        // Same day, a few minutes later — session still open → owner-mandated 422.
        $this->freezeUtc(self::MONDAY . ' 06:45:00');
        $this->postJson('/api/v1/hr/attendance/check-in')
            ->assertStatus(422)
            ->assertJsonPath('error.message', 'You already have an open check-in. Please check out first.');

        // Still one day row and exactly one session (no duplicate).
        $this->assertSame(1, AttendanceRecord::where('user_id', $user->id)->count());
        $this->assertSame(1, CheckInSession::where('user_id', $user->id)->count());
    }

    // ── Edge 5: checkout without a check-in → 422 ──────────────────────────

    public function test_checkout_without_check_in_returns_422(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $this->freezeUtc(self::MONDAY . ' 15:00:00');

        $this->postJson('/api/v1/hr/attendance/check-out')->assertStatus(422);
    }

    // ── Edge 6: early / overtime / exact boundary checkout ─────────────────

    public function test_early_checkout_sets_early_minutes(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $this->freezeUtc(self::MONDAY . ' 06:40:00');
        $this->postJson('/api/v1/hr/attendance/check-in')->assertStatus(201);

        $this->freezeUtc(self::MONDAY . ' 15:00:00'); // 20:00 local — 30 min early
        $response = $this->postJson('/api/v1/hr/attendance/check-out');

        $response->assertOk()
            ->assertJsonPath('data.is_early_checkout', true)
            ->assertJsonPath('data.check_out_early_minutes', 30)
            ->assertJsonPath('data.check_out_overtime_minutes', 0);
    }

    public function test_checkout_after_off_time_sets_overtime(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $this->freezeUtc(self::MONDAY . ' 06:40:00');
        $this->postJson('/api/v1/hr/attendance/check-in')->assertStatus(201);

        $this->freezeUtc(self::MONDAY . ' 16:00:00'); // 21:00 local — 30 min OT
        $response = $this->postJson('/api/v1/hr/attendance/check-out');

        $response->assertOk()
            ->assertJsonPath('data.is_early_checkout', false)
            ->assertJsonPath('data.check_out_early_minutes', 0)
            ->assertJsonPath('data.check_out_overtime_minutes', 30);
    }

    public function test_checkout_at_exact_off_boundary_is_normal(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $this->freezeUtc(self::MONDAY . ' 06:40:00');
        $this->postJson('/api/v1/hr/attendance/check-in')->assertStatus(201);

        $this->freezeUtc(self::MONDAY . ' 15:30:00'); // exactly 20:30 local
        $response = $this->postJson('/api/v1/hr/attendance/check-out');

        $response->assertOk()
            ->assertJsonPath('data.is_early_checkout', false)
            ->assertJsonPath('data.check_out_early_minutes', 0)
            ->assertJsonPath('data.check_out_overtime_minutes', 0);
    }

    // ── Edge 7: late arrival AND early checkout coexist (independent) ───────

    public function test_late_and_early_checkout_coexist(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $this->freezeUtc(self::MONDAY . ' 06:50:00'); // 11:50 local — late
        $this->postJson('/api/v1/hr/attendance/check-in')->assertStatus(201);

        $this->freezeUtc(self::MONDAY . ' 15:00:00'); // 20:00 local — early
        $response = $this->postJson('/api/v1/hr/attendance/check-out');

        $response->assertOk()
            ->assertJsonPath('data.check_in_status', 'late')
            ->assertJsonPath('data.is_early_checkout', true)
            ->assertJsonPath('data.check_in_late_minutes', 20)
            ->assertJsonPath('data.check_out_early_minutes', 30);
    }

    // ── Edge 8: midnight spanning / stale backstop / next-day check-in ─────

    public function test_checkout_after_midnight_spans_open_session(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        // Check in Monday 11:40 local (06:40 UTC).
        $this->freezeUtc(self::MONDAY . ' 06:40:00');
        $this->postJson('/api/v1/hr/attendance/check-in')->assertStatus(201);

        // Check out next org-local day at 00:30 local (03-16 19:30 UTC).
        $this->freezeUtc(self::MONDAY . ' 19:30:00');
        $this->postJson('/api/v1/hr/attendance/check-out')->assertOk();

        // The session belongs to the Monday record and worked_seconds spans midnight.
        $record = AttendanceRecord::where('user_id', $user->id)
            ->where('date', self::MONDAY)
            ->first();

        $this->assertNotNull($record);
        $this->assertNotNull($record->check_out_at);
        // 06:40 UTC -> 19:30 UTC = 12h50m = 46200s
        $this->assertSame(46200, $record->worked_seconds);
    }

    public function test_backstop_marks_stale_missing_checkout(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        // Check in Monday, never check out.
        $this->freezeUtc(self::MONDAY . ' 06:40:00');
        $this->postJson('/api/v1/hr/attendance/check-in')->assertStatus(201);

        // Two org-local days later, run the backstop directly (scheduler is prod-only).
        $this->freezeUtc('2026-03-18 06:00:00');
        $closed = $this->checkInService()->autoCloseStaleCheckIns($org->id);

        $this->assertSame(1, $closed);

        $record = AttendanceRecord::where('user_id', $user->id)
            ->where('date', self::MONDAY)
            ->first();

        $this->assertTrue((bool) $record->missing_checkout);
        $this->assertTrue($record->check_in_flags['auto_closed'] ?? false);
        // The session is left open for regularization — not fabricated.
        $this->assertNull($record->check_out_at);
        $this->assertNull($record->worked_seconds);
    }

    public function test_next_day_check_in_allowed_with_open_prior_day(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        // Monday check-in, no checkout.
        $this->freezeUtc(self::MONDAY . ' 06:40:00');
        $this->postJson('/api/v1/hr/attendance/check-in')->assertStatus(201);

        // Tuesday check-in should succeed on its own row.
        $this->freezeUtc(self::TUESDAY . ' 06:40:00');
        $this->postJson('/api/v1/hr/attendance/check-in')->assertStatus(201);

        $this->assertSame(2, AttendanceRecord::where('user_id', $user->id)->count());
        $this->assertDatabaseHas('attendance_records', [
            'user_id' => $user->id,
            'date' => self::TUESDAY,
            'check_in_status' => 'on_time',
        ]);
    }

    // ── Edge 9: checkout strictly after check-in ───────────────────────────

    public function test_checkout_after_check_in_enforced(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $this->freezeUtc(self::MONDAY . ' 06:40:00');
        $this->postJson('/api/v1/hr/attendance/check-in')->assertStatus(201);

        // Simulate clock skew: "now" is earlier than the recorded check-in instant.
        $this->freezeUtc(self::MONDAY . ' 06:30:00');
        $this->postJson('/api/v1/hr/attendance/check-out')->assertStatus(422);
    }

    // ── Edge 10: re-check-in after checkout is ALLOWED (multi-session) ──────

    public function test_re_check_in_after_checkout_allowed(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $this->freezeUtc(self::MONDAY . ' 06:40:00');
        $this->postJson('/api/v1/hr/attendance/check-in')->assertStatus(201);

        $this->freezeUtc(self::MONDAY . ' 15:00:00');
        $this->postJson('/api/v1/hr/attendance/check-out')->assertOk();

        // A second check-in the same day now opens a NEW session (201).
        $this->freezeUtc(self::MONDAY . ' 15:05:00');
        $this->postJson('/api/v1/hr/attendance/check-in')
            ->assertStatus(201)
            ->assertJsonPath('data.sessions_count', 2);

        // One day row, two sessions.
        $this->assertSame(1, AttendanceRecord::where('user_id', $user->id)->count());
        $this->assertSame(2, CheckInSession::where('user_id', $user->id)->count());
    }

    // ── Edge 11: check-in on an off day keeps status + flags it ────────────

    public function test_holiday_check_in_allowed_keeps_status_with_flag(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        PublicHoliday::factory()->create([
            'organization_id' => $org->id,
            'date' => self::MONDAY,
            'name' => 'Test Holiday',
        ]);

        $this->freezeUtc(self::MONDAY . ' 06:40:00');
        $response = $this->postJson('/api/v1/hr/attendance/check-in');

        $response->assertStatus(201)
            ->assertJsonPath('data.status', 'holiday')
            ->assertJsonPath('data.check_in_flags.worked_on_off_day', true);
    }

    public function test_weekend_check_in_allowed_keeps_status_with_flag(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        // Saturday 11:40 local (06:40 UTC).
        $this->freezeUtc(self::SATURDAY . ' 06:40:00');
        $response = $this->postJson('/api/v1/hr/attendance/check-in');

        $response->assertStatus(201)
            ->assertJsonPath('data.status', 'weekend')
            ->assertJsonPath('data.check_in_flags.worked_on_off_day', true);
    }

    // ── Edge 12: windows enforced in the org timezone ──────────────────────

    public function test_windows_enforced_in_org_timezone(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        // Non-PKT org: America/New_York (EDT = UTC-4 on 2026-03-16, DST active).
        AttendancePolicy::factory()->create([
            'organization_id' => $org->id,
            'timezone' => 'America/New_York',
        ]);

        // 15:00 UTC = 11:00 EDT — before the 11:30 window. If enforcement used UTC
        // wall-clock (15:00) this would be accepted as "late"; being rejected proves
        // the org timezone is used.
        $this->freezeUtc(self::MONDAY . ' 15:00:00');
        $this->postJson('/api/v1/hr/attendance/check-in')->assertStatus(422);

        // 15:40 UTC = 11:40 EDT — inside the window, on time.
        $this->freezeUtc(self::MONDAY . ' 15:40:00');
        $this->postJson('/api/v1/hr/attendance/check-in')
            ->assertStatus(201)
            ->assertJsonPath('data.check_in_status', 'on_time');
    }

    // ── Edge 13: check-in while on approved leave flags a warning ──────────

    public function test_check_in_on_approved_leave_flags_warning(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $leaveType = LeaveType::factory()->create(['organization_id' => $org->id]);
        LeaveRequest::factory()->approved()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'leave_type_id' => $leaveType->id,
            'start_date' => self::MONDAY,
            'end_date' => self::MONDAY,
        ]);

        $this->freezeUtc(self::MONDAY . ' 06:40:00');
        $response = $this->postJson('/api/v1/hr/attendance/check-in');

        $response->assertStatus(201)
            ->assertJsonPath('data.status', 'on_leave')
            ->assertJsonPath('data.check_in_flags.on_approved_leave', true);
    }

    // ── Edge 14: client-supplied timestamp is ignored ──────────────────────

    public function test_client_supplied_timestamp_is_ignored(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $this->freezeUtc(self::MONDAY . ' 06:40:00');

        // Attempt to spoof the check-in instant via the request body.
        $response = $this->postJson('/api/v1/hr/attendance/check-in', [
            'check_in_at' => '2020-01-01T00:00:00Z',
            'timestamp' => '2020-01-01T00:00:00Z',
            'check_in_status' => 'on_time',
        ]);

        $response->assertStatus(201);

        $record = AttendanceRecord::where('user_id', $user->id)->first();
        // Server clock wins: recorded at 06:40 UTC on the Monday, not 2020.
        $this->assertSame(self::MONDAY, $record->date->toDateString());
        $this->assertSame(
            self::MONDAY . ' 06:40:00',
            $record->check_in_at->utc()->format('Y-m-d H:i:s')
        );
    }

    // ── Edge 15: open-session guard blocks a second concurrent check-in ────

    public function test_concurrent_check_in_only_one_succeeds(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        // Simulate the "first" transaction having already opened a session for today's
        // row. The lockForUpdate + open-session guard must reject the second attempt.
        $record = AttendanceRecord::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'date' => self::MONDAY,
            'status' => 'present',
            'check_in_at' => Carbon::parse(self::MONDAY . ' 06:35:00', 'UTC'),
            'check_in_status' => 'on_time',
            'check_in_late_minutes' => 0,
            'check_out_at' => null,
            'sessions_count' => 1,
        ]);
        CheckInSession::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'attendance_record_id' => $record->id,
            'seq' => 1,
            'check_in_at' => Carbon::parse(self::MONDAY . ' 06:35:00', 'UTC'),
            'check_out_at' => null,
        ]);

        $this->freezeUtc(self::MONDAY . ' 06:40:00');
        $this->postJson('/api/v1/hr/attendance/check-in')
            ->assertStatus(422)
            ->assertJsonPath('error.message', 'You already have an open check-in. Please check out first.');

        $this->assertSame(1, AttendanceRecord::where('user_id', $user->id)->count());
    }

    // ── Edge 16: day boundary uses org-local date, not UTC date ────────────

    public function test_day_boundary_uses_org_local_date(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        // Early check-in allowed so we can check in at 02:00 local.
        AttendancePolicy::factory()->allowsEarlyCheckIn()->create([
            'organization_id' => $org->id,
            'timezone' => 'Asia/Karachi',
        ]);

        // 2026-03-16 21:00 UTC = 2026-03-17 02:00 Karachi. The org-local date is the
        // 17th even though the UTC date is still the 16th.
        $this->freezeUtc(self::MONDAY . ' 21:00:00');
        $this->postJson('/api/v1/hr/attendance/check-in')->assertStatus(201);

        $this->assertDatabaseHas('attendance_records', [
            'user_id' => $user->id,
            'date' => self::TUESDAY, // org-local day
        ]);
        $this->assertDatabaseMissing('attendance_records', [
            'user_id' => $user->id,
            'date' => self::MONDAY,
        ]);
    }

    // ── Reconciliation: daily job elevates a checked-in absent to present ──

    public function test_daily_job_elevates_checked_in_absent_to_present(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');

        // A checked-in record whose computed status would be 'absent' (no tracked
        // time). The nightly job must elevate it to 'present'.
        AttendanceRecord::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'date' => self::MONDAY,
            'status' => 'absent',
            'total_hours' => 0,
            'first_seen' => null,
            'last_seen' => null,
            'check_in_at' => Carbon::parse(self::MONDAY . ' 06:40:00', 'UTC'),
            'check_in_status' => 'on_time',
            'check_in_late_minutes' => 0,
        ]);

        app(AttendanceService::class)->generateDailyAttendance($org->id, self::MONDAY);

        $record = AttendanceRecord::where('user_id', $user->id)
            ->where('date', self::MONDAY)
            ->first();

        $this->assertSame('present', $record->status);
        $this->assertNotNull($record->check_in_at);
    }

    // ── Reconciliation: daily job never clobbers check-in columns ──────────

    public function test_daily_job_does_not_overwrite_check_in_columns(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');

        // Real check-in through the service.
        $this->freezeUtc(self::MONDAY . ' 06:50:00'); // late by 20 min
        $this->checkInService()->checkIn($user);

        $checkInAt = AttendanceRecord::where('user_id', $user->id)->value('check_in_at');

        // Run the nightly job for the same day (no time entries → would compute absent).
        app(AttendanceService::class)->generateDailyAttendance($org->id, self::MONDAY);

        $record = AttendanceRecord::where('user_id', $user->id)
            ->where('date', self::MONDAY)
            ->first();

        // Check-in columns are untouched by the job.
        $this->assertSame('late', $record->check_in_status);
        $this->assertSame(20, $record->check_in_late_minutes);
        $this->assertSame(
            $checkInAt->utc()->format('Y-m-d H:i:s'),
            $record->check_in_at->utc()->format('Y-m-d H:i:s')
        );
        // And the status was elevated (checked-in absent -> present).
        $this->assertSame('present', $record->status);
    }

    // ── Attendance list / summary reconciliation (check-in → table) ────────

    public function test_check_in_populates_clock_in_and_late_in_attendance_list(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        // 11:50 Karachi = 06:50 UTC — late by 20 minutes from the 11:30 official start.
        $this->freezeUtc(self::MONDAY . ' 06:50:00');
        $this->postJson('/api/v1/hr/attendance/check-in')->assertStatus(201);

        $response = $this->getJson('/api/v1/hr/attendance?start_date=' . self::MONDAY . '&end_date=' . self::MONDAY);

        $response->assertOk();
        $row = $response->json('data.0');

        // clock_in is filled from the physical check-in, rendered in the org tz (H:i).
        $this->assertSame('11:50', $row['clock_in']);
        $this->assertNull($row['clock_out']);
        // Late minutes come from the check-in signal, not the (zero) tracker figure.
        $this->assertSame(20, $row['late_minutes']);
        $this->assertSame('late', $row['check_in_status']);
        $this->assertSame('present', $row['status']);
        // The check-in instant is passed through so the row can render its badge.
        $this->assertNotNull($row['check_in_at']);
    }

    public function test_checkout_populates_clock_out_and_hours_in_attendance_list(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        // Check in on time (11:40 Karachi), check out at the official off time (20:30).
        $this->freezeUtc(self::MONDAY . ' 06:40:00');
        $this->postJson('/api/v1/hr/attendance/check-in')->assertStatus(201);

        $this->freezeUtc(self::MONDAY . ' 15:30:00'); // 20:30 Karachi
        $this->postJson('/api/v1/hr/attendance/check-out')->assertOk();

        $response = $this->getJson('/api/v1/hr/attendance?start_date=' . self::MONDAY . '&end_date=' . self::MONDAY);

        $response->assertOk();
        $row = $response->json('data.0');

        $this->assertSame('11:40', $row['clock_in']);
        $this->assertSame('20:30', $row['clock_out']);
        // Hours derived from the check-in session (8h50m) even with no tracked time.
        $this->assertGreaterThan(0, $row['total_hours']);
        $this->assertEqualsWithDelta(8.83, (float) $row['total_hours'], 0.02);
        $this->assertSame(31800, $row['worked_seconds']);
        $this->assertSame('08:50', $row['worked_hhmm']);
    }

    public function test_summary_counts_a_check_in_present_day(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        // A single on-time check-in on a working Monday, no nightly generation run.
        $this->freezeUtc(self::MONDAY . ' 06:40:00');
        $this->postJson('/api/v1/hr/attendance/check-in')->assertStatus(201);

        $response = $this->getJson('/api/v1/hr/attendance/summary?month=3&year=2026');

        $response->assertOk()
            ->assertJsonPath('data.present_days', 1)
            ->assertJsonPath('data.total_working_days', 1);
    }

    // ── Cross-org isolation ────────────────────────────────────────────────

    public function test_check_in_cross_org_isolation(): void
    {
        $orgA = $this->createOrganization();
        $orgB = $this->createOrganization();

        $employeeA = $this->createUser($orgA, 'employee');
        $managerB = $this->createUser($orgB, 'org_manager');

        // Employee A checks in.
        $this->actingAs($employeeA, 'sanctum');
        $this->freezeUtc(self::MONDAY . ' 06:40:00');
        $this->postJson('/api/v1/hr/attendance/check-in')->assertStatus(201);

        $recordA = AttendanceRecord::where('user_id', $employeeA->id)->first();

        // Org B admin lists check-ins — must not see org A's record.
        $this->actingAs($managerB, 'sanctum');
        $response = $this->getJson('/api/v1/hr/attendance/check-ins');
        $response->assertOk();

        $ids = collect($response->json('data'))->pluck('id')->all();
        $this->assertNotContains($recordA->id, $ids);
        $this->assertCount(0, $response->json('data'));
    }

    // ── Policy management ──────────────────────────────────────────────────

    public function test_policy_update_validates_time_ordering(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'org_manager');
        $this->actingAs($admin, 'sanctum');

        $response = $this->putJson('/api/v1/hr/attendance/policy', [
            'check_in_time' => '11:30:00',
            'late_threshold' => '11:00:00', // before check-in time — invalid
            'checkout_time' => '20:30:00',
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['late_threshold']);
    }

    public function test_policy_update_succeeds_for_admin(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'org_manager');
        $this->actingAs($admin, 'sanctum');

        $response = $this->putJson('/api/v1/hr/attendance/policy', [
            'check_in_time' => '10:00:00',
            'late_threshold' => '10:15:00',
            'checkout_time' => '19:00:00',
            'timezone' => 'Asia/Karachi',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.check_in_time', '10:00:00')
            ->assertJsonPath('data.late_threshold', '10:15:00');
    }

    public function test_employee_cannot_update_policy(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $this->actingAs($employee, 'sanctum');

        $response = $this->putJson('/api/v1/hr/attendance/policy', [
            'check_in_time' => '10:00:00',
        ]);

        $response->assertStatus(403);
    }

    public function test_policy_show_returns_defaults(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $response = $this->getJson('/api/v1/hr/attendance/policy');

        $response->assertOk()
            ->assertJsonPath('data.check_in_time', '11:30:00')
            ->assertJsonPath('data.timezone', 'Asia/Karachi');
    }
}
