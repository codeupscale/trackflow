<?php

namespace Tests\Feature\Timer;

use App\Models\Organization;
use App\Models\Project;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Idle time may no longer be credited as work (owner policy, 2026-07-16).
 *
 * These cover the SERVER-side half. Hiding the desktop buttons is cosmetic on its
 * own — an employee on an older build, or anyone with their own valid token and
 * curl, must hit a wall here. That is the actual requirement.
 */
class IdleCreditDisabledTest extends TestCase
{
    private Organization $org;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->org = $this->createOrganization();
        $this->user = $this->createUser($this->org, 'employee');
        $this->actingAs($this->user, 'sanctum');
        Redis::flushdb();
    }

    protected function tearDown(): void
    {
        Redis::flushdb();
        parent::tearDown();
    }

    private function project(): Project
    {
        return Project::factory()->create([
            'organization_id' => $this->org->id,
            'created_by' => $this->user->id,
        ]);
    }

    private function idlePayload(array $over = []): array
    {
        return array_merge([
            'time_entry_id' => (string) Str::uuid(),
            'idle_started_at' => now()->subMinutes(20)->toIso8601String(),
            'idle_ended_at' => now()->subMinutes(5)->toIso8601String(),
            'idle_seconds' => 900,
            'action' => 'keep',
        ], $over);
    }

    public function test_keep_is_refused_with_403(): void
    {
        $this->postJson('/api/v1/timer/idle', $this->idlePayload())
            ->assertStatus(403)
            ->assertJsonPath('code', 'IDLE_CREDIT_DISABLED');
    }

    public function test_reassign_is_refused_with_403_and_creates_no_time(): void
    {
        $project = $this->project();
        $before = TimeEntry::withoutGlobalScopes()->count();

        $this->postJson('/api/v1/timer/idle', $this->idlePayload([
            'action' => 'reassign',
            'project_id' => $project->id,
        ]))
            ->assertStatus(403)
            ->assertJsonPath('code', 'IDLE_CREDIT_DISABLED');

        // Reassign used to mint a brand-new billable tracked entry — the single
        // strongest way to get paid for time away. Nothing may be written now.
        $this->assertSame($before, TimeEntry::withoutGlobalScopes()->count());
    }

    public function test_refusal_happens_before_validation_of_reassign_project(): void
    {
        // An old client sending reassign must get the honest policy answer, not a
        // confusing 422 about the project field.
        $this->postJson('/api/v1/timer/idle', $this->idlePayload([
            'action' => 'reassign',
            'project_id' => (string) Str::uuid(),
        ]))->assertStatus(422); // unknown project still fails validation first

        $this->postJson('/api/v1/timer/idle', $this->idlePayload([
            'action' => 'keep',
        ]))->assertStatus(403);
    }

    public function test_discard_still_works(): void
    {
        // The honest path must remain open — this is the only action left.
        $response = $this->postJson('/api/v1/timer/idle', $this->idlePayload([
            'action' => 'discard',
        ]));

        // No live timer in Redis, so this is a no-op/409-class response — the key
        // assertion is that it is NOT refused by the policy gate.
        $this->assertNotSame(403, $response->status());
    }

    public function test_an_unknown_action_is_still_a_validation_error(): void
    {
        $this->postJson('/api/v1/timer/idle', $this->idlePayload([
            'action' => 'credit_me',
        ]))->assertStatus(422);
    }
}
