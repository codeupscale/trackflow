<?php

namespace Database\Factories;

use App\Models\Organization;
use App\Models\PayrollPeriod;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\PayrollPeriod>
 */
class PayrollPeriodFactory extends Factory
{
    protected $model = PayrollPeriod::class;

    public function definition(): array
    {
        $start = now()->startOfMonth();

        return [
            'organization_id' => Organization::factory(),
            'name' => $start->format('F Y'),
            'period_type' => 'monthly',
            'start_date' => $start,
            'end_date' => $start->copy()->endOfMonth(),
            'status' => 'draft',
        ];
    }

    public function approved(): static
    {
        return $this->state(fn () => ['status' => 'approved']);
    }
}
