<?php

namespace Tests\Feature\Api;

use App\Models\Organization;
use App\Models\Team;
use App\Models\User;
use Tests\TestCase;

class TeamTest extends TestCase
{
    private Organization $org;
    private User $owner;
    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();
        $this->org = Organization::factory()->create();
        $this->owner = User::factory()->create(['organization_id' => $this->org->id, 'role' => 'owner']);
        $this->employee = User::factory()->create(['organization_id' => $this->org->id, 'role' => 'employee']);
    }

    public function test_owner_can_create_team(): void
    {
        $this->actingAs($this->owner, 'sanctum');

        $response = $this->postJson('/api/v1/teams', [
            'name' => 'Engineering',
            'manager_id' => $this->owner->id,
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('team.name', 'Engineering');
    }

    public function test_employee_cannot_create_team(): void
    {
        $this->actingAs($this->employee, 'sanctum');

        $response = $this->postJson('/api/v1/teams', [
            'name' => 'Rogue Team',
        ]);

        $response->assertStatus(403);
    }

    public function test_can_add_member_to_team(): void
    {
        $team = Team::factory()->create([
            'organization_id' => $this->org->id,
            'manager_id' => $this->owner->id,
        ]);

        $this->actingAs($this->owner, 'sanctum');

        $response = $this->postJson("/api/v1/teams/{$team->id}/members", [
            'user_id' => $this->employee->id,
        ]);

        $response->assertOk();
        $this->assertTrue($team->fresh()->members->contains($this->employee));
    }

    public function test_can_remove_member_from_team(): void
    {
        $team = Team::factory()->create([
            'organization_id' => $this->org->id,
            'manager_id' => $this->owner->id,
        ]);
        $team->members()->attach($this->employee->id);

        $this->actingAs($this->owner, 'sanctum');

        $response = $this->deleteJson("/api/v1/teams/{$team->id}/members", [
            'user_id' => $this->employee->id,
        ]);

        $response->assertOk();
        $this->assertFalse($team->fresh()->members->contains($this->employee));
    }

    public function test_can_list_teams(): void
    {
        Team::factory()->count(2)->create([
            'organization_id' => $this->org->id,
            'manager_id' => $this->owner->id,
        ]);

        $this->actingAs($this->owner, 'sanctum');

        $response = $this->getJson('/api/v1/teams');
        $response->assertOk();
        $this->assertCount(2, $response->json('teams'));
    }
}
