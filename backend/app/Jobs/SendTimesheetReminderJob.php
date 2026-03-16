<?php

namespace App\Jobs;

use App\Models\Organization;
use App\Models\Timesheet;
use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class SendTimesheetReminderJob implements ShouldQueue, ShouldBeUnique
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public $tries = 3;
    public $timeout = 120;

    public function __construct(
        public string $organizationId,
        public string $weekStart
    ) {
        $this->onQueue('default');
    }

    /**
     * The unique ID of the job (org_id + week).
     */
    public function uniqueId(): string
    {
        return $this->organizationId . ':' . $this->weekStart;
    }

    public function handle(): void
    {
        $organization = Organization::findOrFail($this->organizationId);
        $weekStart = \Carbon\Carbon::parse($this->weekStart)->startOfWeek();
        $weekEnd = $weekStart->copy()->endOfWeek();

        // Find employees who haven't submitted timesheets for this week
        $employeesWithTimesheets = Timesheet::where('organization_id', $this->organizationId)
            ->where('period_start', $weekStart->toDateString())
            ->where('period_end', $weekEnd->toDateString())
            ->whereIn('status', ['submitted', 'approved'])
            ->pluck('user_id');

        $employeesWithoutTimesheets = User::where('organization_id', $this->organizationId)
            ->whereIn('role', ['employee', 'manager'])
            ->where('is_active', true)
            ->whereNotIn('id', $employeesWithTimesheets)
            ->get();

        foreach ($employeesWithoutTimesheets as $employee) {
            SendEmailNotificationJob::dispatch(
                $employee->email,
                "Reminder: Submit your timesheet for week of {$weekStart->format('M d, Y')}",
                'emails.timesheet-reminder',
                [
                    'employee_name' => $employee->name,
                    'week_start' => $weekStart->format('M d, Y'),
                    'week_end' => $weekEnd->format('M d, Y'),
                    'organization_name' => $organization->name,
                ]
            );
        }
    }

    public function backoff(): array
    {
        return [60, 300, 900];
    }

    public function failed(\Throwable $exception): void
    {
        \Illuminate\Support\Facades\Log::critical("SendTimesheetReminderJob failed for org {$this->organizationId}", [
            'error' => $exception->getMessage(),
        ]);
    }
}
