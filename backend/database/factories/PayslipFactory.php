<?php

namespace Database\Factories;

use App\Models\Organization;
use App\Models\PayrollPeriod;
use App\Models\Payslip;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\Payslip>
 */
class PayslipFactory extends Factory
{
    protected $model = Payslip::class;

    public function definition(): array
    {
        $gross = fake()->randomFloat(2, 5000, 15000);
        $deductions = round($gross * 0.3, 2);
        $allowances = round($gross * 0.1, 2);
        $net = $gross + $allowances - $deductions;

        return [
            'organization_id' => Organization::factory(),
            'user_id' => User::factory(),
            'payroll_period_id' => PayrollPeriod::factory(),
            'gross_salary' => $gross,
            'total_deductions' => $deductions,
            'total_allowances' => $allowances,
            'net_salary' => $net,
            'status' => 'draft',
        ];
    }
}
