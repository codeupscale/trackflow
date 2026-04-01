<?php

namespace Tests\Unit\Services;

use App\Models\Department;
use App\Models\Position;
use App\Services\OrganizationStructureService;
use Tests\TestCase;

class OrganizationStructureServiceTest extends TestCase
{
    private OrganizationStructureService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = app(OrganizationStructureService::class);
    }

    // ── Create Department ───────────────────────────────

    public function test_create_department_with_valid_data(): void
    {
        $org = $this->createOrganization();

        $dept = $this->service->createDepartment($org, [
            'name' => 'Engineering',
            'code' => 'ENG-001',
            'description' => 'Software engineering team',
        ]);

        $this->assertInstanceOf(Department::class, $dept);
        $this->assertEquals($org->id, $dept->organization_id);
        $this->assertEquals('Engineering', $dept->name);
        $this->assertEquals('ENG-001', $dept->code);
        $this->assertEquals('Software engineering team', $dept->description);
        $this->assertTrue($dept->is_active);
        $this->assertNull($dept->parent_department_id);
        $this->assertNull($dept->manager_id);
    }

    public function test_create_department_with_parent_and_manager(): void
    {
        $org = $this->createOrganization();
        $manager = $this->createUser($org, 'manager');

        $parent = Department::factory()->create(['organization_id' => $org->id]);

        $dept = $this->service->createDepartment($org, [
            'name' => 'Backend Team',
            'code' => 'ENG-BE',
            'parent_department_id' => $parent->id,
            'manager_id' => $manager->id,
        ]);

        $this->assertEquals($parent->id, $dept->parent_department_id);
        $this->assertEquals($manager->id, $dept->manager_id);
    }

    public function test_create_department_defaults_is_active_to_true(): void
    {
        $org = $this->createOrganization();

        $dept = $this->service->createDepartment($org, [
            'name' => 'Sales',
            'code' => 'SAL-001',
        ]);

        $this->assertTrue($dept->is_active);
    }

    public function test_create_department_can_override_is_active(): void
    {
        $org = $this->createOrganization();

        $dept = $this->service->createDepartment($org, [
            'name' => 'Legacy',
            'code' => 'LEG-001',
            'is_active' => false,
        ]);

        $this->assertFalse($dept->is_active);
    }

    // ── Update Department ───────────────────────────────

    public function test_update_department_changes_fields(): void
    {
        $org = $this->createOrganization();
        $dept = Department::factory()->create([
            'organization_id' => $org->id,
            'name' => 'Old Name',
        ]);

        $result = $this->service->updateDepartment($dept, [
            'name' => 'New Name',
            'description' => 'Updated description',
        ]);

        $this->assertEquals('New Name', $result->name);
        $this->assertEquals('Updated description', $result->description);
    }

    public function test_update_department_returns_fresh_model(): void
    {
        $org = $this->createOrganization();
        $dept = Department::factory()->create(['organization_id' => $org->id]);

        $result = $this->service->updateDepartment($dept, ['name' => 'Refreshed']);

        // fresh() re-queries from DB, so we verify the returned value matches DB
        $this->assertEquals('Refreshed', $result->name);
        $this->assertDatabaseHas('departments', [
            'id' => $dept->id,
            'name' => 'Refreshed',
        ]);
    }

    // ── Archive Department ──────────────────────────────

    public function test_archive_department_sets_is_active_false(): void
    {
        $org = $this->createOrganization();
        $dept = Department::factory()->create([
            'organization_id' => $org->id,
            'is_active' => true,
        ]);

        $result = $this->service->archiveDepartment($dept);

        $this->assertFalse($result->is_active);
        $this->assertDatabaseHas('departments', [
            'id' => $dept->id,
            'is_active' => false,
        ]);
    }

    public function test_archive_department_throws_when_has_active_children(): void
    {
        $org = $this->createOrganization();
        $parent = Department::factory()->create([
            'organization_id' => $org->id,
            'is_active' => true,
        ]);

        Department::factory()->create([
            'organization_id' => $org->id,
            'parent_department_id' => $parent->id,
            'is_active' => true,
        ]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Cannot archive department with active child departments');

        $this->service->archiveDepartment($parent);
    }

    public function test_archive_department_succeeds_when_children_are_inactive(): void
    {
        $org = $this->createOrganization();
        $parent = Department::factory()->create([
            'organization_id' => $org->id,
            'is_active' => true,
        ]);

        Department::factory()->create([
            'organization_id' => $org->id,
            'parent_department_id' => $parent->id,
            'is_active' => false,
        ]);

        $result = $this->service->archiveDepartment($parent);

        $this->assertFalse($result->is_active);
    }

    // ── Create Position ─────────────────────────────────

    public function test_create_position_with_valid_data(): void
    {
        $org = $this->createOrganization();
        $dept = Department::factory()->create(['organization_id' => $org->id]);

        $pos = $this->service->createPosition($org, [
            'department_id' => $dept->id,
            'title' => 'Senior Engineer',
            'code' => 'SE-001',
            'level' => 'senior',
            'employment_type' => 'full_time',
            'min_salary' => '80000',
            'max_salary' => '120000',
        ]);

        $this->assertInstanceOf(Position::class, $pos);
        $this->assertEquals($org->id, $pos->organization_id);
        $this->assertEquals($dept->id, $pos->department_id);
        $this->assertEquals('Senior Engineer', $pos->title);
        $this->assertEquals('senior', $pos->level);
        $this->assertEquals('full_time', $pos->employment_type);
        $this->assertTrue($pos->is_active);
    }

    public function test_create_position_with_salary_fields(): void
    {
        $org = $this->createOrganization();
        $dept = Department::factory()->create(['organization_id' => $org->id]);

        $pos = $this->service->createPosition($org, [
            'department_id' => $dept->id,
            'title' => 'Lead Engineer',
            'code' => 'LE-001',
            'level' => 'lead',
            'employment_type' => 'full_time',
            'min_salary' => '100000',
            'max_salary' => '150000',
        ]);

        // Salary fields are stored (encrypted at model level via casts)
        $freshPos = Position::find($pos->id);
        $this->assertNotNull($freshPos);
        $this->assertEquals($pos->id, $freshPos->id);
    }

    public function test_create_position_defaults_is_active_to_true(): void
    {
        $org = $this->createOrganization();
        $dept = Department::factory()->create(['organization_id' => $org->id]);

        $pos = $this->service->createPosition($org, [
            'department_id' => $dept->id,
            'title' => 'Intern',
            'code' => 'INT-001',
            'level' => 'junior',
            'employment_type' => 'intern',
        ]);

        $this->assertTrue($pos->is_active);
    }

    // ── Update Position ─────────────────────────────────

    public function test_update_position_changes_fields(): void
    {
        $org = $this->createOrganization();
        $dept = Department::factory()->create(['organization_id' => $org->id]);
        $pos = Position::factory()->create([
            'organization_id' => $org->id,
            'department_id' => $dept->id,
            'title' => 'Old Title',
        ]);

        $result = $this->service->updatePosition($pos, ['title' => 'New Title']);

        $this->assertEquals('New Title', $result->title);
        $this->assertDatabaseHas('positions', [
            'id' => $pos->id,
            'title' => 'New Title',
        ]);
    }

    // ── Archive Position ────────────────────────────────

    public function test_archive_position_sets_is_active_false(): void
    {
        $org = $this->createOrganization();
        $dept = Department::factory()->create(['organization_id' => $org->id]);
        $pos = Position::factory()->create([
            'organization_id' => $org->id,
            'department_id' => $dept->id,
            'is_active' => true,
        ]);

        $result = $this->service->archivePosition($pos);

        $this->assertFalse($result->is_active);
        $this->assertDatabaseHas('positions', [
            'id' => $pos->id,
            'is_active' => false,
        ]);
    }

    // ── Org Tree ────────────────────────────────────────

    public function test_get_org_tree_returns_nested_structure(): void
    {
        $org = $this->createOrganization();

        $engineering = Department::factory()->create([
            'organization_id' => $org->id,
            'name' => 'Engineering',
        ]);

        $backend = Department::factory()->create([
            'organization_id' => $org->id,
            'name' => 'Backend',
            'parent_department_id' => $engineering->id,
        ]);

        $frontend = Department::factory()->create([
            'organization_id' => $org->id,
            'name' => 'Frontend',
            'parent_department_id' => $engineering->id,
        ]);

        // Top-level department with no children
        $marketing = Department::factory()->create([
            'organization_id' => $org->id,
            'name' => 'Marketing',
        ]);

        $tree = $this->service->getOrgTree($org);

        // Tree should have 2 top-level nodes: Engineering and Marketing
        $this->assertCount(2, $tree);

        // Find Engineering node
        $engNode = collect($tree)->firstWhere('name', 'Engineering');
        $this->assertNotNull($engNode);
        $this->assertCount(2, $engNode['children']);

        $childNames = collect($engNode['children'])->pluck('name')->sort()->values()->toArray();
        $this->assertEquals(['Backend', 'Frontend'], $childNames);

        // Marketing has no children
        $mktNode = collect($tree)->firstWhere('name', 'Marketing');
        $this->assertNotNull($mktNode);
        $this->assertCount(0, $mktNode['children']);
    }

    public function test_get_org_tree_includes_positions(): void
    {
        $org = $this->createOrganization();
        $dept = Department::factory()->create(['organization_id' => $org->id]);

        Position::factory()->create([
            'organization_id' => $org->id,
            'department_id' => $dept->id,
            'title' => 'Senior Dev',
        ]);

        Position::factory()->create([
            'organization_id' => $org->id,
            'department_id' => $dept->id,
            'title' => 'Junior Dev',
        ]);

        $tree = $this->service->getOrgTree($org);

        $this->assertCount(1, $tree);
        $this->assertCount(2, $tree[0]['positions']);
    }

    public function test_get_org_tree_returns_empty_for_org_with_no_departments(): void
    {
        $org = $this->createOrganization();

        $tree = $this->service->getOrgTree($org);

        $this->assertIsArray($tree);
        $this->assertCount(0, $tree);
    }

    public function test_get_org_tree_does_not_leak_other_org_data(): void
    {
        $org1 = $this->createOrganization();
        $org2 = $this->createOrganization();

        Department::factory()->create(['organization_id' => $org1->id, 'name' => 'Org1 Dept']);
        Department::factory()->create(['organization_id' => $org2->id, 'name' => 'Org2 Dept']);

        $tree = $this->service->getOrgTree($org1);

        $this->assertCount(1, $tree);
        $this->assertEquals('Org1 Dept', $tree[0]['name']);
    }

    // ── Get Department Positions ─────────────────────────

    public function test_get_department_positions_returns_ordered_list(): void
    {
        $org = $this->createOrganization();
        $dept = Department::factory()->create(['organization_id' => $org->id]);

        Position::factory()->create([
            'organization_id' => $org->id,
            'department_id' => $dept->id,
            'title' => 'Zebra Role',
        ]);
        Position::factory()->create([
            'organization_id' => $org->id,
            'department_id' => $dept->id,
            'title' => 'Alpha Role',
        ]);

        $positions = $this->service->getDepartmentPositions($dept);

        $this->assertCount(2, $positions);
        $this->assertEquals('Alpha Role', $positions->first()->title);
        $this->assertEquals('Zebra Role', $positions->last()->title);
    }
}
