<?php

namespace Database\Factories;

use App\Models\Organization;
use App\Models\Shift;
use App\Models\ShiftSwapRequest;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<ShiftSwapRequest> */
class ShiftSwapRequestFactory extends Factory
{
    protected $model = ShiftSwapRequest::class;

    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'requester_id' => User::factory(),
            'target_user_id' => User::factory(),
            'requester_shift_id' => Shift::factory(),
            'target_shift_id' => Shift::factory(),
            'swap_date' => fake()->dateTimeBetween('+1 day', '+30 days')->format('Y-m-d'),
            'reason' => fake()->sentence(),
            'status' => 'pending',
            'reviewed_by' => null,
            'reviewed_at' => null,
            'reviewer_note' => null,
        ];
    }

    public function approved(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => 'approved',
            'reviewed_by' => User::factory(),
            'reviewed_at' => now(),
            'reviewer_note' => 'Swap approved. Both parties confirmed availability.',
        ]);
    }

    public function rejected(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => 'rejected',
            'reviewed_by' => User::factory(),
            'reviewed_at' => now(),
            'reviewer_note' => 'Swap rejected due to staffing constraints.',
        ]);
    }

    public function cancelled(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => 'cancelled',
        ]);
    }
}
