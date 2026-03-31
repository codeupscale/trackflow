<?php

namespace Database\Factories;

use App\Models\Department;
use App\Models\Organization;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Department> */
class DepartmentFactory extends Factory
{
    protected $model = Department::class;

    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'name' => fake()->unique()->randomElement([
                'Engineering', 'Marketing', 'Sales', 'Finance',
                'Human Resources', 'Operations', 'Product', 'Design',
                'Legal', 'Customer Success', 'Data Science', 'DevOps',
            ]) . ' ' . fake()->numerify('##'),
            'code' => fake()->unique()->bothify('DEPT-???##'),
            'description' => fake()->optional()->sentence(),
            'parent_department_id' => null,
            'manager_id' => null,
            'head_count' => fake()->numberBetween(0, 50),
            'is_active' => true,
        ];
    }

    public function inactive(): static
    {
        return $this->state(['is_active' => false]);
    }

    public function withParent(Department $parent): static
    {
        return $this->state([
            'parent_department_id' => $parent->id,
            'organization_id' => $parent->organization_id,
        ]);
    }
}
