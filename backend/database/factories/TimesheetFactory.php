<?php

namespace Database\Factories;

use App\Models\Organization;
use App\Models\Timesheet;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\Timesheet>
 */
class TimesheetFactory extends Factory
{
    protected $model = Timesheet::class;

    public function definition(): array
    {
        $periodStart = fake()->dateTimeBetween('-60 days', '-7 days');
        $periodEnd = (clone $periodStart)->modify('+6 days');
        $status = fake()->randomElement(['draft', 'submitted', 'approved', 'rejected']);

        return [
            'organization_id' => fn (array $attributes) => User::find($attributes['user_id'])?->organization_id ?? Organization::factory(),
            'user_id' => User::factory(),
            'period_start' => $periodStart->format('Y-m-d'),
            'period_end' => $periodEnd->format('Y-m-d'),
            'total_seconds' => fake()->numberBetween(0, 144000), // up to 40 hours
            'status' => $status,
            'submitted_at' => in_array($status, ['submitted', 'approved', 'rejected'])
                ? fake()->dateTimeBetween($periodEnd, 'now')
                : null,
            'reviewed_by' => in_array($status, ['approved', 'rejected'])
                ? User::factory()
                : null,
            'reviewed_at' => in_array($status, ['approved', 'rejected'])
                ? fake()->dateTimeBetween($periodEnd, 'now')
                : null,
        ];
    }

    public function draft(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => 'draft',
            'submitted_at' => null,
            'reviewed_by' => null,
            'reviewed_at' => null,
        ]);
    }

    public function submitted(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => 'submitted',
            'submitted_at' => now(),
            'reviewed_by' => null,
            'reviewed_at' => null,
        ]);
    }

    public function approved(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => 'approved',
            'submitted_at' => now()->subDays(2),
            'reviewed_by' => User::factory(),
            'reviewed_at' => now(),
        ]);
    }

    public function rejected(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => 'rejected',
            'submitted_at' => now()->subDays(2),
            'reviewed_by' => User::factory(),
            'reviewed_at' => now(),
        ]);
    }
}
