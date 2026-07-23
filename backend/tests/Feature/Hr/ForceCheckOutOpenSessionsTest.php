<?php

namespace Tests\Feature\Hr;

use App\Models\ActivityLog;
use App\Models\AttendanceRecord;
use App\Models\CheckInSession;
use App\Models\Organization;
use App\Models\Project;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\CheckInService;
use Carbon\Carbon;
use Tests\TestCase;

/**
 * Feature B — midnight (00:00 PKT) force-checkout of forgotten open sessions
 * (owner request 2026-07-23). Distinct from the 3am close-stale backstop: this
 * one STAMPS a real check_out_at at the user's last tracked activity that day,
 * falling back to the policy checkout_time.
 *
 * Karachi (UTC+5, no DST). Working Monday 2026-03-16, policy defaults
 * check_in 11:30 / late 11:45 / checkout 20:30:
 *   local 11:40 = 06:40 UTC  (on-time check-in)
 *   local 18:00 = 13:00 UTC  (a mid-day tracked-entry end)
 *   local 20:30 = 15:30 UTC  (policy checkout_time — the fallback)
 *   local 21:00 = 16:00 UTC  (overtime)
 * The next org-local midnight (00:00 Tue Karachi) = 2026-03-16 19:00 UTC — the
 * instant the prod schedule fires.
 *
 * The service method is exercised directly (Redis-free); the scheduler is prod-only.
 */
class ForceCheckOutOpenSessionsTest extends TestCase
{
    private const MONDAY = '2026-03-16';

    /** 00:00 Tuesday Karachi — org-local midnight, when the job runs in prod. */
    private const MIDNIGHT_UTC = '2026-03-16 19:00:00';

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

    /** Open an on-time Monday check-in for the user (leaves the session open). */
    private function checkInMonday(User $user, string $utc = self::MONDAY . ' 06:40:00'): AttendanceRecord
    {
        $this->freezeUtc($utc);

        return $this->service()->checkIn($user);
    }

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

    // ── Primary: checkout stamped at the last tracked activity ─────────────

    public function test_checks_out_at_last_tracked_activity(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');

        $this->checkInMonday($user);                                  // 06:40 UTC
        $this->trackedEntry($org, $user, self::MONDAY . ' 06:40:00', self::MONDAY . ' 13:00:00'); // ends 18:00 local

        $this->freezeUtc(self::MIDNIGHT_UTC);
        $closed = $this->service()->autoCheckOutOpenSessions($org->id);

        $this->assertSame(1, $closed);

        $record = AttendanceRecord::where('user_id', $user->id)->where('date', self::MONDAY)->first();
        // check_out_at rolled up to the tracked entry's end (13:00 UTC).
        $this->assertSame(
            self::MONDAY . ' 13:00:00',
            $record->check_out_at->utc()->format('Y-m-d H:i:s')
        );
        // 06:40 → 13:00 UTC = 6h20m = 22800s.
        $this->assertSame(22800, $record->worked_seconds);

        // Audit flags: fabricated checkout is regularizable.
        $this->assertTrue((bool) $record->missing_checkout);
        $this->assertTrue($record->check_in_flags['auto_closed'] ?? false);
        $this->assertTrue($record->check_in_flags['auto_checked_out'] ?? false);

        // No session remains open.
        $this->assertSame(0, CheckInSession::where('attendance_record_id', $record->id)->open()->count());
    }

    // ── Heartbeat drives the checkout when the entry is still open ──────────

