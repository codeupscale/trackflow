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
        // TimerService::start():
        //   set(lockKey, 1, 'EX', 5, 'NX') -> acquire lock
        //   get(redisKey) -> check for existing timer (duplicate guard)
        //   setex(redisKey, ...) -> store timer data
        //   del(lockKey) -> release lock (in finally)
        // Controller then calls todayTotal() which:
        //   get(redisKey) -> check if timer running for elapsed
        Redis::shouldReceive('set')->once()->andReturn(true);       // acquire lock
        Redis::shouldReceive('get')->twice()->andReturn(null, null); // duplicate guard + todayTotal()
        Redis::shouldReceive('setex')->once()->andReturn(true);     // store timer data
        Redis::shouldReceive('del')->once()->andReturn(1);          // release lock

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
        // TimerService::start() calls Redis::set(lockKey, 1, 'EX', 5, 'NX') which returns false
        // The throw happens BEFORE the try/finally block, so no del() call occurs
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
        // stop():
        //   get(redisKey) -> read timer data
        //   set(lockKey, 1, 'EX', 5, 'NX') -> acquire lock
        //   del(redisKey) -> clear timer (inside txn)
        //   del(lockKey) -> release lock (finally)
        // Controller then calls todayTotal():
        //   get(redisKey) -> check if timer running (returns null since we deleted it)
        Redis::shouldReceive('get')->twice()->andReturn($timerPayload, null);
        Redis::shouldReceive('set')->once()->andReturn(true);    // acquire lock
        Redis::shouldReceive('del')->twice()->andReturn(1);      // del(redisKey) + del(lockKey)

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

    public function test_employee_cannot_start_timer_on_unassigned_project(): void
    {
        $project = Project::factory()->create([
            'organization_id' => $this->org->id,
            'created_by' => $this->user->id,
        ]);
        // Do not assign $this->user to the project

        $response = $this->postJson('/api/v1/timer/start', [
            'project_id' => $project->id,
        ]);
        $response->assertStatus(403)
            ->assertJsonFragment(['message' => 'You are not assigned to this project.']);
    }

    public function test_employee_can_start_timer_on_assigned_project(): void
    {
        $project = Project::factory()->create([
            'organization_id' => $this->org->id,
            'created_by' => $this->user->id,
        ]);
        $project->members()->attach($this->user->id);

        Redis::shouldReceive('set')->once()->andReturn(true);       // acquire lock
        Redis::shouldReceive('get')->twice()->andReturn(null, null); // duplicate guard + todayTotal()
        Redis::shouldReceive('setex')->once()->andReturn(true);     // store timer data
        Redis::shouldReceive('del')->once()->andReturn(1);          // release lock

        $response = $this->postJson('/api/v1/timer/start', [
            'project_id' => $project->id,
        ]);
        $response->assertStatus(201);
        $this->assertDatabaseHas('time_entries', [
            'user_id' => $this->user->id,
            'project_id' => $project->id,
            'type' => 'tracked',
        ]);
    }
}
