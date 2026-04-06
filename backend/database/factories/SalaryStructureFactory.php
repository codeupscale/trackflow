<?php

namespace Database\Factories;

use App\Models\Organization;
use App\Models\SalaryStructure;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\SalaryStructure>
 */
class SalaryStructureFactory extends Factory
{
    protected $model = SalaryStructure::class;

    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'name' => fake()->randomElement(['Junior', 'Mid-Level', 'Senior', 'Lead', 'Principal']) . ' ' . fake()->randomElement(['Engineer', 'Designer', 'Manager', 'Analyst']),
            'description' => fake()->optional()->sentence(),
            'type' => fake()->randomElement(['monthly', 'hourly', 'daily']),
            'base_salary' => fake()->randomFloat(2, 3000, 15000),
            'currency' => 'AUD',
            'is_active' => true,
            'effective_from' => now()->startOfYear(),
            'effective_to' => null,
        ];
    }

    public function inactive(): static
    {
        return $this->state(fn () => ['is_active' => false]);
    }
}
