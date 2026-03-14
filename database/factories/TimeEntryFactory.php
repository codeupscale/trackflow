<?php

namespace Database\Factories;

use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\TimeEntry>
 */
class TimeEntryFactory extends Factory
{
    protected $model = TimeEntry::class;

    public function definition(): array
    {
        $startedAt = fake()->dateTimeBetween('-30 days', 'now');
        $durationSeconds = fake()->numberBetween(300, 28800); // 5 min to 8 hours
        $endedAt = fake()->optional(0.8)->passthrough(
            (clone $startedAt)->modify("+{$durationSeconds} seconds")
        );

        return [
            'organization_id' => Organization::factory(),
            'user_id' => User::factory(),
            'project_id' => fake()->optional(0.8)->passthrough(Project::factory()),
            'task_id' => fake()->optional(0.5)->passthrough(Task::factory()),
            'started_at' => $startedAt,
            'ended_at' => $endedAt,
            'duration_seconds' => $endedAt ? $durationSeconds : null,
            'type' => fake()->randomElement(['tracked', 'manual', 'idle']),
            'activity_score' => fake()->optional(0.7)->numberBetween(0, 100),
            'notes' => fake()->optional(0.3)->sentence(),
            'is_approved' => fake()->boolean(60),
        ];
    }

    public function tracked(): static
    {
        return $this->state(fn (array $attributes) => [
            'type' => 'tracked',
        ]);
    }

    public function manual(): static
    {
        return $this->state(fn (array $attributes) => [
            'type' => 'manual',
        ]);
    }

    public function idle(): static
    {
        return $this->state(fn (array $attributes) => [
            'type' => 'idle',
        ]);
    }

    public function running(): static
    {
        return $this->state(fn (array $attributes) => [
            'started_at' => now()->subMinutes(fake()->numberBetween(5, 120)),
            'ended_at' => null,
            'duration_seconds' => null,
        ]);
    }

    public function approved(): static
    {
        return $this->state(fn (array $attributes) => [
            'is_approved' => true,
        ]);
    }
}
