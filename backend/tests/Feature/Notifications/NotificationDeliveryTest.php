<?php

namespace Tests\Feature\Notifications;

use App\Models\Department;
use App\Models\LeaveBalance;
use App\Models\LeaveRequest;
use App\Models\LeaveType;
use App\Models\Organization;
use App\Models\Shift;
use App\Models\TimeEntry;
use App\Models\User;
use App\Notifications\HolidayAnnounced;
use App\Notifications\LeaveResolved;
use App\Notifications\OrgActivity;
use App\Notifications\ShiftAssigned;
use App\Notifications\ShiftTimingUpdated;
use App\Notifications\TimeEntryResolved;
use App\Services\CheckInService;
use App\Services\JobPostingService;
use App\Services\LeaveService;
use App\Services\ManualTimeEntryService;
use App\Services\NotificationRecipients;
use App\Services\OrganizationStructureService;
use App\Services\ShiftService;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * WHO is told about WHAT.
 *
 * Every trigger here runs through its real service method with notifications
 * faked, so the assertions are about recipients and categories rather than
 * about the queue. The two rules that must hold everywhere:
 *
 *  - the organisation-activity stream reaches owner and HR, and nobody else;
 *  - nobody is ever notified about their own action.
 */
class NotificationDeliveryTest extends TestCase
{
    private Organization $org;

    private User $owner;

    private User $hr;

    private User $manager;

    private User $finance;

    private User $alice;

    private User $bob;

