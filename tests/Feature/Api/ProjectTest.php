<?php

namespace Tests\Feature\Api;

use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Tests\TestCase;

class ProjectTest extends TestCase
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

    public function test_owner_can_create_project(): void
    {
        $this->actingAs($this->owner, 'sanctum');

        $response = $this->postJson('/api/v1/projects', [
            'name' => 'Test Project',
            'color' => '#FF5733',
            'billable' => true,
            'hourly_rate' => 50.00,
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('project.name', 'Test Project')
            ->assertJsonPath('project.billable', true);

        $this->assertDatabaseHas('projects', ['name' => 'Test Project']);
    }

    public function test_employee_cannot_create_project(): void
    {
        $this->actingAs($this->employee, 'sanctum');

        $response = $this->postJson('/api/v1/projects', [
            'name' => 'Employee Project',
        ]);

        $response->assertStatus(403);
    }

    public function test_can_list_projects(): void
    {
        Project::factory()->count(3)->create([
            'organization_id' => $this->org->id,
            'created_by' => $this->owner->id,
        ]);

        $this->actingAs($this->employee, 'sanctum');

        $response = $this->getJson('/api/v1/projects');
        $response->assertOk();
        $this->assertCount(3, $response->json('projects'));
    }

    public function test_cross_tenant_project_isolation(): void
    {
        $otherOrg = Organization::factory()->create();
        $otherUser = User::factory()->create(['organization_id' => $otherOrg->id, 'role' => 'owner']);

        Project::factory()->create([
            'organization_id' => $this->org->id,
            'created_by' => $this->owner->id,
        ]);
        Project::factory()->create([
            'organization_id' => $otherOrg->id,
            'created_by' => $otherUser->id,
        ]);

        $this->actingAs($this->owner, 'sanctum');
        $response = $this->getJson('/api/v1/projects');
        $this->assertCount(1, $response->json('projects'));
    }

    public function test_can_update_project(): void
    {
        $project = Project::factory()->create([
            'organization_id' => $this->org->id,
            'created_by' => $this->owner->id,
        ]);

        $this->actingAs($this->owner, 'sanctum');

        $response = $this->putJson("/api/v1/projects/{$project->id}", [
            'name' => 'Updated Name',
            'is_archived' => true,
        ]);

        $response->assertOk();
        $this->assertEquals('Updated Name', $response->json('project.name'));
    }

    public function test_can_delete_project(): void
    {
        $project = Project::factory()->create([
            'organization_id' => $this->org->id,
            'created_by' => $this->owner->id,
        ]);

        $this->actingAs($this->owner, 'sanctum');

        $response = $this->deleteJson("/api/v1/projects/{$project->id}");
        $response->assertOk();
    }
}
