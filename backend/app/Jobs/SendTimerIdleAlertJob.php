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
use Illuminate\Support\Facades\Log;
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
        $organization = Organization::query()
            ->select(['id', 'settings'])
            ->findOrFail($this->organizationId);

        $idleTimeout = (int) $organization->getSetting('idle_timeout', 5);
        if ($idleTimeout <= 0) {
            // idle_timeout=0 disables idle detection; don't broadcast or email.
            return;
        }

        $emailEnabled = (bool) $organization->getSetting('idle_alert_email_enabled', false);
        $cooldownMinRaw = (int) $organization->getSetting('idle_alert_email_cooldown_min', 60);
        // Defensive clamps even if settings were inserted outside the API.
        $cooldownMin = max(5, min(1440, $cooldownMinRaw));
        $cooldownSeconds = $cooldownMin * 60;

        $threshold = now()->subMinutes($idleTimeout);

        // Find employees with active timers who have gone idle
        $managers = null;
        if ($emailEnabled) {
            $managers = User::query()
                ->select(['id', 'name', 'email', 'organization_id', 'role', 'is_active'])
                ->where('organization_id', $this->organizationId)
                ->whereIn('role', ['owner', 'admin', 'manager'])
                ->where('is_active', true)
                ->get();
        }

        User::query()
            ->select(['id', 'name', 'last_active_at', 'organization_id', 'role', 'is_active'])
            ->where('organization_id', $this->organizationId)
            ->where('role', 'employee')
            ->where('is_active', true)
            ->orderBy('id')
            ->chunkById(500, function ($employees) use ($threshold, $idleTimeout, $emailEnabled, $cooldownSeconds, $managers) {
                foreach ($employees as $employee) {
                    $timerRedisKey = "timer:{$employee->id}";
                    $hasActiveTimer = (bool) Redis::exists($timerRedisKey);

                    if (!$hasActiveTimer) {
                        continue;
                    }

                    if (!$employee->last_active_at || !$employee->last_active_at->lt($threshold)) {
                        continue;
                    }

                    $idleSince = $employee->last_active_at->toISOString();

                    // Keep existing behavior: broadcast idle event regardless of email setting.
                    EmployeeIdle::dispatch($employee, $idleSince);

                    if (!$emailEnabled || !$managers || $managers->isEmpty()) {
                        continue;
                    }

                    $cooldownKey = "idle_alert_email_sent:{$employee->organization_id}:{$employee->id}";
                    // Atomic set-if-not-exists + expiry to prevent spamming on 5-min schedule.
                    $lock = Redis::set($cooldownKey, '1', 'EX', $cooldownSeconds, 'NX');
                    if ($lock !== 'OK') {
                        continue;
                    }

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
            });
    }

    public function backoff(): array
    {
        return [60, 300, 900];
    }

    public function failed(\Throwable $exception): void
    {
        Log::critical("SendTimerIdleAlertJob failed for org {$this->organizationId}", [
            'error' => $exception->getMessage(),
        ]);
    }
}
