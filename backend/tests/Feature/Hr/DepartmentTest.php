<?php

namespace Tests\Feature\Hr;

use App\Models\Department;
use App\Models\Position;
use Tests\TestCase;

class DepartmentTest extends TestCase
{
    // ── Index ────────────────────────────────────────────

    public function test_index_returns_paginated_departments(): void
    {
        $user = $this->actingAsUser('owner');

        Department::factory()->count(3)->create([
            'organization_id' => $user->organization_id,
        ]);

        $response = $this->getJson('/api/v1/hr/departments');

        $response->assertOk()
            ->assertJsonStructure([
                'data' => [['id', 'name', 'code', 'is_active']],
                'current_page',
                'last_page',
                'total',
            ]);

        $this->assertCount(3, $response->json('data'));
    }

    public function test_index_filters_by_is_active(): void
    {
        $user = $this->actingAsUser('owner');

        Department::factory()->create([
            'organization_id' => $user->organization_id,
            'is_active' => true,
        ]);
        Department::factory()->create([
            'organization_id' => $user->organization_id,
            'is_active' => false,
        ]);

        $response = $this->getJson('/api/v1/hr/departments?is_active=true');

        $response->assertOk();
        $this->assertCount(1, $response->json('data'));
        $this->assertTrue($response->json('data.0.is_active'));
    }

    // ── Store ────────────────────────────────────────────

    public function test_store_creates_department(): void
    {
        $user = $this->actingAsUser('admin');

        $response = $this->postJson('/api/v1/hr/departments', [
            'name' => 'Engineering',
            'code' => 'ENG',
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('department.name', 'Engineering')
            ->assertJsonPath('department.code', 'ENG');

        $this->assertDatabaseHas('departments', [
            'organization_id' => $user->organization_id,
            'name' => 'Engineering',
            'code' => 'ENG',
        ]);
    }

    public function test_store_validates_required_fields(): void
    {
        $this->actingAsUser('admin');

        $response = $this->postJson('/api/v1/hr/departments', []);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['name', 'code']);
    }

    public function test_store_code_unique_per_org(): void
    {
        $user = $this->actingAsUser('admin');

        Department::factory()->create([
            'organization_id' => $user->organization_id,
            'code' => 'ENG',
        ]);

        // Same code same org → 422
        $response = $this->postJson('/api/v1/hr/departments', [
            'name' => 'Engineering 2',
            'code' => 'ENG',
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['code']);

        // Same code different org → OK
        $otherOrg = $this->createOrganization();
        $otherAdmin = $this->createUser($otherOrg, 'admin');
        $this->actingAs($otherAdmin, 'sanctum');

        $response = $this->postJson('/api/v1/hr/departments', [
            'name' => 'Engineering',
            'code' => 'ENG',
        ]);

        $response->assertStatus(201);
    }

    // ── Show ─────────────────────────────────────────────

    public function test_show_returns_department_with_positions(): void
    {
        $user = $this->actingAsUser('owner');

        $dept = Department::factory()->create([
            'organization_id' => $user->organization_id,
        ]);

        Position::factory()->count(2)->create([
            'organization_id' => $user->organization_id,
            'department_id' => $dept->id,
        ]);

        $response = $this->getJson("/api/v1/hr/departments/{$dept->id}");

        $response->assertOk()
            ->assertJsonPath('department.id', $dept->id)
            ->assertJsonCount(2, 'department.positions');
    }

    // ── Update ───────────────────────────────────────────

    public function test_update_department(): void
    {
        $user = $this->actingAsUser('admin');

        $dept = Department::factory()->create([
            'organization_id' => $user->organization_id,
            'name' => 'Old Name',
        ]);

        $response = $this->putJson("/api/v1/hr/departments/{$dept->id}", [
            'name' => 'New Name',
        ]);

        $response->assertOk()
            ->assertJsonPath('department.name', 'New Name');
    }

    // ── Destroy (archive) ────────────────────────────────

    public function test_destroy_archives_department(): void
    {
        $user = $this->actingAsUser('owner');

        $dept = Department::factory()->create([
            'organization_id' => $user->organization_id,
            'is_active' => true,
        ]);

        $response = $this->deleteJson("/api/v1/hr/departments/{$dept->id}");

        $response->assertOk()
            ->assertJsonPath('message', 'Department archived.');

        $this->assertDatabaseHas('departments', [
            'id' => $dept->id,
            'is_active' => false,
        ]);
    }

    // ── Tree ─────────────────────────────────────────────

    public function test_tree_returns_nested_structure(): void
    {
        $user = $this->actingAsUser('owner');

        $parent = Department::factory()->create([
            'organization_id' => $user->organization_id,
            'name' => 'Parent',
        ]);

        Department::factory()->create([
            'organization_id' => $user->organization_id,
            'name' => 'Child',
            'parent_department_id' => $parent->id,
        ]);

        $response = $this->getJson('/api/v1/hr/departments/tree');

        $response->assertOk()
            ->assertJsonStructure(['tree']);

        // Find the parent node in the tree — it should have children
        $tree = $response->json('tree');
        $parentNode = collect($tree)->firstWhere('id', $parent->id);
        $this->assertNotNull($parentNode);
        $this->assertNotEmpty($parentNode['children']);
        $this->assertEquals('Child', $parentNode['children'][0]['name']);
    }

    // ── Authorization ────────────────────────────────────

    public function test_employee_cannot_create_department(): void
    {
        $this->actingAsUser('employee');

        $response = $this->postJson('/api/v1/hr/departments', [
            'name' => 'Engineering',
            'code' => 'ENG',
        ]);

        $response->assertStatus(403);
    }

    // ── Cross-Org Isolation ──────────────────────────────

    public function test_cross_org_isolation(): void
    {
        $orgA = $this->createOrganization();
        $orgB = $this->createOrganization();

        $userA = $this->createUser($orgA, 'owner');
        $this->createUser($orgB, 'owner');

        $deptB = Department::factory()->create([
            'organization_id' => $orgB->id,
        ]);

        // User A should not see org B's department
        $this->actingAs($userA, 'sanctum');

        $response = $this->getJson('/api/v1/hr/departments');
        $response->assertOk();
        $ids = collect($response->json('data'))->pluck('id')->toArray();
        $this->assertNotContains($deptB->id, $ids);

        // User A should get 404 trying to view org B's department directly
        $response = $this->getJson("/api/v1/hr/departments/{$deptB->id}");
        $response->assertStatus(404);
    }
}
