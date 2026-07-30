<?php

namespace Tests\Feature\Timer;

use App\Events\TimerStarted;
use App\Events\TimerStopped;
use App\Models\Organization;
use App\Models\Project;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Redis;
use Tests\TestCase;

class TimerTest extends TestCase
{
    private User $user;
    private Organization $org;

    protected function setUp(): void
    {
        parent::setUp();
        // Prevent Horizon's StoreJob listener from calling Redis::connection('horizon')
        // when TimerStarted/TimerStopped events are dispatched inside the service.
        Event::fake([TimerStarted::class, TimerStopped::class]);

        $this->org = Organization::factory()->create();
        $this->user = User::factory()->create([
            'organization_id' => $this->org->id,
            'role' => 'employee',
        ]);
        $this->actingAs($this->user, 'sanctum');
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

        $response = $this->postJson('/api/v1/timer/sessions/sync');
        $response->assertStatus(401);
    }

}
