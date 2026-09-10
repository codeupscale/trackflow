<?php

namespace Tests\Feature\Hr;

use App\Models\PayrollPeriod;
use App\Models\Payslip;
use App\Services\PayrollService;
use Tests\TestCase;

class PayslipLineEditTest extends TestCase
{
    private function payslipFor($user): Payslip
    {
        $period = PayrollPeriod::factory()->create(['organization_id' => $user->organization_id]);

        return Payslip::factory()->create([
            'organization_id' => $user->organization_id,
            'user_id' => $this->createUser($user->organization, 'employee')->id,
            'payroll_period_id' => $period->id,
        ]);
    }

    /**
     * The running total after each change, built up one line at a time — the
     * way an HR user actually edits a payslip.
     */
    public function test_totals_recalculate_as_lines_are_added(): void
    {
        $user = $this->actingAsUser('finance_manager');
        $payslip = $this->payslipFor($user);
        $service = app(PayrollService::class);

        $steps = [
            [
                'what' => 'basic salary only',
                'lines' => [
                    ['label' => 'Basic Salary', 'category' => 'basic', 'amount' => 150000],
                ],
                'gross' => 150000, 'allowances' => 0, 'deductions' => 0, 'net' => 150000,
            ],
            [
                'what' => 'plus a 10,000 allowance',
                'lines' => [
                    ['label' => 'Basic Salary', 'category' => 'basic', 'amount' => 150000],
                    ['label' => 'Medical Allowance', 'category' => 'allowance', 'amount' => 10000],
                ],
                'gross' => 160000, 'allowances' => 10000, 'deductions' => 0, 'net' => 160000,
            ],
            [
                'what' => 'plus a 25,000 bonus',
                'lines' => [
                    ['label' => 'Basic Salary', 'category' => 'basic', 'amount' => 150000],
                    ['label' => 'Medical Allowance', 'category' => 'allowance', 'amount' => 10000],
                    ['label' => 'Performance Bonus', 'category' => 'bonus', 'amount' => 25000],
                ],
                'gross' => 185000, 'allowances' => 35000, 'deductions' => 0, 'net' => 185000,
            ],
            [
                'what' => 'less 18,500 tax',
                'lines' => [
                    ['label' => 'Basic Salary', 'category' => 'basic', 'amount' => 150000],
                    ['label' => 'Medical Allowance', 'category' => 'allowance', 'amount' => 10000],
                    ['label' => 'Performance Bonus', 'category' => 'bonus', 'amount' => 25000],
                    ['label' => 'Income Tax', 'category' => 'tax', 'amount' => 18500],
                ],
                'gross' => 185000, 'allowances' => 35000, 'deductions' => 18500, 'net' => 166500,
            ],
            [
                'what' => 'less a 5,000 loan repayment',
                'lines' => [
                    ['label' => 'Basic Salary', 'category' => 'basic', 'amount' => 150000],
                    ['label' => 'Medical Allowance', 'category' => 'allowance', 'amount' => 10000],
                    ['label' => 'Performance Bonus', 'category' => 'bonus', 'amount' => 25000],
                    ['label' => 'Income Tax', 'category' => 'tax', 'amount' => 18500],
                    ['label' => 'Loan Deduction', 'category' => 'deduction', 'amount' => 5000],
                ],
                'gross' => 185000, 'allowances' => 35000, 'deductions' => 23500, 'net' => 161500,
            ],
            [
                'what' => 'plus overtime, which is an earning',
                'lines' => [
                    ['label' => 'Basic Salary', 'category' => 'basic', 'amount' => 150000],
                    ['label' => 'Medical Allowance', 'category' => 'allowance', 'amount' => 10000],
                    ['label' => 'Performance Bonus', 'category' => 'bonus', 'amount' => 25000],
                    ['label' => 'Over Time', 'category' => 'overtime', 'amount' => 12000],
                    ['label' => 'Income Tax', 'category' => 'tax', 'amount' => 18500],
                    ['label' => 'Loan Deduction', 'category' => 'deduction', 'amount' => 5000],
                ],
                'gross' => 197000, 'allowances' => 47000, 'deductions' => 23500, 'net' => 173500,
            ],
        ];

        foreach ($steps as $step) {
            $result = $service->updatePayslipLines($payslip->id, $step['lines'], $user);

            $this->assertEquals($step['gross'], (float) $result->gross_salary, "gross after {$step['what']}");
            // Allowances = every earning that is not base pay. Counting basic
            // here would double the salary in anything that adds gross and
            // allowances together.
            $this->assertEquals($step['allowances'], (float) $result->total_allowances, "allowances after {$step['what']}");
            $this->assertEquals($step['deductions'], (float) $result->total_deductions, "deductions after {$step['what']}");
            $this->assertEquals($step['net'], (float) $result->net_salary, "net after {$step['what']}");

            // Net is always the two totals subtracted — asserted separately so
            // a change that keeps net right by accident still fails.
            $this->assertEquals(
                (float) $result->gross_salary - (float) $result->total_deductions,
                (float) $result->net_salary,
                "net must equal gross minus deductions after {$step['what']}",
            );
        }
    }