    public function test_uses_heartbeat_when_tracked_entry_still_open(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');

        $this->checkInMonday($user);

        // A still-running tracked entry (null ended_at) + a heartbeat at 19:00 local (14:00 UTC).
        $entry = $this->trackedEntry($org, $user, self::MONDAY . ' 06:40:00', null);
        ActivityLog::create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'logged_at' => Carbon::parse(self::MONDAY . ' 14:00:00', 'UTC'),
            'keyboard_events' => 10,
            'mouse_events' => 20,
        ]);

        $this->freezeUtc(self::MIDNIGHT_UTC);
        $this->assertSame(1, $this->service()->autoCheckOutOpenSessions($org->id));

        $record = AttendanceRecord::where('user_id', $user->id)->where('date', self::MONDAY)->first();
        // The open entry has no ended_at, so the heartbeat (14:00 UTC) is the last activity.
        $this->assertSame(
            self::MONDAY . ' 14:00:00',
            $record->check_out_at->utc()->format('Y-m-d H:i:s')
        );
    }

    // ── Fallback: no activity → policy checkout_time ───────────────────────

    public function test_falls_back_to_checkout_time_when_no_activity(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');

        $this->checkInMonday($user); // no tracked entries / heartbeats at all

        $this->freezeUtc(self::MIDNIGHT_UTC);
        $this->assertSame(1, $this->service()->autoCheckOutOpenSessions($org->id));

        $record = AttendanceRecord::where('user_id', $user->id)->where('date', self::MONDAY)->first();
        // Falls back to the policy checkout_time 20:30 local = 15:30 UTC.
        $this->assertSame(
            self::MONDAY . ' 15:30:00',
            $record->check_out_at->utc()->format('Y-m-d H:i:s')
        );
        // 06:40 → 15:30 UTC = 8h50m = 31800s.
        $this->assertSame(31800, $record->worked_seconds);
    }

    public function test_falls_back_to_checkout_time_when_activity_precedes_check_in(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');

        // Late check-in at 19:00 local (14:00 UTC).
        $this->checkInMonday($user, self::MONDAY . ' 14:00:00');
        // Tracked activity ended BEFORE the check-in (12:00 local = 07:00 UTC) — unusable.
        $this->trackedEntry($org, $user, self::MONDAY . ' 06:00:00', self::MONDAY . ' 07:00:00');

        $this->freezeUtc(self::MIDNIGHT_UTC);
        $this->assertSame(1, $this->service()->autoCheckOutOpenSessions($org->id));

        $record = AttendanceRecord::where('user_id', $user->id)->where('date', self::MONDAY)->first();
        // Activity (07:00) <= check-in (14:00) → fall back to checkout_time 15:30 UTC.
        $this->assertSame(
            self::MONDAY . ' 15:30:00',
            $record->check_out_at->utc()->format('Y-m-d H:i:s')
        );
    }

    // ── Overtime path recomputed correctly ─────────────────────────────────

    public function test_rollups_recompute_overtime(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');

        $this->checkInMonday($user);
        // Tracked work ends 21:00 local = 16:00 UTC — 30 min past the 20:30 off-time.
        $this->trackedEntry($org, $user, self::MONDAY . ' 06:40:00', self::MONDAY . ' 16:00:00');

        $this->freezeUtc(self::MIDNIGHT_UTC);
        $this->service()->autoCheckOutOpenSessions($org->id);

        $record = AttendanceRecord::where('user_id', $user->id)->where('date', self::MONDAY)->first();
        $this->assertFalse((bool) $record->is_early_checkout);
        $this->assertSame(0, $record->check_out_early_minutes);
        $this->assertSame(30, $record->check_out_overtime_minutes);
        // 06:40 → 16:00 UTC = 9h20m = 33600s.
        $this->assertSame(33600, $record->worked_seconds);
    }

    // ── Degenerate: check-in after both activity and off-time → +1s guard ──

    public function test_degenerate_late_checkin_closes_one_second_after(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');

        // Check in at 21:00 local (16:00 UTC) — already past the 20:30 off-time — no activity.
        $record = $this->checkInMonday($user, self::MONDAY . ' 16:00:00');
        $checkInAt = $record->check_in_at->copy();

        $this->freezeUtc(self::MIDNIGHT_UTC);
        $this->assertSame(1, $this->service()->autoCheckOutOpenSessions($org->id));

        $record->refresh();
        // checkout_time (15:30 UTC) is before the check-in, so the guard stamps check_in + 1s.
        $this->assertSame(
            $checkInAt->copy()->addSecond()->utc()->format('Y-m-d H:i:s'),
            $record->check_out_at->utc()->format('Y-m-d H:i:s')
        );
        $this->assertSame(1, $record->worked_seconds);
    }

    // ── Never closes a session from the CURRENT org-local day ──────────────

    public function test_never_closes_current_day_session(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');

        $this->checkInMonday($user); // open Monday session

        // Still Monday org-local (13:00 Karachi) when the method runs.
        $this->freezeUtc(self::MONDAY . ' 08:00:00');
        $this->assertSame(0, $this->service()->autoCheckOutOpenSessions($org->id));

        $record = AttendanceRecord::where('user_id', $user->id)->where('date', self::MONDAY)->first();
        $this->assertNull($record->check_out_at);
        $this->assertSame(1, CheckInSession::where('attendance_record_id', $record->id)->open()->count());
    }

    // ── Idempotent: a second run never double-closes ───────────────────────

    public function test_idempotent_no_double_close(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');

        $this->checkInMonday($user);
        $this->trackedEntry($org, $user, self::MONDAY . ' 06:40:00', self::MONDAY . ' 13:00:00');

        $this->freezeUtc(self::MIDNIGHT_UTC);
        $this->assertSame(1, $this->service()->autoCheckOutOpenSessions($org->id));

        $record = AttendanceRecord::where('user_id', $user->id)->where('date', self::MONDAY)->first();
        $firstCheckout = $record->check_out_at->copy();

        // Second run: nothing open → 0, and the stamped checkout is unchanged.
        $this->assertSame(0, $this->service()->autoCheckOutOpenSessions($org->id));
        $record->refresh();
        $this->assertTrue($record->check_out_at->equalTo($firstCheckout));
    }

    // ── A manually-closed session is left untouched ────────────────────────

    public function test_skips_already_closed_session(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $this->checkInMonday($user);

        // User checked out manually at 20:30 local (15:30 UTC).
        $this->freezeUtc(self::MONDAY . ' 15:30:00');
        $this->service()->checkOut($user);

        $this->freezeUtc(self::MIDNIGHT_UTC);
        $this->assertSame(0, $this->service()->autoCheckOutOpenSessions($org->id));

        $record = AttendanceRecord::where('user_id', $user->id)->where('date', self::MONDAY)->first();
        // Manual checkout preserved, not overwritten, and not flagged auto_closed.
        $this->assertSame(
            self::MONDAY . ' 15:30:00',
            $record->check_out_at->utc()->format('Y-m-d H:i:s')
        );
        $this->assertFalse((bool) $record->missing_checkout);
        $this->assertNull($record->check_in_flags['auto_checked_out'] ?? null);
    }

    // ── Multi-session: only the open session is closed; closed ones intact ─

    public function test_closes_only_open_session_of_a_multi_session_day(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        // Session 1: 11:40 → 14:00 local (06:40 → 09:00 UTC), closed by the user.
        $this->checkInMonday($user);
        $this->freezeUtc(self::MONDAY . ' 09:00:00');
        $this->service()->checkOut($user);

        // Session 2: re-check-in at 15:00 local (10:00 UTC), left open.
        $this->freezeUtc(self::MONDAY . ' 10:00:00');
        $this->service()->checkIn($user);

        // Activity through 19:00 local (14:00 UTC).
        $this->trackedEntry($org, $user, self::MONDAY . ' 10:00:00', self::MONDAY . ' 14:00:00');

        $this->freezeUtc(self::MIDNIGHT_UTC);
        $this->assertSame(1, $this->service()->autoCheckOutOpenSessions($org->id));

        $record = AttendanceRecord::where('user_id', $user->id)->where('date', self::MONDAY)->first();

        // Session 1 keeps its original checkout; session 2 is stamped at the last activity.
        $sessions = CheckInSession::where('attendance_record_id', $record->id)->orderBy('seq')->get();
        $this->assertSame(
            self::MONDAY . ' 09:00:00',
            $sessions[0]->check_out_at->utc()->format('Y-m-d H:i:s')
        );
        $this->assertSame(
            self::MONDAY . ' 14:00:00',
            $sessions[1]->check_out_at->utc()->format('Y-m-d H:i:s')
        );
        // worked = (06:40→09:00) 8400 + (10:00→14:00) 14400 = 22800.
        $this->assertSame(22800, $record->worked_seconds);
    }

    // ── Cross-org isolation ────────────────────────────────────────────────

    public function test_org_isolation(): void
    {
        $orgA = $this->createOrganization();
        $orgB = $this->createOrganization();
        $userA = $this->createUser($orgA, 'employee');
        $userB = $this->createUser($orgB, 'employee');

        $this->checkInMonday($userA);
        $this->checkInMonday($userB);

        $this->freezeUtc(self::MIDNIGHT_UTC);

        // Only org A is processed.
        $this->assertSame(1, $this->service()->autoCheckOutOpenSessions($orgA->id));

        $recordA = AttendanceRecord::where('user_id', $userA->id)->where('date', self::MONDAY)->first();
        $recordB = AttendanceRecord::where('user_id', $userB->id)->where('date', self::MONDAY)->first();

        // A is closed; B is completely untouched.
        $this->assertNotNull($recordA->check_out_at);
        $this->assertNull($recordB->check_out_at);
        $this->assertSame(1, CheckInSession::where('attendance_record_id', $recordB->id)->open()->count());
        $this->assertFalse((bool) $recordB->missing_checkout);
    }
}
