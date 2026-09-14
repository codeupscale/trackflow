<?php

namespace Tests\Feature\Notifications;

use App\Jobs\PruneNotificationsJob;
use App\Models\DatabaseNotification;
use App\Models\Payslip;
use App\Models\PublicHoliday;
use App\Models\User;
use App\Notifications\Channels\SafeBroadcastChannel;
use App\Notifications\HolidayAnnounced;
use App\Notifications\OrgActivity;
use App\Notifications\PayslipSent;
use App\Support\NotificationPreferences;
use Illuminate\Notifications\Channels\BroadcastChannel;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The controls around delivery: muting, retention, and surviving an outage.
 */
class NotificationPreferencesTest extends TestCase
{
    // ── Muting ─────────────────────────────────────────────────────────

    public function test_a_muted_group_drops_in_app_delivery(): void
    {
        $org = $this->createOrganization();
        $alice = $this->createUser($org, 'employee');
        NotificationPreferences::save($alice, ['holidays']);

        $channels = (new HolidayAnnounced(new PublicHoliday(['name' => 'X', 'date' => now()])))->via($alice->fresh());

        $this->assertSame([], $channels);
    }

    public function test_an_unmuted_group_still_delivers(): void
    {
        $org = $this->createOrganization();
        $alice = $this->createUser($org, 'employee');
        NotificationPreferences::save($alice, ['my_leave']);

        $channels = (new HolidayAnnounced(new PublicHoliday(['name' => 'X', 'date' => now()])))->via($alice->fresh());

        $this->assertSame(['database', SafeBroadcastChannel::class], $channels);
    }

    public function test_muting_payslips_still_sends_the_email(): void
    {
        // The bell can be quiet; a payslip should not vanish with it.
        $org = $this->createOrganization();
        $alice = $this->createUser($org, 'employee');
        NotificationPreferences::save($alice, ['my_payslips']);

        $channels = (new PayslipSent(new Payslip, 'March 2026'))->via($alice->fresh());

        $this->assertSame(['mail'], $channels);
    }

    public function test_longest_prefix_decides_the_group(): void
    {
        // 'shift.assigned_to_you' must not be swallowed by the org group's
        // shorter 'shift.assigned' prefix, or an employee muting org noise
        // would silently lose their own shift notifications.
        $this->assertSame('my_shifts', NotificationPreferences::groupFor('shift.assigned_to_you'));
        $this->assertSame('shift_assignments', NotificationPreferences::groupFor('shift.assigned'));
        $this->assertSame('attendance', NotificationPreferences::groupFor('attendance.checked_out'));
        $this->assertNull(NotificationPreferences::groupFor('something.unknown'));
    }

    public function test_employees_are_only_offered_personal_groups(): void
    {
        $org = $this->createOrganization();
        $alice = $this->createUser($org, 'employee');

        $audiences = collect($this->actingAs($alice, 'sanctum')
            ->getJson('/api/v1/notifications/preferences')
            ->assertOk()
            ->json('data'))->pluck('audience')->unique()->values()->all();

        $this->assertSame(['personal'], $audiences);
    }

    public function test_hr_is_offered_both_org_and_personal_groups(): void
    {
        $org = $this->createOrganization();
        $hr = $this->createUser($org, 'hr_manager');

        $audiences = collect($this->actingAs($hr, 'sanctum')
            ->getJson('/api/v1/notifications/preferences')
            ->assertOk()
            ->json('data'))->pluck('audience')->unique()->sort()->values()->all();

        $this->assertSame(['org', 'personal'], $audiences);
    }

    public function test_preferences_save_and_reject_unknown_groups(): void
    {
        $org = $this->createOrganization();
        $hr = $this->createUser($org, 'hr_manager');
        $this->actingAs($hr, 'sanctum');

        $this->putJson('/api/v1/notifications/preferences', ['muted' => ['not_a_group']])->assertStatus(422);

        $this->putJson('/api/v1/notifications/preferences', ['muted' => ['attendance']])->assertOk();
        $this->assertSame(['attendance'], NotificationPreferences::muted($hr->fresh()));

        $this->putJson('/api/v1/notifications/preferences', ['muted' => []])->assertOk();
        $this->assertSame([], NotificationPreferences::muted($hr->fresh()));
    }

    // ── Surviving a websocket outage ───────────────────────────────────

    public function test_a_broadcast_failure_does_not_fail_the_notification(): void
    {
        $org = $this->createOrganization();
        $hr = $this->createUser($org, 'hr_manager');

        $failing = new class extends BroadcastChannel
        {
            public function __construct() {}

            public function send($notifiable, $notification)
            {
                throw new \RuntimeException('cURL error 7: failed to connect to reverb');
            }
        };

        $result = (new SafeBroadcastChannel($failing))
            ->send($hr, OrgActivity::departmentCreated('Ops', 'Owner'));

        $this->assertNull($result);
    }

    // ── Retention ──────────────────────────────────────────────────────

    private function row(User $user, int $daysOld, bool $read): string
    {
        $id = (string) Str::uuid();
        $at = now()->subDays($daysOld);

        DatabaseNotification::create([
            'id' => $id,
            'type' => 'holiday.announced',
            'notifiable_type' => User::class,
            'notifiable_id' => $user->id,
            'organization_id' => $user->organization_id,
            'data' => ['category' => 'holiday.announced', 'title' => 't', 'body' => '', 'url' => null, 'meta' => []],
            'read_at' => $read ? $at : null,
            'created_at' => $at,
            'updated_at' => $at,
        ]);

        return $id;
    }

    public function test_pruning_keeps_recent_and_unread_and_removes_what_has_expired(): void
    {
        $org = $this->createOrganization();
        $alice = $this->createUser($org, 'employee');

        $recentRead = $this->row($alice, 10, true);
        $oldRead = $this->row($alice, 100, true);        // read, past 90 days
        $oldUnread = $this->row($alice, 100, false);     // unread, inside 180
        $ancientUnread = $this->row($alice, 200, false); // anything past 180

        $deleted = PruneNotificationsJob::prune($org->id);

        $this->assertSame(2, $deleted);
        $this->assertDatabaseHas('notifications', ['id' => $recentRead]);
        $this->assertDatabaseHas('notifications', ['id' => $oldUnread]);
        $this->assertDatabaseMissing('notifications', ['id' => $oldRead]);
        $this->assertDatabaseMissing('notifications', ['id' => $ancientUnread]);
    }

    public function test_pruning_never_touches_another_organization(): void
    {
        $orgA = $this->createOrganization();
        $orgB = $this->createOrganization();
        $a = $this->createUser($orgA, 'employee');
        $b = $this->createUser($orgB, 'employee');

        $this->row($a, 200, true);
        $otherOrgs = $this->row($b, 200, true);

        PruneNotificationsJob::prune($orgA->id);

        $this->assertDatabaseHas('notifications', ['id' => $otherOrgs]);
    }
}
