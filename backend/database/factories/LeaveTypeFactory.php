<?php

namespace Database\Factories;

use App\Models\LeaveType;
use App\Models\Organization;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<LeaveType> */
class LeaveTypeFactory extends Factory
{
    protected $model = LeaveType::class;

    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'name' => fake()->randomElement(['Annual Leave', 'Sick Leave', 'Personal Leave', 'Parental Leave']),
            'code' => fake()->unique()->bothify('LT-???##'),
            'is_paid' => true,
            'days_per_year' => 20.0,
            'accrual_type' => 'upfront',
            'carryover_days' => 5.0,
            'max_consecutive_days' => 10,
            'requires_document' => false,
            'requires_approval' => true,
            'applicable_genders' => 'all',
            'is_active' => true,
        ];
    }
}
