<?php

namespace Database\Factories;

use App\Models\AttendanceRecord;
use App\Models\Organization;
use App\Models\Shift;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<AttendanceRecord> */
class AttendanceRecordFactory extends Factory
{
    protected $model = AttendanceRecord::class;

    public function definition(): array
    {
        $statuses = ['present', 'absent', 'half_day', 'on_leave', 'holiday', 'weekend'];
        $status = fake()->randomElement($statuses);

        $expectedStart = '09:00:00';
        $expectedEnd = '17:00:00';

        // Generate realistic first_seen/last_seen based on status
        $firstSeen = null;
        $lastSeen = null;
        $totalHours = 0;
        $lateMinutes = 0;
        $earlyDepartureMinutes = 0;
        $overtimeMinutes = 0;

        if (in_array($status, ['present', 'half_day'])) {
            $lateOffset = fake()->randomElement([0, 0, 0, 5, 10, 15, 30]); // most people are on time
            $firstSeen = date('H:i:s', strtotime($expectedStart) + ($lateOffset * 60));
            $lateMinutes = $lateOffset;

            if ($status === 'half_day') {
                $lastSeen = date('H:i:s', strtotime('13:00:00') + (fake()->numberBetween(-30, 30) * 60));
                $totalHours = fake()->randomFloat(2, 3.5, 4.5);
            } else {
                $earlyOffset = fake()->randomElement([0, 0, 0, 0, 5, 10, 15]);
                $overtimeOffset = fake()->randomElement([0, 0, 0, 15, 30, 60, 90]);
                $endTime = strtotime($expectedEnd) - ($earlyOffset * 60) + ($overtimeOffset * 60);
                $lastSeen = date('H:i:s', $endTime);
                $earlyDepartureMinutes = $earlyOffset > 0 && $overtimeOffset === 0 ? $earlyOffset : 0;
                $overtimeMinutes = $overtimeOffset;
                $totalHours = fake()->randomFloat(2, 7.0, 10.0);
            }
        }

        return [
            'organization_id' => Organization::factory(),
            'user_id' => User::factory(),
            'date' => fake()->dateTimeBetween('-30 days', 'now')->format('Y-m-d'),
            'shift_id' => null,
            'expected_start' => $expectedStart,
            'expected_end' => $expectedEnd,
            'first_seen' => $firstSeen,
            'last_seen' => $lastSeen,
            'total_hours' => $totalHours,
            'status' => $status,
            'late_minutes' => $lateMinutes,
            'early_departure_minutes' => $earlyDepartureMinutes,
            'overtime_minutes' => $overtimeMinutes,
            'is_regularized' => false,
            'regularization_note' => null,
        ];
    }

    public function present(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => 'present',
            'first_seen' => '09:02:00',
            'last_seen' => '17:05:00',
            'total_hours' => 8.05,
            'late_minutes' => 2,
            'early_departure_minutes' => 0,
            'overtime_minutes' => 5,
        ]);
    }

    public function absent(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => 'absent',
            'first_seen' => null,
            'last_seen' => null,
            'total_hours' => 0,
            'late_minutes' => 0,
            'early_departure_minutes' => 0,
            'overtime_minutes' => 0,
        ]);
    }

    public function withShift(): static
    {
        return $this->state(fn (array $attributes) => [
            'shift_id' => Shift::factory(),
        ]);
    }
}
