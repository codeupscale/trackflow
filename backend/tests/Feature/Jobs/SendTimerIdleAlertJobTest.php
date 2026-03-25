<?php

namespace Tests\Feature\Jobs;

use App\Jobs\SendEmailNotificationJob;
use App\Jobs\SendTimerIdleAlertJob;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Redis;
use Tests\TestCase;

class SendTimerIdleAlertJobTest extends TestCase
{
    public function test_disabled_does_not_dispatch_email_job(): void
    {
        Bus::fake([SendEmailNotificationJob::class]);

        $org = $this->createOrganization([
            'settings' => [
                'idle_timeout' => 5,
                'idle_alert_email_enabled' => false,
                'idle_alert_email_cooldown_min' => 60,
            ],
        ]);

        $this->createUser($org, 'owner', ['is_active' => true]);
        $employee = $this->createUser($org, 'employee', [
            'is_active' => true,
            'last_active_at' => now()->subMinutes(10),
        ]);

        Redis::shouldReceive('exists')
            ->once()
            ->with("timer:{$employee->id}")
            ->andReturn(true);
        Redis::shouldReceive('set')->never();

        (new SendTimerIdleAlertJob($org->id))->handle();

        Bus::assertNotDispatched(SendEmailNotificationJob::class);
    }

    public function test_enabled_throttles_per_employee_per_cooldown(): void
    {
        Bus::fake([SendEmailNotificationJob::class]);

        $org = $this->createOrganization([
            'settings' => [
                'idle_timeout' => 5,
                'idle_alert_email_enabled' => true,
                'idle_alert_email_cooldown_min' => 60,
            ],
        ]);

        $manager = $this->createUser($org, 'owner', ['is_active' => true]);
        $employee = $this->createUser($org, 'employee', [
            'is_active' => true,
            'last_active_at' => now()->subMinutes(10),
        ]);

        Redis::shouldReceive('exists')->twice()->andReturn(true);
        Redis::shouldReceive('set')
            ->twice()
            ->with("idle_alert_email_sent:{$org->id}:{$employee->id}", '1', 'EX', 3600, 'NX')
            ->andReturn('OK', null);

        $job = new SendTimerIdleAlertJob($org->id);
        $job->handle();
        $job->handle();

        Bus::assertDispatchedTimes(SendEmailNotificationJob::class, 1);
        Bus::assertDispatched(SendEmailNotificationJob::class, function (SendEmailNotificationJob $job) use ($manager) {
            return $job->to === $manager->email;
        });
    }

    public function test_cooldown_keys_include_organization_id(): void
    {
        Bus::fake([SendEmailNotificationJob::class]);

        $orgA = $this->createOrganization([
            'settings' => [
                'idle_timeout' => 5,
                'idle_alert_email_enabled' => true,
                'idle_alert_email_cooldown_min' => 60,
            ],
        ]);
        $orgB = $this->createOrganization([
            'settings' => [
                'idle_timeout' => 5,
                'idle_alert_email_enabled' => true,
                'idle_alert_email_cooldown_min' => 60,
            ],
        ]);

        $this->createUser($orgA, 'owner', ['is_active' => true]);
        $this->createUser($orgB, 'owner', ['is_active' => true]);

        $employeeA = $this->createUser($orgA, 'employee', [
            'is_active' => true,
            'last_active_at' => now()->subMinutes(10),
        ]);
        $employeeB = $this->createUser($orgB, 'employee', [
            'is_active' => true,
            'last_active_at' => now()->subMinutes(10),
        ]);

        Redis::shouldReceive('exists')->times(2)->andReturn(true);
        Redis::shouldReceive('set')
            ->times(2)
            ->withArgs(function (...$args) use ($orgA, $orgB, $employeeA, $employeeB) {
                [$key] = $args;
                $expectedA = "idle_alert_email_sent:{$orgA->id}:{$employeeA->id}";
                $expectedB = "idle_alert_email_sent:{$orgB->id}:{$employeeB->id}";
                return $key === $expectedA || $key === $expectedB;
            })
            ->andReturn('OK');

        (new SendTimerIdleAlertJob($orgA->id))->handle();
        (new SendTimerIdleAlertJob($orgB->id))->handle();
    }
}

