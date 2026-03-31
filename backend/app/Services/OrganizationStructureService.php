<?php

namespace App\Services;

use App\Models\Department;
use App\Models\Organization;
use App\Models\Position;
use Illuminate\Database\Eloquent\Collection;

class OrganizationStructureService
{
    public function createDepartment(Organization $org, array $data): Department
    {
        return Department::create([
            'organization_id' => $org->id,
            'name' => $data['name'],
            'code' => $data['code'],
            'description' => $data['description'] ?? null,
            'parent_department_id' => $data['parent_department_id'] ?? null,
            'manager_id' => $data['manager_id'] ?? null,
            'is_active' => $data['is_active'] ?? true,
        ]);
    }

    public function updateDepartment(Department $dept, array $data): Department
    {
        $dept->update($data);

        return $dept->fresh();
    }

    /**
     * Archive a department by setting is_active = false.
     * Throws if the department has active child departments.
     */
    public function archiveDepartment(Department $dept): Department
    {
        $activeChildCount = Department::where('parent_department_id', $dept->id)
            ->where('is_active', true)
            ->count();

        if ($activeChildCount > 0) {
            throw new \RuntimeException(
                'Cannot archive department with active child departments. Archive or reassign them first.'
            );
        }

        $dept->update(['is_active' => false]);

        return $dept->fresh();
    }

    public function createPosition(Organization $org, array $data): Position
    {
        return Position::create([
            'organization_id' => $org->id,
            'department_id' => $data['department_id'],
            'title' => $data['title'],
            'code' => $data['code'],
            'level' => $data['level'],
            'employment_type' => $data['employment_type'],
            'min_salary' => $data['min_salary'] ?? null,
            'max_salary' => $data['max_salary'] ?? null,
            'is_active' => $data['is_active'] ?? true,
        ]);
    }

    public function updatePosition(Position $pos, array $data): Position
    {
        $pos->update($data);

        return $pos->fresh();
    }

    /**
     * Archive a position by setting is_active = false.
     */
    public function archivePosition(Position $pos): Position
    {
        $pos->update(['is_active' => false]);

        return $pos->fresh();
    }

    /**
     * Build a recursive org tree: top-level departments with nested children and positions.
     *
     * Loads ALL departments + positions in two queries (no N+1), then assembles in memory.
     */
    public function getOrgTree(Organization $org): array
    {
        $departments = Department::where('organization_id', $org->id)
            ->with('positions')
            ->orderBy('name')
            ->get();

        // Index by ID for O(1) lookup
        $byId = [];
        foreach ($departments as $dept) {
            $byId[$dept->id] = $dept->toArray();
            $byId[$dept->id]['children'] = [];
        }

        // Build tree
        $tree = [];
        foreach ($byId as $id => &$node) {
            if ($node['parent_department_id'] && isset($byId[$node['parent_department_id']])) {
                $byId[$node['parent_department_id']]['children'][] = &$node;
            } else {
                $tree[] = &$node;
            }
        }
        unset($node);

        return $tree;
    }

    /**
     * Get all positions for a department.
     */
    public function getDepartmentPositions(Department $dept): Collection
    {
        return $dept->positions()->orderBy('title')->get();
    }
}
