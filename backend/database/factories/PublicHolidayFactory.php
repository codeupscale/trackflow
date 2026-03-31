<?php

namespace Database\Factories;

use App\Models\Organization;
use App\Models\PublicHoliday;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<PublicHoliday> */
class PublicHolidayFactory extends Factory
{
    protected $model = PublicHoliday::class;

    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'name' => fake()->randomElement(['New Year', 'Australia Day', 'Christmas', 'Easter Monday']),
            'date' => fake()->dateTimeBetween('+1 day', '+365 days')->format('Y-m-d'),
            'is_recurring' => false,
        ];
    }
}
