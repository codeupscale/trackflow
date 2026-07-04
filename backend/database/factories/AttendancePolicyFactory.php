<?php

namespace Database\Factories;

use App\Models\AttendancePolicy;
use App\Models\Organization;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<AttendancePolicy> */
class AttendancePolicyFactory extends Factory
{
    protected $model = AttendancePolicy::class;

    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'check_in_time' => '11:30:00',
            'late_threshold' => '11:45:00',
            'checkout_time' => '20:30:00',
            'timezone' => 'Asia/Karachi',
            'allow_early_check_in' => false,
            'is_active' => true,
        ];
    }

    public function inactive(): static
    {
        return $this->state(fn (array $attributes) => [
            'is_active' => false,
        ]);
    }

    public function allowsEarlyCheckIn(): static
    {
        return $this->state(fn (array $attributes) => [
            'allow_early_check_in' => true,
        ]);
    }
}
