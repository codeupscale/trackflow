<?php

namespace Tests\Feature\Timer;

use App\Models\Organization;
use App\Models\Project;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Support\Facades\Redis;
use Tests\TestCase;

class TimerTest extends TestCase
{
    private User $user;
    private Organization $org;

    protected function setUp(): void
    {
        parent::setUp();
        $this->org = Organization::factory()->create();
        $this->user = User::factory()->create([
            'organization_id' => $this->org->id,
            'role' => 'employee',
        ]);
        $this->actingAs($this->user, 'sanctum');
    }

    public function test_can_start_timer(): void
    {
        // TimerService::start(): set(lock), setex(timer), del(lock); then controller calls todayTotal() which calls get()
        Redis::shouldReceive('set')->once()->andReturn(true);     // acquire lock
        Redis::shouldReceive('setex')->once()->andReturn(true);   // store timer data
        Redis::shouldReceive('del')->once()->andReturn(1);        // release lock
        Redis::shouldReceive('get')->once()->andReturn(null);     // todayTotal() after start (no elapsed to add yet)

        $response = $this->postJson('/api/v1/timer/start');
        $response->assertStatus(201)
            ->assertJsonStructure(['entry' => ['id', 'started_at', 'type']]);

        $this->assertDatabaseHas('time_entries', [
            'user_id' => $this->user->id,
            'type' => 'tracked',
        ]);
    }

    public function test_cannot_start_timer_when_already_running(): void
    {
        // TimerService::start() calls Redis::set(lockKey, ..., 'NX') which returns false if lock exists
        Redis::shouldReceive('set')->once()->andReturn(false);

        $response = $this->postJson('/api/v1/timer/start');
        $response->assertStatus(409);
    }

    public function test_can_stop_timer(): void
    {
        $entry = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subMinutes(30),
            'ended_at' => null,
        ]);

        $timerPayload = json_encode([
            'entry_id' => $entry->id,
            'started_at' => $entry->started_at->toISOString(),
        ]);
        // stop() calls get() once; then controller calls todayTotal() which calls get() again
        Redis::shouldReceive('get')->twice()->andReturn($timerPayload, null);
        Redis::shouldReceive('del')->once()->andReturn(1);

        $response = $this->postJson('/api/v1/timer/stop');
        $response->assertOk()
            ->assertJsonStructure(['entry' => ['id', 'ended_at', 'duration_seconds']]);

        $entry->refresh();
        $this->assertNotNull($entry->ended_at);
        $this->assertGreaterThan(0, $entry->duration_seconds);
    }

    public function test_stop_fails_when_no_timer_running(): void
    {
        Redis::shouldReceive('get')->once()->andReturn(null);

        $response = $this->postJson('/api/v1/timer/stop');
        $response->assertStatus(404);
    }

    public function test_can_get_timer_status(): void
    {
        Redis::shouldReceive('get')->once()->andReturn(null);

        $response = $this->getJson('/api/v1/timer/status');
        $response->assertOk()
            ->assertJson(['running' => false]);
    }

    public function test_timer_requires_auth(): void
    {
        // Logout by creating a new instance
        $this->app['auth']->forgetGuards();

        $response = $this->postJson('/api/v1/timer/start');
        $response->assertStatus(401);
    }
}