    public function test_decimal_amounts_are_summed_exactly(): void
    {
        $user = $this->actingAsUser('finance_manager');
        $payslip = $this->payslipFor($user);

        $result = app(PayrollService::class)->updatePayslipLines($payslip->id, [
            ['label' => 'Basic Salary', 'category' => 'basic', 'amount' => 150000.55],
            ['label' => 'Allowance', 'category' => 'allowance', 'amount' => 999.45],
            ['label' => 'Tax', 'category' => 'tax', 'amount' => 1000.33],
        ], $user);

        $this->assertEquals(151000.00, (float) $result->gross_salary);
        $this->assertEquals(1000.33, (float) $result->total_deductions);
        $this->assertEquals(149999.67, (float) $result->net_salary);
    }

    public function test_removing_every_line_zeroes_the_payslip(): void
    {
        $user = $this->actingAsUser('finance_manager');
        $payslip = $this->payslipFor($user);
        $service = app(PayrollService::class);

        $service->updatePayslipLines($payslip->id, [
            ['label' => 'Basic Salary', 'category' => 'basic', 'amount' => 150000],
        ], $user);

        $result = $service->updatePayslipLines($payslip->id, [], $user);

        $this->assertEquals(0, (float) $result->gross_salary);
        $this->assertEquals(0, (float) $result->net_salary);
        $this->assertCount(0, $result->lineItems);
    }

    /**
     * A category change moves the line to the other side of the payslip, and
     * `type` has to follow it — every reader that predates categories still
     * filters on type.
     */
    public function test_changing_a_category_moves_the_line_and_its_type(): void
    {
        $user = $this->actingAsUser('finance_manager');
        $payslip = $this->payslipFor($user);
        $service = app(PayrollService::class);

        $asBonus = $service->updatePayslipLines($payslip->id, [
            ['label' => 'Basic Salary', 'category' => 'basic', 'amount' => 100000],
            ['label' => 'Adjustment', 'category' => 'bonus', 'amount' => 5000],
        ], $user);

        $this->assertEquals(105000, (float) $asBonus->gross_salary);
        $this->assertEquals(105000, (float) $asBonus->net_salary);
        $this->assertSame('earning', $asBonus->lineItems->firstWhere('label', 'Adjustment')->type);

        $asDeduction = $service->updatePayslipLines($payslip->id, [
            ['label' => 'Basic Salary', 'category' => 'basic', 'amount' => 100000],
            ['label' => 'Adjustment', 'category' => 'deduction', 'amount' => 5000],
        ], $user);

        $this->assertEquals(100000, (float) $asDeduction->gross_salary);
        $this->assertEquals(5000, (float) $asDeduction->total_deductions);
        $this->assertEquals(95000, (float) $asDeduction->net_salary);
        $this->assertSame('deduction', $asDeduction->lineItems->firstWhere('label', 'Adjustment')->type);
    }
}
