<?php

namespace App\Console\Commands;

use App\Models\DatabaseNotification;
use App\Models\LeaveRequest;
use App\Models\LeaveType;
use App\Models\Organization;
use App\Models\Payslip;
use App\Models\PublicHoliday;
use App\Models\Shift;
use App\Models\TimeEntry;
use App\Models\User;
use App\Notifications\HolidayAnnounced;
use App\Notifications\LeaveResolved;
use App\Notifications\OrgActivity;
use App\Notifications\PayslipSent;
use App\Notifications\ShiftAssigned;
use App\Notifications\ShiftTimingUpdated;
use App\Notifications\TimeEntryResolved;
use App\Notifications\TrackflowNotification;
use App\Services\NotificationRecipients;
use App\Support\NotificationPreferences;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Fill the bell with a realistic per-role set of notifications, for testing.
 *
 * Rows are written DIRECTLY rather than through Notification::send(), for three
 * reasons that all matter for a fixture:
 *
 *  - no queue, so the rows exist the moment the command returns rather than
 *    whenever Horizon gets to them;
 *  - no mail, so seeding can never email a real person their demo payslip;
 *  - no broadcast, so a websocket outage cannot fail the seed.
 *
 * The PAYLOAD still comes from the real notification classes, so what lands
 * here is exactly what production writes. A fixture that invents its own shape
 * is a fixture that quietly stops matching.
 *
 * Who receives what is resolved through NotificationRecipients — the same call
 * the live triggers make. So this doubles as a check on the permission wiring:
 * if finance ever starts appearing in the org-activity list, the seed shows it.
 *
 * Local and testing only.
 */
class SeedDemoNotifications extends Command
{
    protected $signature = 'notifications:seed-demo
        {--org= : Organization id. Defaults to the only one, or asks.}
        {--clear : Remove every notification first.}
        {--clear-only : Remove them and stop.}';

    protected $description = 'Create a realistic per-role set of notifications for testing the bell (local only).';

    public function handle(): int
    {
        if (! app()->environment(['local', 'testing'])) {
            $this->error('This command writes fixture data and only runs on local or testing.');

            return self::FAILURE;
        }

        if ($this->option('clear') || $this->option('clear-only')) {
            $removed = DB::table('notifications')->delete();
            $this->line("Removed {$removed} notification(s).");

            if ($this->option('clear-only')) {
                return self::SUCCESS;
            }
        }

        $org = $this->resolveOrganization();

        if (! $org) {
            return self::FAILURE;
        }

        $staff = User::withoutGlobalScopes()
            ->where('organization_id', $org->id)
            ->where('is_active', true)
            ->whereNull('deleted_at')
            ->orderBy('name')
            ->get();

        if ($staff->isEmpty()) {
            $this->error('That organization has no active users.');

            return self::FAILURE;
        }

        $written = $this->seed($org, $staff);

        $this->newLine();
        $this->info("Wrote {$written} notifications for {$org->name}.");
        $this->newLine();
        $this->table(
            ['User', 'Role', 'Total', 'Unread'],
            $staff->map(fn (User $u) => [
                $u->name,
                $u->role,
                DB::table('notifications')->where('notifiable_id', $u->id)->count(),
                DB::table('notifications')->where('notifiable_id', $u->id)->whereNull('read_at')->count(),
            ])->all(),
        );

        return self::SUCCESS;
    }

