<?php

namespace Tests\Feature\Hr;

use App\Models\Department;
use App\Models\Position;
use Tests\TestCase;

class PositionTest extends TestCase
{
    // ── Index ────────────────────────────────────────────

    public function test_index_returns_paginated_positions(): void
    {
        $user = $this->actingAsUser('owner');

        $dept = Department::factory()->create([
            'organization_id' => $user->organization_id,
        ]);

        Position::factory()->count(3)->create([
            'organization_id' => $user->organization_id,
            'department_id' => $dept->id,
        ]);

        $response = $this->getJson('/api/v1/hr/positions');

        $response->assertOk()
            ->assertJsonStructure([
                'data' => [['id', 'title', 'code', 'level', 'employment_type']],
                'current_page',
                'last_page',
                'total',
            ]);

        $this->assertCount(3, $response->json('data'));
    }

    public function test_index_filters_by_department_id(): void
    {
        $user = $this->actingAsUser('owner');

        $deptA = Department::factory()->create(['organization_id' => $user->organization_id]);
        $deptB = Department::factory()->create(['organization_id' => $user->organization_id]);

        Position::factory()->count(2)->create([
            'organization_id' => $user->organization_id,
            'department_id' => $deptA->id,
        ]);
        Position::factory()->create([
            'organization_id' => $user->organization_id,
            'department_id' => $deptB->id,
        ]);

        $response = $this->getJson("/api/v1/hr/positions?department_id={$deptA->id}");

        $response->assertOk();
        $this->assertCount(2, $response->json('data'));
    }

    // ── Store ────────────────────────────────────────────

    public function test_store_creates_position(): void
    {
        $user = $this->actingAsUser('admin');

        $dept = Department::factory()->create([
            'organization_id' => $user->organization_id,
        ]);

        $response = $this->postJson('/api/v1/hr/positions', [
            'title' => 'Senior Engineer',
            'code' => 'SE-001',
            'department_id' => $dept->id,
            'level' => 'senior',
            'employment_type' => 'full_time',
            'min_salary' => 80000,
            'max_salary' => 120000,
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('position.title', 'Senior Engineer')
            ->assertJsonPath('position.code', 'SE-001');

        $this->assertDatabaseHas('positions', [
            'organization_id' => $user->organization_id,
            'title' => 'Senior Engineer',
            'code' => 'SE-001',
        ]);
    }

    public function test_store_validates_max_salary_gte_min_salary(): void
    {
        $user = $this->actingAsUser('admin');

        $dept = Department::factory()->create([
            'organization_id' => $user->organization_id,
        ]);

        $response = $this->postJson('/api/v1/hr/positions', [
            'title' => 'Tester',
            'code' => 'TST-001',
            'department_id' => $dept->id,
            'level' => 'junior',
            'employment_type' => 'full_time',
            'min_salary' => 100000,
            'max_salary' => 50000,
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['max_salary']);
    }

    // ── Update ───────────────────────────────────────────

    public function test_update_position(): void
    {
        $user = $this->actingAsUser('admin');

        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);
        $position = Position::factory()->create([
            'organization_id' => $user->organization_id,
            'department_id' => $dept->id,
            'title' => 'Old Title',
        ]);

        $response = $this->putJson("/api/v1/hr/positions/{$position->id}", [
            'title' => 'New Title',
        ]);

        $response->assertOk()
            ->assertJsonPath('position.title', 'New Title');
    }

    // ── Destroy (archive) ────────────────────────────────

    public function test_destroy_archives_position(): void
    {
        $user = $this->actingAsUser('owner');

        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);
        $position = Position::factory()->create([
            'organization_id' => $user->organization_id,
            'department_id' => $dept->id,
            'is_active' => true,
        ]);

        $response = $this->deleteJson("/api/v1/hr/positions/{$position->id}");

        $response->assertOk()
            ->assertJsonPath('message', 'Position archived.');

        $this->assertDatabaseHas('positions', [
            'id' => $position->id,
            'is_active' => false,
        ]);
    }

    // ── Cross-Org Isolation ──────────────────────────────

    public function test_cross_org_isolation(): void
    {
        $orgA = $this->createOrganization();
        $orgB = $this->createOrganization();

        $userA = $this->createUser($orgA, 'owner');

        $deptB = Department::factory()->create(['organization_id' => $orgB->id]);
        $posB = Position::factory()->create([
            'organization_id' => $orgB->id,
            'department_id' => $deptB->id,
        ]);

        $this->actingAs($userA, 'sanctum');

        $response = $this->getJson('/api/v1/hr/positions');
        $response->assertOk();
        $ids = collect($response->json('data'))->pluck('id')->toArray();
        $this->assertNotContains($posB->id, $ids);

        $response = $this->getJson("/api/v1/hr/positions/{$posB->id}");
        $response->assertStatus(404);
    }
}
