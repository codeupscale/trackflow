<?php

namespace Tests\Feature\Api;

use App\Models\ActivityLog;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Tests\TestCase;

/**
 * Regression tests for FIX B5: offline heartbeat replay through POST /agent/logs must
 * not lose legitimate activity. A missing/unknown time_entry_id is attributed to the
 * user's entry open at the heartbeat's logged_at (org-scoped); unattributable logs are
 * skipped cleanly instead of 422/403-dropping the whole batch.
 */
class AgentBulkLogsTest extends TestCase
{
    private Organization $org;
    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->org = $this->createOrganization();
        $this->user = $this->createUser($this->org, 'employee');
        $this->actingAs($this->user, 'sanctum');
    }

    public function test_bulk_logs_with_valid_entry_id_inserts(): void
    {
        $entry = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subHour(),
            'ended_at' => null,
            'duration_seconds' => null,
            'type' => 'tracked',
        ]);

        $response = $this->postJson('/api/v1/agent/logs', [
            'logs' => [[
                'keyboard_events' => 5,
                'mouse_events' => 5,
                'logged_at' => now()->subMinutes(10)->toISOString(),
                'time_entry_id' => $entry->id,
            ]],
        ]);

        $response->assertStatus(200)->assertJsonPath('inserted', 1);
        $this->assertEquals(1, ActivityLog::where('time_entry_id', $entry->id)->count());
    }

    public function test_bulk_logs_attributes_missing_entry_id_by_logged_at(): void
    {
        // A historical entry covering the heartbeat's capture window.
        $entry = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subHours(3),
            'ended_at' => now()->subHour(),
            'duration_seconds' => 7200,
            'type' => 'tracked',
        ]);

        $loggedAt = now()->subHours(2); // inside [started_at, ended_at]

        $response = $this->postJson('/api/v1/agent/logs', [
            'logs' => [[
                'keyboard_events' => 3,
                'mouse_events' => 7,
                'logged_at' => $loggedAt->toISOString(),
                // time_entry_id intentionally omitted (offline flush lost it)
            ]],
        ]);

        $response->assertStatus(200)->assertJsonPath('inserted', 1);
        $this->assertEquals(1, ActivityLog::where('time_entry_id', $entry->id)->count());
    }

    public function test_bulk_logs_skips_unattributable_log_without_dropping_batch(): void
    {
        $entry = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->user->id,
            'started_at' => now()->subHour(),
            'ended_at' => null,
            'duration_seconds' => null,
            'type' => 'tracked',
        ]);

        $response = $this->postJson('/api/v1/agent/logs', [
            'logs' => [
                [
                    // Attributable to the open entry.
                    'keyboard_events' => 1,
                    'mouse_events' => 1,
                    'logged_at' => now()->subMinutes(5)->toISOString(),
                    'time_entry_id' => $entry->id,
                ],
                [
                    // No id and no entry covered this far-past moment → skipped, not dropped.
                    'keyboard_events' => 2,
                    'mouse_events' => 2,
                    'logged_at' => now()->subDays(10)->toISOString(),
                ],
            ],
        ]);

        $response->assertStatus(200)
            ->assertJsonPath('inserted', 1)
            ->assertJsonPath('skipped', 1);
    }

    public function test_bulk_logs_rejects_cross_user_entry_id_by_falling_back_then_skipping(): void
    {
        // Another user's entry in the SAME org — must never receive this user's activity.
        $otherUser = $this->createUser($this->org, 'employee');
        $otherEntry = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $otherUser->id,
            'started_at' => now()->subHours(2),
            'ended_at' => null,
            'duration_seconds' => null,
            'type' => 'tracked',
        ]);

        // The authenticated user has no open entry at the logged_at → cannot attribute.
        $response = $this->postJson('/api/v1/agent/logs', [
            'logs' => [[
                'keyboard_events' => 9,
                'mouse_events' => 9,
                'logged_at' => now()->subMinutes(1)->toISOString(),
                'time_entry_id' => $otherEntry->id,
            ]],
        ]);

        $response->assertStatus(200)
            ->assertJsonPath('inserted', 0)
            ->assertJsonPath('skipped', 1);

        // The cross-user entry received nothing.
        $this->assertEquals(0, ActivityLog::where('time_entry_id', $otherEntry->id)->count());
    }
}
