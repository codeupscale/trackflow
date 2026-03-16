<?php

namespace Database\Factories;

use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\Project>
 */
class ProjectFactory extends Factory
{
    protected $model = Project::class;

    public function definition(): array
    {
        return [
            'organization_id' => fn (array $attributes) => User::find($attributes['created_by'])?->organization_id ?? Organization::factory(),
            'created_by' => User::factory(),
            'name' => fake()->catchPhrase(),
            'color' => fake()->hexColor(),
            'billable' => fake()->boolean(70),
            'hourly_rate' => fake()->optional(0.6)->randomFloat(2, 25, 250),
        ];
    }

    public function billable(float $rate = null): static
    {
        return $this->state(fn (array $attributes) => [
            'billable' => true,
            'hourly_rate' => $rate ?? fake()->randomFloat(2, 25, 250),
        ]);
    }

    public function nonBillable(): static
    {
        return $this->state(fn (array $attributes) => [
            'billable' => false,
            'hourly_rate' => null,
        ]);
    }
}
