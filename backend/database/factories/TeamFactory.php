<?php

namespace Database\Factories;

use App\Models\Organization;
use App\Models\Team;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\Team>
 */
class TeamFactory extends Factory
{
    protected $model = Team::class;

    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'name' => fake()->randomElement([
                'Engineering', 'Design', 'Marketing', 'Sales',
                'Support', 'Operations', 'Finance', 'Product',
                'QA', 'DevOps', 'Data Science', 'HR',
            ]) . ' ' . fake()->optional(0.3)->word(),
            'manager_id' => fake()->optional(0.7)->passthrough(User::factory()),
        ];
    }

    public function withManager(): static
    {
        return $this->state(fn (array $attributes) => [
            'manager_id' => User::factory(),
        ]);
    }
}
