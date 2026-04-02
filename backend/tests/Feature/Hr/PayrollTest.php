<?php

namespace Tests\Feature\Hr;

use App\Models\EmployeeSalaryAssignment;
use App\Models\PayComponent;
use App\Models\Payslip;
use App\Models\PayrollPeriod;
use App\Models\SalaryStructure;
use Tests\TestCase;

class PayrollTest extends TestCase
{
    // ─── Salary Structures ─────────────────────────────────────

    public function test_admin_can_list_salary_structures(): void
    {
        $user = $this->actingAsUser('admin');

        SalaryStructure::factory()->count(3)->create([
            'organization_id' => $user->organization_id,
        ]);

        $response = $this->getJson('/api/v1/hr/salary-structures');

        $response->assertOk()
            ->assertJsonStructure([
                'data' => [['id', 'name', 'type', 'base_salary', 'is_active']],
            ]);
    }

    public function test_admin_can_create_salary_structure(): void
    {
        $user = $this->actingAsUser('admin');

        $response = $this->postJson('/api/v1/hr/salary-structures', [
            'name' => 'Senior Engineer',
            'type' => 'monthly',
            'base_salary' => 8000.00,
            'effective_from' => '2026-01-01',
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('data.name', 'Senior Engineer')
            ->assertJsonPath('data.type', 'monthly');

        $this->assertDatabaseHas('salary_structures', [
            'organization_id' => $user->organization_id,
            'name' => 'Senior Engineer',
        ]);
    }

    public function test_create_salary_structure_validates_required_fields(): void
    {
        $this->actingAsUser('admin');

        $response = $this->postJson('/api/v1/hr/salary-structures', []);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['name', 'type', 'base_salary', 'effective_from']);
    }

    public function test_admin_can_update_salary_structure(): void
    {
        $user = $this->actingAsUser('admin');

        $structure = SalaryStructure::factory()->create([
            'organization_id' => $user->organization_id,
            'name' => 'Old Name',
        ]);

        $response = $this->putJson("/api/v1/hr/salary-structures/{$structure->id}", [
            'name' => 'New Name',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.name', 'New Name');
    }

    public function test_admin_can_delete_salary_structure(): void
    {
        $user = $this->actingAsUser('admin');

        $structure = SalaryStructure::factory()->create([
            'organization_id' => $user->organization_id,
        ]);

        $response = $this->deleteJson("/api/v1/hr/salary-structures/{$structure->id}");

        $response->assertNoContent();
        $this->assertSoftDeleted('salary_structures', ['id' => $structure->id]);
    }

    public function test_employee_cannot_access_salary_structures(): void
    {
        $this->actingAsUser('employee');

        $response = $this->getJson('/api/v1/hr/salary-structures');

        $response->assertForbidden();
    }

    // ─── Pay Components ────────────────────────────────────────

    public function test_admin_can_list_pay_components(): void
    {
        $user = $this->actingAsUser('admin');

        PayComponent::factory()->count(2)->create([
            'organization_id' => $user->organization_id,
        ]);

        $response = $this->getJson('/api/v1/hr/pay-components');

        $response->assertOk()
            ->assertJsonStructure(['data' => [['id', 'name', 'type', 'calculation_type', 'value']]]);
    }

    public function test_admin_can_create_pay_component(): void
    {
        $user = $this->actingAsUser('admin');

        $response = $this->postJson('/api/v1/hr/pay-components', [
            'name' => 'Superannuation',
            'type' => 'deduction',
            'calculation_type' => 'percentage',
            'value' => 11.5,
            'is_taxable' => false,
            'is_mandatory' => true,
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('data.name', 'Superannuation');
    }

    public function test_employee_cannot_access_pay_components(): void
    {
        $this->actingAsUser('employee');

        $response = $this->getJson('/api/v1/hr/pay-components');

        $response->assertForbidden();
    }

    // ─── Payroll Periods ───────────────────────────────────────

    public function test_admin_can_create_payroll_period(): void
    {
        $user = $this->actingAsUser('admin');

        $response = $this->postJson('/api/v1/hr/payroll-periods', [
            'name' => 'March 2026',
            'period_type' => 'monthly',
            'start_date' => '2026-03-01',
            'end_date' => '2026-03-31',
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('data.name', 'March 2026')
            ->assertJsonPath('data.status', 'draft');
    }

    public function test_admin_can_only_delete_draft_periods(): void
    {
        $user = $this->actingAsUser('admin');

        $period = PayrollPeriod::factory()->approved()->create([
            'organization_id' => $user->organization_id,
        ]);

        $response = $this->deleteJson("/api/v1/hr/payroll-periods/{$period->id}");

        // Should fail because period is approved, not draft
        $response->assertStatus(500);
    }

    // ─── Payroll Run ───────────────────────────────────────────

    public function test_admin_can_run_payroll(): void
    {
        $user = $this->actingAsUser('admin');

        $period = PayrollPeriod::factory()->create([
            'organization_id' => $user->organization_id,
            'start_date' => '2026-03-01',
            'end_date' => '2026-03-31',
        ]);

        $structure = SalaryStructure::factory()->create([
            'organization_id' => $user->organization_id,
            'base_salary' => 10000,
        ]);

        $employee = $this->createUser($user->organization, 'employee');

        EmployeeSalaryAssignment::factory()->create([
            'organization_id' => $user->organization_id,
            'user_id' => $employee->id,
            'salary_structure_id' => $structure->id,
            'effective_from' => '2026-01-01',
        ]);

        $response = $this->postJson("/api/v1/hr/payroll-periods/{$period->id}/run");

        $response->assertOk()
            ->assertJsonPath('message', 'Payroll run has been queued.');
    }

    // ─── Payroll Approval ──────────────────────────────────────

    public function test_admin_can_approve_payroll_with_payslips(): void
    {
        $user = $this->actingAsUser('admin');

        $period = PayrollPeriod::factory()->create([
            'organization_id' => $user->organization_id,
        ]);

        Payslip::factory()->create([
            'organization_id' => $user->organization_id,
            'payroll_period_id' => $period->id,
            'user_id' => $this->createUser($user->organization, 'employee')->id,
        ]);

        $response = $this->postJson("/api/v1/hr/payroll-periods/{$period->id}/approve");

        $response->assertOk()
            ->assertJsonPath('message', 'Payroll period approved.')
            ->assertJsonPath('data.status', 'approved');
    }

    public function test_cannot_approve_payroll_without_payslips(): void
    {
        $user = $this->actingAsUser('admin');

        $period = PayrollPeriod::factory()->create([
            'organization_id' => $user->organization_id,
        ]);

        $response = $this->postJson("/api/v1/hr/payroll-periods/{$period->id}/approve");

        $response->assertStatus(500);
    }

    // ─── Payslips (Role-Scoped Access) ─────────────────────────

    public function test_employee_can_view_own_payslips(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $otherEmployee = $this->createUser($org, 'employee');

        $period = PayrollPeriod::factory()->create(['organization_id' => $org->id]);

        Payslip::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'payroll_period_id' => $period->id,
        ]);
        Payslip::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $otherEmployee->id,
            'payroll_period_id' => $period->id,
        ]);

        $this->actingAs($employee, 'sanctum');

        $response = $this->getJson('/api/v1/hr/payslips');

        $response->assertOk();

        // Employee should only see their own payslip, not the other employee's
        $payslips = $response->json('data');
        foreach ($payslips as $payslip) {
            $this->assertEquals($employee->id, $payslip['user_id']);
        }
    }

    public function test_employee_cannot_view_other_employee_payslip(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $otherEmployee = $this->createUser($org, 'employee');

        $period = PayrollPeriod::factory()->create(['organization_id' => $org->id]);

        $otherPayslip = Payslip::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $otherEmployee->id,
            'payroll_period_id' => $period->id,
        ]);

        $this->actingAs($employee, 'sanctum');

        $response = $this->getJson("/api/v1/hr/payslips/{$otherPayslip->id}");

        $response->assertForbidden();
    }

    public function test_admin_can_view_all_payslips(): void
    {
        $user = $this->actingAsUser('admin');

        $period = PayrollPeriod::factory()->create(['organization_id' => $user->organization_id]);

        Payslip::factory()->count(3)->create([
            'organization_id' => $user->organization_id,
            'payroll_period_id' => $period->id,
        ]);

        $response = $this->getJson('/api/v1/hr/payslips');

        $response->assertOk();
        $this->assertCount(3, $response->json('data'));
    }

    // ─── Employee Salary Assignment ────────────────────────────

    public function test_admin_can_assign_salary_to_employee(): void
    {
        $user = $this->actingAsUser('admin');

        $employee = $this->createUser($user->organization, 'employee');

        $structure = SalaryStructure::factory()->create([
            'organization_id' => $user->organization_id,
        ]);

        $response = $this->postJson("/api/v1/hr/employees/{$employee->id}/salary", [
            'salary_structure_id' => $structure->id,
            'effective_from' => '2026-01-01',
        ]);

        $response->assertStatus(201);

        $this->assertDatabaseHas('employee_salary_assignments', [
            'user_id' => $employee->id,
            'salary_structure_id' => $structure->id,
        ]);
    }

    // ─── Cross-Org Isolation ───────────────────────────────────

    public function test_cannot_access_other_org_salary_structures(): void
    {
        $user = $this->actingAsUser('admin');

        $otherOrg = $this->createOrganization();
        $otherStructure = SalaryStructure::factory()->create([
            'organization_id' => $otherOrg->id,
        ]);

        $response = $this->getJson("/api/v1/hr/salary-structures/{$otherStructure->id}");

        $response->assertNotFound();
    }

    public function test_cannot_access_other_org_payslips(): void
    {
        $user = $this->actingAsUser('admin');

        $otherOrg = $this->createOrganization();
        $otherPeriod = PayrollPeriod::factory()->create(['organization_id' => $otherOrg->id]);
        $otherPayslip = Payslip::factory()->create([
            'organization_id' => $otherOrg->id,
            'payroll_period_id' => $otherPeriod->id,
        ]);

        $response = $this->getJson("/api/v1/hr/payslips/{$otherPayslip->id}");

        $response->assertNotFound();
    }
}
