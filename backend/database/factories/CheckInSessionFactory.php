<?php

namespace Database\Factories;

use App\Models\AttendanceRecord;
use App\Models\CheckInSession;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<CheckInSession> */
class CheckInSessionFactory extends Factory
{
    protected $model = CheckInSession::class;

    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'user_id' => User::factory(),
            'attendance_record_id' => AttendanceRecord::factory(),
            'seq' => 1,
            'check_in_at' => now(),
            'check_out_at' => null,
        ];
    }

    /**
     * A completed session with a checkout roughly 8 hours after check-in.
     */
    public function closed(): static
    {
        return $this->state(fn (array $attributes) => [
            'check_out_at' => ($attributes['check_in_at'] ?? now())->copy()->addHours(8),
        ]);
    }
}
