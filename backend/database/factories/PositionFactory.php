<?php

namespace Database\Factories;

use App\Models\Department;
use App\Models\Organization;
use App\Models\Position;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Position> */
class PositionFactory extends Factory
{
    protected $model = Position::class;

    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'department_id' => Department::factory(),
            'title' => fake()->jobTitle(),
            'code' => fake()->unique()->bothify('POS-???##'),
            'level' => fake()->randomElement(['junior', 'mid', 'senior', 'lead', 'manager', 'director', 'vp', 'c_level']),
            'employment_type' => fake()->randomElement(['full_time', 'part_time', 'contract', 'intern']),
            'min_salary' => null,
            'max_salary' => null,
            'is_active' => true,
        ];
    }

    public function inactive(): static
    {
        return $this->state(['is_active' => false]);
    }
}
