<?php

namespace Database\Factories;

use App\Models\Organization;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

class OrganizationFactory extends Factory
{
    protected $model = Organization::class;

    public function definition(): array
    {
        $name = fake()->company();

        return [
            'name' => $name,
            'slug' => Str::slug($name) . '-' . Str::random(4),
            'plan' => 'trial',
            'trial_ends_at' => now()->addDays(14),
            'settings' => [
                'screenshot_interval' => 5,
                'blur_screenshots' => false,
                'idle_timeout' => 5,
                'timezone' => 'America/New_York',
                'can_add_manual_time' => true,
            ],
        ];
    }

    public function starter(): static
    {
        return $this->state(['plan' => 'starter']);
    }

    public function pro(): static
    {
        return $this->state(['plan' => 'pro']);
    }

    public function enterprise(): static
    {
        return $this->state(['plan' => 'enterprise']);
    }
}
