<?php

namespace Database\Factories;

use App\Models\Department;
use App\Models\EmployeeProfile;
use App\Models\Organization;
use App\Models\Position;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<EmployeeProfile> */
class EmployeeProfileFactory extends Factory
{
    protected $model = EmployeeProfile::class;

    public function definition(): array
    {
        $joiningDate = fake()->dateTimeBetween('-5 years', '-3 months');

        return [
            'organization_id' => Organization::factory(),
            'user_id' => User::factory(),
            'employee_id' => fake()->unique()->bothify('EMP-####'),
            'department_id' => null,
            'position_id' => null,
            'reporting_manager_id' => null,
            'employment_status' => fake()->randomElement(['active', 'probation', 'notice_period']),
            'employment_type' => fake()->randomElement(['full_time', 'part_time', 'contract', 'intern']),
            'date_of_joining' => $joiningDate,
            'date_of_confirmation' => fake()->optional(0.7)->dateTimeBetween($joiningDate, 'now'),
            'date_of_exit' => null,
            'probation_end_date' => fake()->optional(0.3)->dateTimeBetween($joiningDate, '+6 months'),
            'blood_group' => fake()->optional()->randomElement(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']),
            'marital_status' => fake()->optional()->randomElement(['single', 'married', 'divorced', 'widowed']),
            'nationality' => fake()->optional()->country(),
            'gender' => fake()->optional()->randomElement(['male', 'female', 'non_binary', 'prefer_not_to_say']),
            'emergency_contact_name' => fake()->optional()->name(),
            'emergency_contact_phone' => fake()->optional()->phoneNumber(),
            'emergency_contact_relation' => fake()->optional()->randomElement(['spouse', 'parent', 'sibling', 'friend']),
            'bank_name' => fake()->optional()->company(),
            'bank_account_number' => fake()->optional()->numerify('####-####-####'),
            'bank_routing_number' => fake()->optional()->numerify('######'),
            'tax_id' => fake()->optional()->numerify('###-##-####'),
            'current_address' => fake()->optional()->address(),
            'permanent_address' => fake()->optional()->address(),
        ];
    }

    public function active(): static
    {
        return $this->state(['employment_status' => 'active']);
    }

    public function onProbation(): static
    {
        return $this->state([
            'employment_status' => 'probation',
            'probation_end_date' => fake()->dateTimeBetween('now', '+6 months'),
        ]);
    }

    public function terminated(): static
    {
        return $this->state([
            'employment_status' => 'terminated',
            'date_of_exit' => fake()->dateTimeBetween('-6 months', 'now'),
        ]);
    }

    public function withDepartment(Department $department): static
    {
        return $this->state([
            'department_id' => $department->id,
            'organization_id' => $department->organization_id,
        ]);
    }

    public function withPosition(Position $position): static
    {
        return $this->state([
            'position_id' => $position->id,
            'organization_id' => $position->organization_id,
        ]);
    }
}
