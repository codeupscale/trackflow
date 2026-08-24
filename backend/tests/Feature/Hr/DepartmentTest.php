<?php

namespace Tests\Feature\Hr;

use App\Models\Department;
use App\Models\EmployeeProfile;
use App\Models\Position;
use App\Models\User;
use Tests\TestCase;

class DepartmentTest extends TestCase
{
    // ── Employee headcount (employees_count) ─────────────

    public function test_index_returns_live_employee_count_per_department(): void
    {
        $user = $this->actingAsUser('owner');
        $orgId = $user->organization_id;

        $engineering = Department::factory()->create([
            'organization_id' => $orgId,
            'name' => 'Engineering',
        ]);
        $empty = Department::factory()->create([
            'organization_id' => $orgId,
            'name' => 'Design',
        ]);

        $this->attachEmployees($orgId, $engineering->id, 3);

        $response = $this->getJson('/api/v1/hr/departments')->assertOk();

        $byId = collect($response->json('data'))->keyBy('id');
        $this->assertSame(3, $byId[$engineering->id]['employees_count']);
        $this->assertSame(0, $byId[$empty->id]['employees_count']);
    }

    public function test_employee_count_excludes_deactivated_users(): void
    {
        // The count must agree with EmployeeService::getDirectory(), which only
        // lists active users. A leaver still holds an employee_profile row, so
        // counting profiles alone would overstate the department.
        $user = $this->actingAsUser('owner');
        $orgId = $user->organization_id;

        $dept = Department::factory()->create(['organization_id' => $orgId]);
        $members = $this->attachEmployees($orgId, $dept->id, 3);

        $members->first()->update(['is_active' => false]);

        $response = $this->getJson('/api/v1/hr/departments')->assertOk();
        $row = collect($response->json('data'))->firstWhere('id', $dept->id);

        $this->assertSame(2, $row['employees_count']);
    }

    public function test_employee_count_does_not_leak_across_organizations(): void
    {
        $user = $this->actingAsUser('owner');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);
        $this->attachEmployees($user->organization_id, $dept->id, 2);

        // A department id is a uuid, so another org's profiles can never point at
        // it — but assert the count stays scoped anyway.
        $otherOrg = $this->createOrganization();
        $otherDept = Department::factory()->create(['organization_id' => $otherOrg->id]);
        $this->attachEmployees($otherOrg->id, $otherDept->id, 5);

        $response = $this->getJson('/api/v1/hr/departments')->assertOk();
        $rows = collect($response->json('data'));

        $this->assertSame(2, $rows->firstWhere('id', $dept->id)['employees_count']);
        $this->assertNull($rows->firstWhere('id', $otherDept->id));
    }

    public function test_show_returns_employee_count(): void
    {
        $user = $this->actingAsUser('owner');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);
        $this->attachEmployees($user->organization_id, $dept->id, 2);

        $this->getJson("/api/v1/hr/departments/{$dept->id}")
            ->assertOk()
            ->assertJsonPath('data.employees_count', 2);
    }

    /**
     * Create $count active users in $orgId, each with an employee profile in
     * $deptId. Returns the users so a test can deactivate one.
     */
    private function attachEmployees(string $orgId, string $deptId, int $count)
    {
        return collect(range(1, $count))->map(function () use ($orgId, $deptId) {
            $member = User::factory()->create([
                'organization_id' => $orgId,
                'role' => 'employee',
                'is_active' => true,
            ]);

            EmployeeProfile::factory()->create([
                'organization_id' => $orgId,
                'user_id' => $member->id,
                'department_id' => $deptId,
            ]);

            return $member;
        });
    }

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
        $user = $this->actingAsUser('org_manager');

        $response = $this->postJson('/api/v1/hr/departments', [
            'name' => 'Engineering',
            'code' => 'ENG',
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('data.name', 'Engineering')
            ->assertJsonPath('data.code', 'ENG');

        $this->assertDatabaseHas('departments', [
            'organization_id' => $user->organization_id,
            'name' => 'Engineering',
            'code' => 'ENG',
        ]);
    }

    public function test_store_validates_required_fields(): void
    {
        $this->actingAsUser('org_manager');

        $response = $this->postJson('/api/v1/hr/departments', []);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['name', 'code']);
    }

    public function test_store_code_unique_per_org(): void
    {
        $user = $this->actingAsUser('org_manager');

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
        $otherAdmin = $this->createUser($otherOrg, 'org_manager');
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
            ->assertJsonPath('data.id', $dept->id)
            ->assertJsonCount(2, 'data.positions');
    }

    // ── Update ───────────────────────────────────────────

    public function test_update_department(): void
    {
        $user = $this->actingAsUser('org_manager');

        $dept = Department::factory()->create([
            'organization_id' => $user->organization_id,
            'name' => 'Old Name',
        ]);

        $response = $this->putJson("/api/v1/hr/departments/{$dept->id}", [
            'name' => 'New Name',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.name', 'New Name');
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
