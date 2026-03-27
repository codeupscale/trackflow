<?php

namespace Tests\Feature\Enterprise;

use App\Models\Organization;
use App\Models\Project;
use App\Models\Team;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class MultiTenancyTest extends TestCase
{
    use RefreshDatabase;

    private User $orgAUser;
    private User $orgBUser;
    private Organization $orgA;
    private Organization $orgB;

    protected function setUp(): void
    {
        parent::setUp();

        $this->orgA = Organization::factory()->create(['name' => 'Org A']);
        $this->orgB = Organization::factory()->create(['name' => 'Org B']);

        $this->orgAUser = User::factory()->create([
            'organization_id' => $this->orgA->id,
            'role' => 'admin',
        ]);
        $this->orgBUser = User::factory()->create([
            'organization_id' => $this->orgB->id,
            'role' => 'admin',
        ]);
    }

    public function test_cannot_view_other_org_team(): void
    {
        $team = Team::factory()->create(['organization_id' => $this->orgB->id]);

        $response = $this->actingAs($this->orgAUser)
            ->getJson("/api/v1/teams/{$team->id}");

        $response->assertStatus(404);
    }

    public function test_cannot_update_other_org_team(): void
    {
        $team = Team::factory()->create(['organization_id' => $this->orgB->id]);

        $response = $this->actingAs($this->orgAUser)
            ->putJson("/api/v1/teams/{$team->id}", ['name' => 'Hacked']);

        $response->assertStatus(404);
    }

    public function test_cannot_delete_other_org_team(): void
    {
        $team = Team::factory()->create(['organization_id' => $this->orgB->id]);

        $response = $this->actingAs($this->orgAUser)
            ->deleteJson("/api/v1/teams/{$team->id}");

        $response->assertStatus(404);
    }

    public function test_cannot_add_cross_org_member_to_team(): void
    {
        $team = Team::factory()->create(['organization_id' => $this->orgA->id]);

        $response = $this->actingAs($this->orgAUser)
            ->postJson("/api/v1/teams/{$team->id}/members", [
                'user_id' => $this->orgBUser->id,
            ]);

        $response->assertStatus(404);
    }

    public function test_cannot_view_other_org_time_entry(): void
    {
        $entry = TimeEntry::factory()->create([
            'organization_id' => $this->orgB->id,
            'user_id' => $this->orgBUser->id,
        ]);

        $response = $this->actingAs($this->orgAUser)
            ->getJson("/api/v1/time-entries/{$entry->id}");

        $response->assertStatus(404);
    }

    public function test_cannot_approve_other_org_time_entry(): void
    {
        $entry = TimeEntry::factory()->create([
            'organization_id' => $this->orgB->id,
            'user_id' => $this->orgBUser->id,
        ]);

        $response = $this->actingAs($this->orgAUser)
            ->postJson("/api/v1/time-entries/{$entry->id}/approve");

        $response->assertStatus(404);
    }

    public function test_cannot_create_time_entry_with_other_org_project(): void
    {
        $project = Project::factory()->create(['organization_id' => $this->orgB->id]);

        $response = $this->actingAs($this->orgAUser)
            ->postJson('/api/v1/time-entries', [
                'started_at' => now()->subHour()->toISOString(),
                'ended_at' => now()->toISOString(),
                'project_id' => $project->id,
            ]);

        $response->assertStatus(404);
    }

    public function test_cannot_set_cross_org_manager_on_team(): void
    {
        $response = $this->actingAs($this->orgAUser)
            ->postJson('/api/v1/teams', [
                'name' => 'Test Team',
                'manager_id' => $this->orgBUser->id,
            ]);

        $response->assertStatus(404);
    }

    public function test_user_index_only_returns_own_org_users(): void
    {
        $response = $this->actingAs($this->orgAUser)
            ->getJson('/api/v1/users');

        $response->assertStatus(200);
        $userIds = collect($response->json('users'))->pluck('id');
        $this->assertContains($this->orgAUser->id, $userIds->toArray());
        $this->assertNotContains($this->orgBUser->id, $userIds->toArray());
    }

    public function test_team_index_only_returns_own_org_teams(): void
    {
        Team::factory()->create(['organization_id' => $this->orgA->id, 'name' => 'Team A']);
        Team::factory()->create(['organization_id' => $this->orgB->id, 'name' => 'Team B']);

        $response = $this->actingAs($this->orgAUser)
            ->getJson('/api/v1/teams');

        $response->assertStatus(200);
        $names = collect($response->json('data'))->pluck('name');
        $this->assertContains('Team A', $names->toArray());
        $this->assertNotContains('Team B', $names->toArray());
    }
}
