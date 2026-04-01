<?php

namespace Database\Factories;

use App\Models\AttendanceRecord;
use App\Models\AttendanceRegularization;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<AttendanceRegularization> */
class AttendanceRegularizationFactory extends Factory
{
    protected $model = AttendanceRegularization::class;

    public function definition(): array
    {
        $reasons = [
            'Was working remotely, forgot to start the tracker.',
            'Internet outage prevented time tracking for most of the day.',
            'Had an offsite client meeting, could not use desktop app.',
            'System was under maintenance, tracker did not sync.',
            'Was on approved work-from-home but marked as absent.',
            'Attended a team workshop — no desktop tracking available.',
        ];

        return [
            'organization_id' => Organization::factory(),
            'user_id' => User::factory(),
            'attendance_record_id' => AttendanceRecord::factory(),
            'requested_status' => fake()->randomElement(['present', 'half_day']),
            'reason' => fake()->randomElement($reasons),
            'status' => 'pending',
            'reviewed_by' => null,
            'reviewed_at' => null,
            'review_note' => null,
        ];
    }

    public function approved(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => 'approved',
            'reviewed_by' => User::factory(),
            'reviewed_at' => now(),
            'review_note' => 'Verified with team lead. Approved.',
        ]);
    }

    public function rejected(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => 'rejected',
            'reviewed_by' => User::factory(),
            'reviewed_at' => now(),
            'review_note' => 'No evidence of work activity found for the claimed period.',
        ]);
    }
}
