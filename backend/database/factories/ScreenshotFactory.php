<?php

namespace Database\Factories;

use App\Models\Organization;
use App\Models\Screenshot;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\Screenshot>
 */
class ScreenshotFactory extends Factory
{
    protected $model = Screenshot::class;

    public function definition(): array
    {
        $resolutions = [
            [1920, 1080],
            [2560, 1440],
            [1366, 768],
            [1440, 900],
            [3840, 2160],
        ];

        $resolution = fake()->randomElement($resolutions);

        return [
            'organization_id' => fn (array $attributes) => User::find($attributes['user_id'])?->organization_id ?? Organization::factory(),
            'user_id' => User::factory(),
            'time_entry_id' => TimeEntry::factory(),
            's3_key' => 'screenshots/' . now()->format('Y/m/d') . '/' . Str::uuid() . '.png',
            'captured_at' => fake()->dateTimeBetween('-30 days', 'now'),
            'activity_score_at_capture' => fake()->optional(0.7)->numberBetween(0, 100),
            'is_blurred' => fake()->boolean(15),
            'width' => $resolution[0],
            'height' => $resolution[1],
        ];
    }

    public function blurred(): static
    {
        return $this->state(fn (array $attributes) => [
            'is_blurred' => true,
        ]);
    }

    public function highActivity(): static
    {
        return $this->state(fn (array $attributes) => [
            'activity_score_at_capture' => fake()->numberBetween(75, 100),
        ]);
    }
}
