<?php

namespace Tests\Feature\Hr;

use App\Models\EmployeeSalaryAssignment;
use App\Models\PayrollPeriod;
use App\Models\Payslip;
use App\Models\SalaryStructure;
use App\Services\PayrollService;
use Tests\TestCase;

/**
 * What a change to a salary structure does to payroll.
 *
 * The answer differs by state on purpose: a DRAFT payslip is a proposal and
 * should follow the current salary, while an APPROVED or PAID one is a record
 * of what was actually paid and must not move under anyone.
 */
class SalaryStructureChangeTest extends TestCase
{
    public function test_a_raise_reaches_the_next_run(): void
    {
        $user = $this->actingAsUser('finance_manager');
        $employee = $this->createUser($user->organization, 'employee');
        $service = app(PayrollService::class);

        $structure = SalaryStructure::factory()->create([
            'organization_id' => $user->organization_id,
            'base_salary' => 100000,
        ]);

        foreach ([$user, $employee] as $person) {
            EmployeeSalaryAssignment::factory()->create([
                'organization_id' => $user->organization_id,
                'user_id' => $person->id,
                'salary_structure_id' => $structure->id,
                'effective_from' => now()->subYear(),
            ]);
        }

        $period = PayrollPeriod::factory()->create([
            'organization_id' => $user->organization_id,
            'start_date' => now()->startOfMonth(),
            'end_date' => now()->endOfMonth(),
        ]);

        $service->runPayroll($period->id);

        $before = Payslip::where('payroll_period_id', $period->id)
            ->where('user_id', $employee->id)->first();
        $this->assertEquals(100000, (float) $before->gross_salary);

        // The raise.
        $service->updateSalaryStructure($structure->id, ['base_salary' => 120000]);

        // Re-running the still-draft period picks it up.
        $service->runPayroll($period->id);

        $after = Payslip::where('payroll_period_id', $period->id)
            ->where('user_id', $employee->id)->first();
        $this->assertEquals(120000, (float) $after->gross_salary);
        $this->assertEquals(120000, (float) $after->net_salary);
    }

    public function test_an_approved_payslip_is_not_moved_by_a_later_raise(): void
    {
        $user = $this->actingAsUser('finance_manager');
        $employee = $this->createUser($user->organization, 'employee');
        $service = app(PayrollService::class);

        $structure = SalaryStructure::factory()->create([
            'organization_id' => $user->organization_id,
            'base_salary' => 100000,
        ]);

        foreach ([$user, $employee] as $person) {
            EmployeeSalaryAssignment::factory()->create([
                'organization_id' => $user->organization_id,
                'user_id' => $person->id,
                'salary_structure_id' => $structure->id,
                'effective_from' => now()->subYear(),
            ]);
        }

        $period = PayrollPeriod::factory()->create([
            'organization_id' => $user->organization_id,
            'start_date' => now()->startOfMonth(),
            'end_date' => now()->endOfMonth(),
        ]);

        $service->runPayroll($period->id);
        Payslip::where('payroll_period_id', $period->id)->update(['verified_at' => now()]);
        $service->approvePayroll($period->id, $user);

        $service->updateSalaryStructure($structure->id, ['base_salary' => 150000]);

        $payslip = Payslip::where('payroll_period_id', $period->id)
            ->where('user_id', $employee->id)->first();

        // Still what was approved.
        $this->assertEquals(100000, (float) $payslip->gross_salary);

        // And the period refuses to be run again, so nothing can overwrite it.
        $this->postJson("/api/v1/hr/payroll-periods/{$period->id}/run")->assertStatus(422);

        $this->assertEquals(
            100000,
            (float) $payslip->fresh()->gross_salary,
            'an approved payslip must never change because a structure changed later',
        );
    }

    public function test_a_custom_amount_still_overrides_the_structure(): void
    {
        $user = $this->actingAsUser('finance_manager');
        $employee = $this->createUser($user->organization, 'employee');
        $service = app(PayrollService::class);

        $structure = SalaryStructure::factory()->create([
            'organization_id' => $user->organization_id,
            'base_salary' => 100000,
        ]);

        EmployeeSalaryAssignment::factory()->create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'salary_structure_id' => $structure->id,
            'effective_from' => now()->subYear(),
        ]);

        // This employee was negotiated a figure of their own.
        EmployeeSalaryAssignment::factory()->create([
            'organization_id' => $user->organization_id,
            'user_id' => $employee->id,
            'salary_structure_id' => $structure->id,
            'custom_base_salary' => 175000,
            'effective_from' => now()->subYear(),
        ]);

        $period = PayrollPeriod::factory()->create([
            'organization_id' => $user->organization_id,
            'start_date' => now()->startOfMonth(),
            'end_date' => now()->endOfMonth(),
        ]);

        $service->runPayroll($period->id);
        $this->assertEquals(
            175000,
            (float) Payslip::where('payroll_period_id', $period->id)
                ->where('user_id', $employee->id)->first()->gross_salary,
        );

        // Changing the grade must not disturb someone on a custom amount.
        $service->updateSalaryStructure($structure->id, ['base_salary' => 120000]);
        $service->runPayroll($period->id);

        $this->assertEquals(
            175000,
            (float) Payslip::where('payroll_period_id', $period->id)
                ->where('user_id', $employee->id)->first()->gross_salary,
            'a custom base salary must survive a change to the grade it hangs off',
        );
    }
}
