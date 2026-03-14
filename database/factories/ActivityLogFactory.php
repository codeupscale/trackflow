<?php

namespace Database\Factories;

use App\Models\ActivityLog;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\ActivityLog>
 */
class ActivityLogFactory extends Factory
{
    protected $model = ActivityLog::class;

    public function definition(): array
    {
        $apps = ['Visual Studio Code', 'Google Chrome', 'Slack', 'Figma', 'Terminal', 'Postman', 'Notion', 'Safari', 'Microsoft Teams', 'PhpStorm'];

        $windowTitles = [
            'app.blade.php - trackflow',
            'Pull Request #42 - GitHub',
            'General - Slack',
            'Dashboard - Figma',
            'zsh - Terminal',
            'API Collection - Postman',
            'Sprint Planning - Notion',
            'Laravel Documentation - Safari',
            'Standup Meeting - Microsoft Teams',
            'UserController.php - PhpStorm',
        ];

        return [
            'organization_id' => Organization::factory(),
            'user_id' => User::factory(),
            'time_entry_id' => TimeEntry::factory(),
            'logged_at' => fake()->dateTimeBetween('-30 days', 'now'),
            'keyboard_events' => fake()->numberBetween(0, 500),
            'mouse_events' => fake()->numberBetween(0, 800),
            'active_app' => fake()->optional(0.85)->randomElement($apps),
            'active_window_title' => fake()->optional(0.8)->randomElement($windowTitles),
            'active_url' => fake()->optional(0.5)->url(),
        ];
    }

    public function highActivity(): static
    {
        return $this->state(fn (array $attributes) => [
            'keyboard_events' => fake()->numberBetween(300, 500),
            'mouse_events' => fake()->numberBetween(500, 800),
        ]);
    }

    public function lowActivity(): static
    {
        return $this->state(fn (array $attributes) => [
            'keyboard_events' => fake()->numberBetween(0, 50),
            'mouse_events' => fake()->numberBetween(0, 80),
        ]);
    }
}