    /**
     * Write both streams and return how many rows landed.
     */
    private function seed(Organization $org, $staff): int
    {
        $watchers = app(NotificationRecipients::class)->orgActivityWatchers($org->id);
        $employee = $staff->firstWhere('role', 'employee') ?? $staff->first();
        $hr = $staff->firstWhere('role', 'hr_manager');
        $finance = $staff->firstWhere('role', 'finance_manager');
        $actor = $hr?->name ?? 'HR';
        $payroller = $finance?->name ?? 'Finance';
        $currency = $org->getSetting('currency') ?: 'PKR';

        $written = 0;

        // ── Org activity: owner + HR only ─────────────────────────────
        //
        // Ages are deliberately spread across hours and days. A bell whose rows
        // all share one timestamp cannot show whether "3h ago" reads correctly,
        // or whether the unread rule survives a mix.
        $stream = [
            [OrgActivity::checkedIn($employee->name, '09:04 AM', false, 0), 25, true],
            [OrgActivity::checkedIn('Carol QA', '11:52 AM', true, 22), 180, true],
            [OrgActivity::checkedOut($employee->name, '06:12 PM', '8h 40m', false, 0), 15, false],
            [OrgActivity::checkedOut('Bob Designer', '04:20 PM', '5h 05m', true, 130), 95, false],
            [OrgActivity::leaveApplied('Dave Backend', 'Annual Leave', '22-24 Sep 2026', 3.0), 240, false],
            [OrgActivity::timeEntryResolved('Carol QA', $actor, true, '2h 30m', '09 Sep 2026'), 400, true],
            [OrgActivity::timeEntryResolved('Bob Designer', $actor, false, '6h 00m', '08 Sep 2026', 'Logged against the wrong project.'), 1450, true],
            [OrgActivity::employeeAdded('Sana Iqbal', 'sana.iqbal@example.com', 'employee'), 1500, false],
            [OrgActivity::departmentCreated('Customer Success', $actor, 'Operations'), 2900, true],
            [OrgActivity::jobPosted('Senior Backend Engineer', $actor, 'Engineering', 'published'), 3100, false],
            [OrgActivity::shiftAssigned('Evening Shift', '16:00-01:00', 'Dave Backend, Carol QA', '15 Sep 2026'), 4400, true],
            [OrgActivity::payrollRun('September 2026', $payroller, 8, "{$currency} 1,525,000"), 5800, false],
            [OrgActivity::payslipReleased($employee->name, 'September 2026', $payroller), 5700, false],
            [OrgActivity::payrollCompleted('September 2026', $payroller, "{$currency} 1,376,500", 8, 'paid'), 5600, true],
        ];

        foreach ($watchers as $watcher) {
            foreach ($stream as [$notification, $minutesAgo, $read]) {
                $this->store($watcher, $notification, $minutesAgo, $read);
                $written++;
            }
        }

        // ── Personal: everyone, about themselves ──────────────────────
        //
        // Addressed rather than permissioned, which is why finance and the org
        // manager get these too: you cannot be excluded from something sent to
        // you. Seeding it for every user keeps that visible while testing.
        // The REAL personal classes, fed unsaved models. An earlier version of
        // this fixture used look-alike factories that copied each class's
        // wording, which meant the seed and production could quietly say
        // different things. Unsaved models are enough: every one of these
        // classes only reads attributes, and none touches the database.
        $holiday = new PublicHoliday(['name' => 'Independence Day', 'date' => now()->next('Monday')->toDateString(), 'is_optional' => false]);
        $leaveType = new LeaveType(['name' => 'Annual Leave']);
        $leave = (new LeaveRequest([
            'start_date' => now()->addDays(7)->toDateString(),
            'end_date' => now()->addDays(8)->toDateString(),
            'days_count' => 2,
        ]))->setRelation('leaveType', $leaveType);
        $shift = new Shift(['name' => 'Morning Shift', 'start_time' => '10:15:00', 'end_time' => '19:15:00']);
        $payslip = new Payslip;
        $entry = new TimeEntry(['duration_seconds' => 9000, 'started_at' => now()->subDays(2)]);

        foreach ($staff as $person) {
            $personal = [
                [new HolidayAnnounced($holiday), 60, false],
                [new LeaveResolved($leave, true), 320, false],
                [new TimeEntryResolved($entry, false, $actor, 'Logged against the wrong project.'), 700, false],
                [new ShiftAssigned($shift, now()->toDateString()), 1500, true],
                [new ShiftTimingUpdated($shift, ['start_time' => ['from' => '09:00:00', 'to' => '10:15:00'], 'end_time' => ['from' => '18:00:00', 'to' => '19:15:00']]), 1600, true],
                [new PayslipSent($payslip, 'September 2026'), 5650, false],
            ];

            foreach ($personal as [$notification, $minutesAgo, $read]) {
                $this->store($person, $notification, $minutesAgo, $read);
                $written++;
            }
        }

        return $written;
    }

    /**
     * Write one row, backdated, using the notification's own payload.
     *
     * The id is generated here because nothing has assigned one — a real send
     * gets it from the framework, and the primary key is NOT NULL.
     */
    private function store(User $user, TrackflowNotification $notification, int $minutesAgo, bool $read): void
    {
        // Rows are written directly, so via() never runs — honour mutes here
        // too, or the demo would show a category the person has turned off and
        // make the preference look broken.
        if (NotificationPreferences::isMuted($user, $notification->category())) {
            return;
        }

        $at = Carbon::now()->subMinutes($minutesAgo);

        DatabaseNotification::create([
            'id' => (string) Str::uuid(),
            'type' => $notification->category(),
            'notifiable_type' => User::class,
            'notifiable_id' => $user->id,
            'organization_id' => $user->organization_id,
            'data' => $notification->toArray($user),
            // Read a little AFTER it arrived, never before. A read_at earlier
            // than created_at is the sort of nonsense a fixture quietly teaches
            // you to expect.
            'read_at' => $read ? $at->copy()->addMinutes(3) : null,
            'created_at' => $at,
            'updated_at' => $at,
        ]);
    }

    private function resolveOrganization(): ?Organization
    {
        if ($id = $this->option('org')) {
            $org = Organization::withoutGlobalScopes()->find($id);

            if (! $org) {
                $this->error("No organization with id {$id}.");
            }

            return $org;
        }

        $orgs = Organization::withoutGlobalScopes()->orderBy('name')->get();

        if ($orgs->isEmpty()) {
            $this->error('No organizations found.');

            return null;
        }

        if ($orgs->count() === 1) {
            return $orgs->first();
        }

        $name = $this->choice('Which organization?', $orgs->pluck('name')->all());

        return $orgs->firstWhere('name', $name);
    }
}
