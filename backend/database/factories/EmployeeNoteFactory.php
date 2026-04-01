<?php

namespace Database\Factories;

use App\Models\EmployeeNote;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<EmployeeNote> */
class EmployeeNoteFactory extends Factory
{
    protected $model = EmployeeNote::class;

    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'user_id' => User::factory(),
            'author_id' => User::factory(),
            'content' => fake()->paragraph(),
            'is_confidential' => false,
        ];
    }

    public function confidential(): static
    {
        return $this->state(['is_confidential' => true]);
    }
}
