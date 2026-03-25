<?php

namespace Tests\Feature\IdleAlert;

use App\Jobs\SendEmailNotificationJob;
use App\Jobs\SendTimerIdleAlertJob;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Redis;
use Tests\TestCase;

class IdleAlertEmailConfigTest extends TestCase
{
    public function test_idle_alert_emails_are_off_by_default_when_setting_missing(): void
    {
        $this->markTestIncomplete('Backend idle alert email configurability not implemented yet (expected: OFF by default when key missing).');

        $org = Organization::factory()->create([
            'settings' => array_merge((new Organization())->getDefaultSettings(), [
                'idle_timeout' => 5,
            ]),
        ]);

        $employee = User::factory()->employee()->create([
            'organization_id' => $org->id,
            'last_active_at' => Carbon::now()->subMinutes(10),
        ]);

        User::factory()->manager()->create(['organization_id' => $org->id]);

        Queue::fake();
        Redis::shouldReceive('get')
            ->with("timer:{$employee->id}")
            ->andReturn(json_encode(['time_entry_id' => (string) \Str::uuid()]));

        SendTimerIdleAlertJob::dispatchSync($org->id);

        Queue::assertNotPushed(SendEmailNotificationJob::class);
    }

    public function test_idle_alert_emails_only_go_to_owner_admin_manager(): void
    {
        $this->markTestIncomplete('Backend idle alert email configurability not implemented yet (expected: only owner/admin/manager recipients).');

        $org = Organization::factory()->create([
            'settings' => [
                'idle_timeout' => 5,
                'idle_alert_email_enabled' => true,
                'idle_alert_email_cooldown_min' => 60,
            ],
        ]);

        $employee = User::factory()->employee()->create([
            'organization_id' => $org->id,
            'last_active_at' => Carbon::now()->subMinutes(10),
        ]);

        $owner = User::factory()->owner()->create(['organization_id' => $org->id]);
        $admin = User::factory()->admin()->create(['organization_id' => $org->id]);
        $manager = User::factory()->manager()->create(['organization_id' => $org->id]);
        $otherEmployee = User::factory()->employee()->create(['organization_id' => $org->id]);

        Queue::fake();
        Redis::shouldReceive('get')
            ->with("timer:{$employee->id}")
            ->andReturn(json_encode(['time_entry_id' => (string) \Str::uuid()]));
        Redis::shouldReceive('get')
            ->with("timer:{$otherEmployee->id}")
            ->andReturn(null);

        SendTimerIdleAlertJob::dispatchSync($org->id);

        Queue::assertPushed(SendEmailNotificationJob::class, fn (SendEmailNotificationJob $job) => $job->to === $owner->email);
        Queue::assertPushed(SendEmailNotificationJob::class, fn (SendEmailNotificationJob $job) => $job->to === $admin->email);
        Queue::assertPushed(SendEmailNotificationJob::class, fn (SendEmailNotificationJob $job) => $job->to === $manager->email);
        Queue::assertNotPushed(SendEmailNotificationJob::class, fn (SendEmailNotificationJob $job) => $job->to === $otherEmployee->email);
    }

    public function test_cooldown_prevents_repeated_emails_across_job_runs(): void
    {
        $this->markTestIncomplete('Backend cooldown not implemented yet (expected: no repeat emails within cooldown).');

        $org = Organization::factory()->create([
            'settings' => [
                'idle_timeout' => 5,
                'idle_alert_email_enabled' => true,
                'idle_alert_email_cooldown_min' => 60,
            ],
        ]);

        $employee = User::factory()->employee()->create([
            'organization_id' => $org->id,
            'last_active_at' => Carbon::now()->subMinutes(10),
        ]);
        User::factory()->manager()->create(['organization_id' => $org->id]);

        Queue::fake();

        Redis::shouldReceive('get')->with("timer:{$employee->id}")->andReturn(json_encode(['time_entry_id' => (string) \Str::uuid()]));
        Redis::shouldReceive('get')->with("idle-alert-email:{$org->id}:{$employee->id}")->andReturn(null, Carbon::now()->toISOString());
        Redis::shouldReceive('setex')->withArgs(function (string $key, int $ttl, string $value) use ($org, $employee) {
            return $key === "idle-alert-email:{$org->id}:{$employee->id}" && $ttl > 300 && $value !== '';
        })->andReturn(true);

        SendTimerIdleAlertJob::dispatchSync($org->id);
        SendTimerIdleAlertJob::dispatchSync($org->id);

        Queue::assertPushed(SendEmailNotificationJob::class, 1);
    }

    public function test_multi_org_isolation_no_cross_org_emails_or_cooldown_collisions(): void
    {
        $this->markTestIncomplete('Backend multi-org idle email isolation not implemented yet (expected: org-scoped recipients + org-scoped cooldown).');

        $orgA = Organization::factory()->create([
            'settings' => [
                'idle_timeout' => 5,
                'idle_alert_email_enabled' => true,
                'idle_alert_email_cooldown_min' => 60,
            ],
        ]);
        $orgB = Organization::factory()->create([
            'settings' => [
                'idle_timeout' => 5,
                'idle_alert_email_enabled' => true,
                'idle_alert_email_cooldown_min' => 60,
            ],
        ]);

        $employeeA = User::factory()->employee()->create([
            'organization_id' => $orgA->id,
            'last_active_at' => Carbon::now()->subMinutes(10),
        ]);
        $managerA = User::factory()->manager()->create(['organization_id' => $orgA->id]);

        $employeeB = User::factory()->employee()->create([
            'organization_id' => $orgB->id,
            'last_active_at' => Carbon::now()->subMinutes(10),
        ]);
        $managerB = User::factory()->manager()->create(['organization_id' => $orgB->id]);

        Queue::fake();

        Redis::shouldReceive('get')->with("timer:{$employeeA->id}")->andReturn(json_encode(['time_entry_id' => (string) \Str::uuid()]));
        Redis::shouldReceive('get')->with("timer:{$employeeB->id}")->andReturn(json_encode(['time_entry_id' => (string) \Str::uuid()]));

        SendTimerIdleAlertJob::dispatchSync($orgA->id);

        Queue::assertPushed(SendEmailNotificationJob::class, fn (SendEmailNotificationJob $job) => $job->to === $managerA->email);
        Queue::assertNotPushed(SendEmailNotificationJob::class, fn (SendEmailNotificationJob $job) => $job->to === $managerB->email);
    }
}

