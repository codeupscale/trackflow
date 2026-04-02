<?php

namespace Database\Factories;

use App\Models\Organization;
use App\Models\Shift;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\Shift>
 */
class ShiftFactory extends Factory
{
    protected $model = Shift::class;

    public function definition(): array
    {
        $shifts = [
            ['name' => 'Morning Shift', 'start' => '06:00:00', 'end' => '14:00:00'],
            ['name' => 'Day Shift', 'start' => '09:00:00', 'end' => '17:00:00'],
            ['name' => 'Afternoon Shift', 'start' => '14:00:00', 'end' => '22:00:00'],
            ['name' => 'Night Shift', 'start' => '22:00:00', 'end' => '06:00:00'],
            ['name' => 'Flexible Hours', 'start' => '08:00:00', 'end' => '16:00:00'],
        ];

        $shift = fake()->randomElement($shifts);

        $allDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        $weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

        return [
            'organization_id' => Organization::factory(),
            'name' => $shift['name'],
            'start_time' => $shift['start'],
            'end_time' => $shift['end'],
            'days_of_week' => fake()->boolean(70) ? $weekdays : fake()->randomElements($allDays, fake()->numberBetween(3, 7)),
            'is_active' => true,
            'break_minutes' => fake()->randomElement([0, 15, 30, 60]),
            'color' => fake()->hexColor(),
            'timezone' => 'UTC',
            'grace_period_minutes' => fake()->randomElement([0, 5, 10, 15]),
            'description' => fake()->optional()->sentence(),
        ];
    }

    public function weekdays(): static
    {
        return $this->state(fn (array $attributes) => [
            'days_of_week' => ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        ]);
    }

    public function allWeek(): static
    {
        return $this->state(fn (array $attributes) => [
            'days_of_week' => ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
        ]);
    }

    public function inactive(): static
    {
        return $this->state(fn (array $attributes) => [
            'is_active' => false,
        ]);
    }
}
