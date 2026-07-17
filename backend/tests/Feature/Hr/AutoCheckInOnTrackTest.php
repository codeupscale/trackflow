<?php

namespace Tests\Feature\Hr;

use App\Events\TimerStarted;
use App\Listeners\AutoCheckInOnTimerStart;
use App\Models\AttendanceRecord;
use App\Models\CheckInSession;
use App\Models\Organization;
use App\Models\Project;
use App\Models\TimeEntry;
use App\Services\CheckInService;
use Carbon\Carbon;
use Tests\TestCase;

/**
 * Auto check-in on first timer start of the day (owner request, 2026-07-16).
 *
 * Karachi (UTC+5, no DST) working Monday 2026-03-16, policy defaults
 * check_in_time 11:30 / late_threshold 11:45:
 *   local 09:00 = 04:00 UTC  (well before the window)
 *   local 11:40 = 06:40 UTC  (on time — within grace)
 *   local 13:00 = 08:00 UTC  (late — 75 min past the 11:45 threshold)
 *
 * These exercise the service directly (no Redis), plus the listener wiring.
 */
class AutoCheckInOnTrackTest extends TestCase
{
    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function service(): CheckInService
    {
        return app(CheckInService::class);
    }

    /** Org with the feature toggled on (default is off). */
    private function orgWithFeature(bool $on = true): Organization
    {
        $org = $this->createOrganization();
        $org->update(['settings' => array_merge($org->settings ?? [], [
            'auto_check_in_on_track' => $on,
        ])]);

        return $org->refresh();
    }

    public function test_feature_off_creates_no_check_in(): void
    {
        $org = $this->createOrganization(); // default: auto_check_in_on_track = false
        $user = $this->createUser($org, 'employee');

        $result = $this->service()->autoCheckInFromTracking(
            $user,
            Carbon::parse('2026-03-16 06:40:00', 'UTC')
        );

        $this->assertNull($result);
        $this->assertDatabaseMissing('check_in_sessions', ['user_id' => $user->id]);
    }

    public function test_records_check_in_at_the_real_start_time_on_time(): void
    {
        $org = $this->orgWithFeature();
        $user = $this->createUser($org, 'employee');

        $start = Carbon::parse('2026-03-16 06:40:00', 'UTC'); // 11:40 local
        $record = $this->service()->autoCheckInFromTracking($user, $start);

        $this->assertNotNull($record);
        $this->assertEquals('on_time', $record->check_in_status);
        $this->assertEquals(0, $record->check_in_late_minutes);
        // check_in_at rolls up from the session, stamped at the true start.
        $this->assertTrue($record->check_in_at->equalTo($start), 'check_in_at must equal the timer start');
        $this->assertTrue((bool) ($record->check_in_flags['auto_check_in'] ?? false));

        $session = CheckInSession::withoutGlobalScopes()->where('user_id', $user->id)->first();
        $this->assertNotNull($session);
        $this->assertEquals(1, $session->seq);
        $this->assertTrue($session->check_in_at->equalTo($start));
    }

    public function test_early_start_before_window_is_still_recorded(): void
    {
        // The normal checkIn() 422s before the window. Auto MUST record it instead.
        $org = $this->orgWithFeature();
        $user = $this->createUser($org, 'employee');

        $start = Carbon::parse('2026-03-16 04:00:00', 'UTC'); // 09:00 local, before 11:30
        $record = $this->service()->autoCheckInFromTracking($user, $start);

        $this->assertNotNull($record);
        $this->assertEquals('on_time', $record->check_in_status);
        $this->assertTrue($record->check_in_at->equalTo($start));
    }

    public function test_late_start_is_marked_late_honestly(): void
    {
        $org = $this->orgWithFeature();
        $user = $this->createUser($org, 'employee');

        $start = Carbon::parse('2026-03-16 08:00:00', 'UTC'); // 13:00 local
        $record = $this->service()->autoCheckInFromTracking($user, $start);

        $this->assertNotNull($record);
        $this->assertEquals('late', $record->check_in_status);
        // 11:45 → 13:00 = 75 minutes past the threshold.
        $this->assertEquals(75, $record->check_in_late_minutes);
    }

    public function test_skips_when_user_already_checked_in_manually(): void
    {
        $org = $this->orgWithFeature();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        // Manual web check-in at 11:40 local.
        Carbon::setTestNow(Carbon::parse('2026-03-16 06:40:00', 'UTC'));
        $manual = $this->service()->checkIn($user);
        $manualCheckInAt = $manual->fresh()->check_in_at;

        // Later, the desktop starts tracking with an earlier real start (09:00).
        $result = $this->service()->autoCheckInFromTracking(
            $user,
            Carbon::parse('2026-03-16 04:00:00', 'UTC')
        );

        $this->assertNull($result, 'auto must not override a manual check-in');
        $this->assertEquals(
            1,
            CheckInSession::withoutGlobalScopes()->where('user_id', $user->id)->count(),
            'no second session may be created'
        );
        // The manual check-in time is preserved, not overwritten by 09:00.
        $this->assertTrue(
            AttendanceRecord::withoutGlobalScopes()->where('user_id', $user->id)->first()
                ->check_in_at->equalTo($manualCheckInAt)
        );
    }

    public function test_is_idempotent_across_repeated_starts(): void
    {
        $org = $this->orgWithFeature();
        $user = $this->createUser($org, 'employee');

        $start = Carbon::parse('2026-03-16 06:40:00', 'UTC');
        $this->service()->autoCheckInFromTracking($user, $start);
        $second = $this->service()->autoCheckInFromTracking($user, $start->copy()->addMinutes(30));

        $this->assertNull($second, 'a later start on an already-checked-in day is a no-op');
        $this->assertEquals(1, CheckInSession::withoutGlobalScopes()->where('user_id', $user->id)->count());
    }

    public function test_uses_the_day_of_the_start_timestamp_not_today(): void
    {
        // Offline start on Monday replays while "now" is Tuesday — the check-in must
        // land on Monday, the day work actually began.
        $org = $this->orgWithFeature();
        $user = $this->createUser($org, 'employee');

        Carbon::setTestNow(Carbon::parse('2026-03-17 08:00:00', 'UTC')); // Tuesday
        $record = $this->service()->autoCheckInFromTracking(
            $user,
            Carbon::parse('2026-03-16 06:40:00', 'UTC') // Monday 11:40 local
        );

        $this->assertNotNull($record);
        $this->assertEquals('2026-03-16', $record->date instanceof Carbon
            ? $record->date->toDateString()
            : (string) $record->date);
    }

    public function test_listener_creates_check_in_from_timer_started_event(): void
    {
        $org = $this->orgWithFeature();
        $user = $this->createUser($org, 'employee');
        $project = Project::factory()->create([
            'organization_id' => $org->id,
            'created_by' => $user->id,
        ]);

        $entry = TimeEntry::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'project_id' => $project->id,
            'type' => 'tracked',
            'started_at' => Carbon::parse('2026-03-16 06:40:00', 'UTC'),
            'ended_at' => null,
        ]);

        (new AutoCheckInOnTimerStart($this->service()))
            ->handle(new TimerStarted($entry));

        $record = AttendanceRecord::withoutGlobalScopes()->where('user_id', $user->id)->first();
        $this->assertNotNull($record);
        $this->assertTrue((bool) ($record->check_in_flags['auto_check_in'] ?? false));
        $this->assertEquals(1, CheckInSession::withoutGlobalScopes()->where('user_id', $user->id)->count());
    }
}