    protected function setUp(): void
    {
        parent::setUp();

        Notification::fake();

        $this->org = $this->createOrganization();
        $this->owner = $this->createUser($this->org, 'owner');
        $this->hr = $this->createUser($this->org, 'hr_manager');
        $this->manager = $this->createUser($this->org, 'org_manager');
        $this->finance = $this->createUser($this->org, 'finance_manager');
        $this->alice = $this->createUser($this->org, 'employee');
        $this->bob = $this->createUser($this->org, 'employee');
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function orgActivity(string $category): \Closure
    {
        return fn ($n) => $n instanceof OrgActivity && $n->category() === $category;
    }

    /** Assert an org-activity category reached exactly $expected. */
    private function assertOrgAudience(string $category, array $expected): void
    {
        foreach ([$this->owner, $this->hr, $this->manager, $this->finance, $this->alice, $this->bob] as $user) {
            if (in_array($user, $expected, true)) {
                Notification::assertSentTo($user, OrgActivity::class, $this->orgActivity($category));
            } else {
                Notification::assertNotSentTo($user, OrgActivity::class, $this->orgActivity($category));
            }
        }
    }

    // ── The audience rule ──────────────────────────────────────────────

    public function test_org_activity_audience_is_owner_and_hr_only(): void
    {
        $ids = app(NotificationRecipients::class)->orgActivityWatchers($this->org->id)->pluck('id')->sort()->values()->all();

        $this->assertSame(collect([$this->owner->id, $this->hr->id])->sort()->values()->all(), $ids);
    }

    public function test_the_actor_is_excluded_from_the_audience(): void
    {
        $ids = app(NotificationRecipients::class)->orgActivityWatchers($this->org->id, $this->hr->id)->pluck('id')->all();

        $this->assertSame([$this->owner->id], $ids);
    }

    // ── Attendance ─────────────────────────────────────────────────────

    public function test_check_in_and_out_reach_owner_and_hr_but_never_the_employee(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-03-16 07:00:00', 'UTC')); // 12:00 Karachi, a Monday

        app(CheckInService::class)->checkIn($this->alice);
        Carbon::setTestNow(Carbon::parse('2026-03-16 15:00:00', 'UTC'));
        app(CheckInService::class)->checkOut($this->alice);

        $this->assertOrgAudience('attendance.checked_in', [$this->owner, $this->hr]);
        $this->assertOrgAudience('attendance.checked_out', [$this->owner, $this->hr]);
    }

    public function test_hr_checking_in_tells_the_owner_but_not_hr(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-03-16 07:00:00', 'UTC'));

        app(CheckInService::class)->checkIn($this->hr);

        $this->assertOrgAudience('attendance.checked_in', [$this->owner]);
    }

    public function test_a_second_check_in_is_announced_as_a_return_not_as_late(): void
    {
        // Regression: the day record keeps session 1's lateness, and the old
        // check-in notification read it for every session — so someone back
        // from lunch at 14:00 was announced as "checked in, N minutes late".
        Carbon::setTestNow(Carbon::parse('2026-03-16 08:00:00', 'UTC')); // 13:00 Karachi — late
        app(CheckInService::class)->checkIn($this->alice);
        Carbon::setTestNow(Carbon::parse('2026-03-16 08:30:00', 'UTC'));
        app(CheckInService::class)->checkOut($this->alice);
        Carbon::setTestNow(Carbon::parse('2026-03-16 09:30:00', 'UTC')); // back from lunch
        app(CheckInService::class)->checkIn($this->alice);

        Notification::assertSentTo($this->owner, OrgActivity::class, fn ($n) => $n->category() === 'attendance.checked_in'
            && str_contains($n->title($this->owner), 'checked in late'));
        Notification::assertSentTo($this->owner, OrgActivity::class, fn ($n) => $n->category() === 'attendance.checked_in'
            && str_contains($n->title($this->owner), 'is back')
            && ! str_contains($n->body($this->owner), 'late'));
    }

    // ── Leave ──────────────────────────────────────────────────────────

    private function leaveFor(User $user, string $status = 'pending'): LeaveRequest
    {
        $type = LeaveType::create(['organization_id' => $this->org->id, 'name' => 'Annual', 'code' => 'AL' . substr($user->id, 0, 4), 'days_per_year' => 20, 'is_paid' => true, 'requires_approval' => true, 'is_active' => true]);
        LeaveBalance::create(['organization_id' => $this->org->id, 'user_id' => $user->id, 'leave_type_id' => $type->id, 'year' => 2026, 'total_days' => 20, 'used_days' => 0, 'pending_days' => 1, 'carried_over_days' => 0]);

        return LeaveRequest::create(['organization_id' => $this->org->id, 'user_id' => $user->id, 'leave_type_id' => $type->id, 'start_date' => '2026-03-23', 'end_date' => '2026-03-23', 'days_count' => 1, 'reason' => 'test', 'status' => $status]);
    }

    public function test_approved_leave_reaches_only_the_requester(): void
    {
        $leave = $this->leaveFor($this->alice);

        app(LeaveService::class)->approveLeave($leave, $this->hr);

        Notification::assertSentTo($this->alice, LeaveResolved::class, fn ($n) => $n->category() === 'leave.approved');
        foreach ([$this->owner, $this->hr, $this->finance, $this->bob] as $other) {
            Notification::assertNotSentTo($other, LeaveResolved::class);
        }
    }

    public function test_rejected_leave_carries_the_reason(): void
    {
        $leave = $this->leaveFor($this->bob);

        app(LeaveService::class)->rejectLeave($leave, $this->hr, 'Team is short that day.');

        Notification::assertSentTo($this->bob, LeaveResolved::class, fn ($n) => $n->category() === 'leave.rejected'
            && str_contains($n->body($this->bob), 'Team is short that day.'));
    }

    // ── Time entries ───────────────────────────────────────────────────

    private function pendingEntryFor(User $user): TimeEntry
    {
        return TimeEntry::create(['organization_id' => $this->org->id, 'user_id' => $user->id, 'type' => 'manual', 'approval_status' => 'pending', 'is_approved' => false, 'submitted_by' => $user->id, 'started_at' => now()->subHours(3), 'ended_at' => now()->subHour(), 'duration_seconds' => 7200, 'description' => 'test']);
    }

    public function test_a_time_entry_decision_reaches_its_owner_and_the_org_audience(): void
    {
        $entry = $this->pendingEntryFor($this->alice);

        app(ManualTimeEntryService::class)->approve($this->hr, $entry->id);

        Notification::assertSentTo($this->alice, TimeEntryResolved::class, fn ($n) => $n->category() === 'time_entry.approved');
        $this->assertOrgAudience('time_entry.approved', [$this->owner]);
    }

    public function test_a_rejected_time_entry_tells_the_employee_why(): void
    {
        $entry = $this->pendingEntryFor($this->bob);

        app(ManualTimeEntryService::class)->reject($this->hr, $entry->id, 'Wrong project.');

        Notification::assertSentTo($this->bob, TimeEntryResolved::class, fn ($n) => str_contains($n->body($this->bob), 'Wrong project.'));
    }

    // ── Shifts ─────────────────────────────────────────────────────────

    private function shift(): Shift
    {
        return Shift::create(['organization_id' => $this->org->id, 'name' => 'Morning', 'start_time' => '09:00:00', 'end_time' => '18:00:00', 'timezone' => 'Asia/Karachi', 'grace_period_minutes' => 15, 'break_minutes' => 60, 'is_active' => true, 'days_of_week' => [1, 2, 3, 4, 5]]);
    }

    public function test_assigning_a_shift_tells_the_assignee_and_the_org_audience(): void
    {
        $this->actingAs($this->hr, 'sanctum');
        $shift = $this->shift();

        app(ShiftService::class)->assignUser($this->org->id, $this->alice->id, $shift->id, now()->toDateString(), null);

        Notification::assertSentTo($this->alice, ShiftAssigned::class);
        Notification::assertNotSentTo($this->bob, ShiftAssigned::class);
        $this->assertOrgAudience('shift.assigned', [$this->owner]);
    }

    public function test_a_bulk_assign_is_one_org_notification_naming_everyone(): void
    {
        $this->actingAs($this->hr, 'sanctum');
        $shift = $this->shift();

        app(ShiftService::class)->bulkAssign($this->org->id, $shift->id, [$this->alice->id, $this->bob->id], now()->toDateString(), null);

        Notification::assertSentToTimes($this->owner, OrgActivity::class, 1);
        Notification::assertSentTo($this->owner, OrgActivity::class, fn ($n) => str_contains($n->body($this->owner), $this->alice->name)
            && str_contains($n->body($this->owner), $this->bob->name));
        Notification::assertSentTo($this->alice, ShiftAssigned::class);
        Notification::assertSentTo($this->bob, ShiftAssigned::class);
    }

    public function test_renaming_a_shift_does_not_notify_but_changing_its_hours_does(): void
    {
        $shift = $this->shift();
        DB::table('user_shifts')->insert(['id' => (string) Str::uuid(), 'organization_id' => $this->org->id, 'user_id' => $this->alice->id, 'shift_id' => $shift->id, 'effective_from' => now()->subDay()->toDateString(), 'effective_to' => null, 'created_at' => now(), 'updated_at' => now()]);

        app(ShiftService::class)->updateShift($shift, ['name' => 'Renamed', 'color' => '#ff0000']);
        Notification::assertNothingSentTo($this->alice);

        app(ShiftService::class)->updateShift($shift->fresh(), ['start_time' => '10:00:00']);
        Notification::assertSentTo($this->alice, ShiftTimingUpdated::class, fn ($n) => str_contains($n->body($this->alice), 'was 09:00'));
    }

    // ── Structure and hiring ───────────────────────────────────────────

    public function test_creating_a_department_tells_hr_when_the_owner_acts(): void
    {
        $this->actingAs($this->owner, 'sanctum');

        app(OrganizationStructureService::class)->createDepartment($this->org, ['name' => 'Ops', 'code' => 'OPS']);

        $this->assertOrgAudience('department.created', [$this->hr]);
    }

    public function test_posting_a_job_links_to_the_real_job_postings_page(): void
    {
        $this->actingAs($this->owner, 'sanctum');
        $dept = Department::create(['organization_id' => $this->org->id, 'name' => 'Engineering', 'code' => 'ENG', 'is_active' => true]);

        app(JobPostingService::class)->create($this->org, ['title' => 'Engineer', 'department_id' => $dept->id, 'employment_type' => 'full_time', 'work_mode' => 'remote', 'location' => 'Remote', 'posting_date' => now()->toDateString()]);

        Notification::assertSentTo($this->hr, OrgActivity::class, fn ($n) => $n->category() === 'job_posting.created'
            && $n->url($this->hr) === '/hr/job-postings');
    }

    // ── Joiners ────────────────────────────────────────────────────────

    public function test_accepting_an_invitation_announces_the_joiner_to_owner_and_hr(): void
    {
        // Six members already exceed the 5-seat trial, and the seat check would
        // refuse the join (402) before any notification could fire.
        $this->org->update(['plan' => 'pro']);

        $token = Str::random(40);
        DB::table('invitations')->insert([
            'id' => (string) Str::uuid(),
            'organization_id' => $this->org->id,
            'email' => 'newcomer@example.test',
            'role' => 'employee',
            'token' => $token,
            'expires_at' => now()->addDays(3),
            'created_by' => $this->owner->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->postJson('/api/v1/invitations/accept', [
            'token' => $token,
            'name' => 'New Comer',
            'password' => 'a-good-password',
            'password_confirmation' => 'a-good-password',
        ])->assertSuccessful();

        $joiner = User::where('email', 'newcomer@example.test')->first();

        $this->assertOrgAudience('employee.added', [$this->owner, $this->hr]);
        Notification::assertNotSentTo($joiner, OrgActivity::class);
    }

    // ── Holidays ───────────────────────────────────────────────────────

    public function test_a_holiday_reaches_everyone_except_the_announcer(): void
    {
        $this->actingAs($this->owner, 'sanctum')
            ->postJson('/api/v1/hr/public-holidays', ['name' => 'Founders Day', 'date' => now()->addDays(30)->toDateString(), 'is_optional' => false])
            ->assertStatus(201);

        Notification::assertNotSentTo($this->owner, HolidayAnnounced::class);
        foreach ([$this->hr, $this->manager, $this->finance, $this->alice, $this->bob] as $user) {
            Notification::assertSentTo($user, HolidayAnnounced::class);
        }
    }
}
