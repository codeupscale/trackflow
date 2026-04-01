<?php

namespace Database\Factories;

use App\Models\Organization;
use App\Models\OvertimeRule;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<OvertimeRule> */
class OvertimeRuleFactory extends Factory
{
    protected $model = OvertimeRule::class;

    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'daily_threshold_hours' => fake()->randomElement([7.50, 8.00, 9.00]),
            'weekly_threshold_hours' => fake()->randomElement([37.50, 40.00, 45.00]),
            'overtime_multiplier' => fake()->randomElement([1.25, 1.50, 2.00]),
            'weekend_multiplier' => fake()->randomElement([1.50, 2.00, 2.50]),
            'is_active' => true,
        ];
    }

    public function inactive(): static
    {
        return $this->state(fn (array $attributes) => [
            'is_active' => false,
        ]);
    }
}
