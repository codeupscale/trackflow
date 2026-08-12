<?php

namespace Database\Factories;

use App\Models\Department;
use App\Models\JobPosting;
use App\Models\Organization;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<JobPosting> */
class JobPostingFactory extends Factory
{
    protected $model = JobPosting::class;

    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'department_id' => Department::factory(),
            'position_id' => null,
            'title' => fake()->jobTitle(),
            'employment_type' => fake()->randomElement(['full_time', 'part_time', 'contract', 'intern']),
            'work_mode' => fake()->randomElement(['on_site', 'remote', 'hybrid']),
            'location' => fake()->city().', '.fake()->country(),
            'posting_date' => null,
            'start_time' => '09:00:00',
            'end_time' => '18:00:00',
            'min_salary' => null,
            'max_salary' => null,
            'send_salary_via_api' => false,
            'short_description' => fake()->sentence(12),
            'is_published' => false,
        ];
    }

    public function published(): static
    {
        return $this->state(['is_published' => true]);
    }

    /** Published, but dated in the future — must stay off the public feed. */
    public function scheduled(): static
    {
        return $this->state([
            'is_published' => true,
            'posting_date' => now()->addWeek()->toDateString(),
        ]);
    }

    public function withSalaryPublished(?int $min, ?int $max): static
    {
        return $this->state([
            'min_salary' => $min,
            'max_salary' => $max,
            'send_salary_via_api' => true,
        ]);
    }
}
