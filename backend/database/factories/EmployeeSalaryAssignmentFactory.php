<?php

namespace Database\Factories;

use App\Models\EmployeeSalaryAssignment;
use App\Models\Organization;
use App\Models\SalaryStructure;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\EmployeeSalaryAssignment>
 */
class EmployeeSalaryAssignmentFactory extends Factory
{
    protected $model = EmployeeSalaryAssignment::class;

    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'user_id' => User::factory(),
            'salary_structure_id' => SalaryStructure::factory(),
            'custom_base_salary' => null,
            'effective_from' => now()->startOfYear(),
            'effective_to' => null,
        ];
    }
}
