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

    public function test_owner_sees_all_projects(): void
    {
        Project::factory()->count(3)->create([
            'organization_id' => $this->org->id,
            'created_by' => $this->owner->id,
        ]);

        $this->actingAs($this->owner, 'sanctum');
        $response = $this->getJson('/api/v1/projects');
        $response->assertOk();
        $this->assertCount(3, $response->json('data'));
    }

    public function test_employee_sees_only_assigned_projects(): void
    {
        $projects = Project::factory()->count(3)->create([
            'organization_id' => $this->org->id,
            'created_by' => $this->owner->id,
        ]);

        $this->actingAs($this->employee, 'sanctum');
        $response = $this->getJson('/api/v1/projects');
        $response->assertOk();
        $this->assertCount(0, $response->json('data'));

        // Assign employee to one project
        $projects[0]->members()->attach($this->employee->id);
        $response = $this->getJson('/api/v1/projects');
        $response->assertOk();
        $this->assertCount(1, $response->json('data'));
        $this->assertEquals($projects[0]->id, $response->json('data.0.id'));
    }

    public function test_employee_cannot_view_unassigned_project(): void
    {
        $project = Project::factory()->create([
            'organization_id' => $this->org->id,
            'created_by' => $this->owner->id,
        ]);

        $this->actingAs($this->employee, 'sanctum');
        $response = $this->getJson("/api/v1/projects/{$project->id}");
        $response->assertStatus(403);
    }

    public function test_employee_can_view_assigned_project(): void
    {
        $project = Project::factory()->create([
            'organization_id' => $this->org->id,
            'created_by' => $this->owner->id,
        ]);
        $project->members()->attach($this->employee->id);

        $this->actingAs($this->employee, 'sanctum');
        $response = $this->getJson("/api/v1/projects/{$project->id}");
        $response->assertOk();
        $this->assertEquals($project->id, $response->json('project.id'));
    }

    public function test_manager_can_list_and_sync_project_members(): void
    {
        $manager = User::factory()->create(['organization_id' => $this->org->id, 'role' => 'manager']);
        $project = Project::factory()->create([
            'organization_id' => $this->org->id,
            'created_by' => $this->owner->id,
        ]);
        $member = User::factory()->create(['organization_id' => $this->org->id, 'role' => 'employee']);

        $this->actingAs($manager, 'sanctum');

        $response = $this->getJson("/api/v1/projects/{$project->id}/members");
        $response->assertOk();
        $this->assertCount(0, $response->json('members'));

        $response = $this->putJson("/api/v1/projects/{$project->id}/members", [
            'user_ids' => [$member->id],
        ]);
        $response->assertOk();
        $this->assertCount(1, $response->json('members'));
        $this->assertEquals($member->id, $response->json('members.0.id'));

        $response = $this->getJson("/api/v1/projects/{$project->id}/members");
        $response->assertOk();
        $this->assertCount(1, $response->json('members'));

        $response = $this->deleteJson("/api/v1/projects/{$project->id}/members/{$member->id}");
        $response->assertOk();
        $response = $this->getJson("/api/v1/projects/{$project->id}/members");
        $this->assertCount(0, $response->json('members'));
    }

    public function test_employee_cannot_manage_project_members(): void
    {
        $project = Project::factory()->create([
            'organization_id' => $this->org->id,
            'created_by' => $this->owner->id,
        ]);

        $this->actingAs($this->employee, 'sanctum');
        $this->getJson("/api/v1/projects/{$project->id}/members")->assertStatus(403);
        $this->putJson("/api/v1/projects/{$project->id}/members", ['user_ids' => []])->assertStatus(403);
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
        $this->assertCount(1, $response->json('data'));
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
