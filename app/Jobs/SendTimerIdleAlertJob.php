<?php

namespace App\Jobs;

use App\Events\EmployeeIdle;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Redis;

class SendTimerIdleAlertJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public $tries = 3;
    public $timeout = 60;

    public function __construct(
        public string $organizationId
    ) {
        $this->onQueue('high');
    }

    public function handle(): void
    {
        $organization = Organization::findOrFail($this->organizationId);
        $idleTimeout = $organization->getSetting('idle_timeout', 5);
        $threshold = now()->subMinutes($idleTimeout);

        // Find employees with active timers who have gone idle
        $activeEmployees = User::where('organization_id', $this->organizationId)
            ->where('role', 'employee')
            ->where('is_active', true)
            ->get();

        foreach ($activeEmployees as $employee) {
            $redisKey = "timer:{$employee->id}";
            $timerData = Redis::get($redisKey);

            if (!$timerData) {
                continue;
            }

            // Check if the employee's last activity is older than the idle timeout
            if ($employee->last_active_at && $employee->last_active_at->lt($threshold)) {
                $idleSince = $employee->last_active_at->toISOString();

                // Dispatch the EmployeeIdle broadcast event
                EmployeeIdle::dispatch($employee, $idleSince);

                // Send email alerts to managers and admins
                $managers = User::where('organization_id', $this->organizationId)
                    ->whereIn('role', ['owner', 'admin', 'manager'])
                    ->where('is_active', true)
                    ->get();

                foreach ($managers as $manager) {
                    SendEmailNotificationJob::dispatch(
                        $manager->email,
                        "Idle Alert: {$employee->name} has been idle",
                        'emails.idle-alert',
                        [
                            'manager_name' => $manager->name,
                            'employee_name' => $employee->name,
                            'idle_since' => $idleSince,
                            'idle_minutes' => $idleTimeout,
                        ]
                    );
                }
            }
        }
    }
}
