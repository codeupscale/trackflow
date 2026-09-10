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
        $user = $this->actingAsUser('finance_manager');

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
        $user = $this->actingAsUser('finance_manager');

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
        $this->actingAsUser('finance_manager');

        $response = $this->postJson('/api/v1/hr/salary-structures', []);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['name', 'type', 'base_salary', 'effective_from']);
    }

    public function test_admin_can_update_salary_structure(): void
    {
        $user = $this->actingAsUser('finance_manager');

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
        $user = $this->actingAsUser('finance_manager');

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
        $user = $this->actingAsUser('finance_manager');

        PayComponent::factory()->count(2)->create([
            'organization_id' => $user->organization_id,
        ]);

        $response = $this->getJson('/api/v1/hr/pay-components');

        $response->assertOk()
            ->assertJsonStructure(['data' => [['id', 'name', 'type', 'calculation_type', 'value']]]);
    }

    public function test_admin_can_create_pay_component(): void
    {
        $user = $this->actingAsUser('finance_manager');

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
        $user = $this->actingAsUser('finance_manager');

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
        $user = $this->actingAsUser('finance_manager');

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
        $user = $this->actingAsUser('finance_manager');

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

        // The acting admin is an employee of the org too. A run is refused
        // while ANYONE active lacks a salary, so both need one here.
        foreach ([$employee, $user] as $person) {
            EmployeeSalaryAssignment::factory()->create([
                'organization_id' => $user->organization_id,
                'user_id' => $person->id,
                'salary_structure_id' => $structure->id,
                'effective_from' => '2026-01-01',
            ]);
        }

        $response = $this->postJson("/api/v1/hr/payroll-periods/{$period->id}/run");

        $response->assertOk()
            ->assertJsonPath('message', 'Payroll run has been queued.');
    }

    public function test_run_is_refused_while_an_employee_has_no_salary(): void
    {
        $user = $this->actingAsUser('finance_manager');
        $withSalary = $this->createUser($user->organization, 'employee');
        $withoutSalary = $this->createUser($user->organization, 'employee');

        $period = PayrollPeriod::factory()->create([
            'organization_id' => $user->organization_id,
            'start_date' => '2026-09-01',
            'end_date' => '2026-09-30',
        ]);

        $structure = SalaryStructure::factory()->create([
            'organization_id' => $user->organization_id,
        ]);

        EmployeeSalaryAssignment::factory()->create([
            'organization_id' => $user->organization_id,
            'user_id' => $withSalary->id,
            'salary_structure_id' => $structure->id,
            'effective_from' => '2026-09-01',
            'effective_to' => null,
        ]);

        // Refused, and the refusal names who is missing — "2 employees have no
        // salary" would send someone hunting through a roster to find out who.
        $response = $this->postJson("/api/v1/hr/payroll-periods/{$period->id}/run")
            ->assertStatus(422);

        $message = $response->json('error.message');
        $this->assertStringContainsString($withoutSalary->name, $message);
        $this->assertStringContainsString('Assign salaries before running payroll', $message);
        $this->assertStringNotContainsString($withSalary->name, $message);

        // Nothing was produced by a refused run.
        $this->assertDatabaseCount('payslips', 0);
    }

    public function test_run_proceeds_once_every_employee_has_a_salary(): void
    {
        $user = $this->actingAsUser('finance_manager');
        $employee = $this->createUser($user->organization, 'employee');

        $period = PayrollPeriod::factory()->create([
            'organization_id' => $user->organization_id,
            'start_date' => '2026-09-01',
            'end_date' => '2026-09-30',
        ]);

        $structure = SalaryStructure::factory()->create([
            'organization_id' => $user->organization_id,
        ]);

        // The actor is an employee of the org too, so they need a salary for
        // the period to be complete.
        foreach ([$user, $employee] as $person) {
            EmployeeSalaryAssignment::factory()->create([
                'organization_id' => $user->organization_id,
                'user_id' => $person->id,
                'salary_structure_id' => $structure->id,
                'effective_from' => '2026-09-01',
                'effective_to' => null,
            ]);
        }

        $this->postJson("/api/v1/hr/payroll-periods/{$period->id}/run")
            ->assertOk()
            ->assertJsonPath('message', 'Payroll run has been queued.');
    }

    public function test_bulk_assign_covers_many_employees_and_ignores_other_orgs(): void
    {
        $user = $this->actingAsUser('finance_manager');
        $a = $this->createUser($user->organization, 'employee');
        $b = $this->createUser($user->organization, 'employee');

        $otherOrg = $this->createOrganization();
        $outsider = $this->createUser($otherOrg, 'employee');

        $structure = SalaryStructure::factory()->create([
            'organization_id' => $user->organization_id,
        ]);

        $this->postJson('/api/v1/hr/salary-roster/bulk-assign', [
            'user_ids' => [$a->id, $b->id, $outsider->id],
            'salary_structure_id' => $structure->id,
            'effective_from' => '2026-09-01',
        ])->assertStatus(422)
            // Keyed by the offending ELEMENT — the outsider is index 2 — which
            // is how Laravel reports per-item rules on an array.
            ->assertJsonValidationErrors([
                'user_ids.2' => 'One of the selected employees is not in your organization.',
            ]);

        // Refused as a whole — no partial write from a request containing a
        // foreign id.
        $this->assertDatabaseCount('employee_salary_assignments', 0);

        $this->postJson('/api/v1/hr/salary-roster/bulk-assign', [
            'user_ids' => [$a->id, $b->id],
            'salary_structure_id' => $structure->id,
            'effective_from' => '2026-09-01',
        ])->assertOk()
            ->assertJsonPath('data.assigned', 2);

        foreach ([$a, $b] as $person) {
            $this->assertDatabaseHas('employee_salary_assignments', [
                'user_id' => $person->id,
                'organization_id' => $user->organization_id,
                'salary_structure_id' => $structure->id,
            ]);
        }

        $this->assertDatabaseMissing('employee_salary_assignments', [
            'user_id' => $outsider->id,
        ]);
    }

    public function test_a_period_cannot_be_run_before_it_starts(): void
    {
        $user = $this->actingAsUser('finance_manager');
        $structure = SalaryStructure::factory()->create(['organization_id' => $user->organization_id]);

        $future = PayrollPeriod::factory()->create([
            'organization_id' => $user->organization_id,
            'name' => 'Next Month',
            'start_date' => now()->addMonth()->startOfMonth(),
            'end_date' => now()->addMonth()->endOfMonth(),
        ]);

        EmployeeSalaryAssignment::factory()->create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'salary_structure_id' => $structure->id,
            'effective_from' => now()->subYear(),
        ]);

        $this->postJson("/api/v1/hr/payroll-periods/{$future->id}/run")
            ->assertStatus(422)
            ->assertJsonPath('error.message', fn ($m) => str_contains($m, 'can only be run once the period has begun'));

        $this->assertDatabaseCount('payslips', 0);

        // The same period, once it has started, runs.
        $future->forceFill([
            'start_date' => now()->startOfMonth(),
            'end_date' => now()->endOfMonth(),
        ])->save();

        $this->postJson("/api/v1/hr/payroll-periods/{$future->id}/run")->assertOk();
    }

    public function test_a_paid_period_cannot_be_run_again(): void
    {
        $user = $this->actingAsUser('finance_manager');

        $period = PayrollPeriod::factory()->create([
            'organization_id' => $user->organization_id,
            'start_date' => now()->startOfMonth(),
            'end_date' => now()->endOfMonth(),
        ]);

        Payslip::factory()->create([
            'organization_id' => $user->organization_id,
            'payroll_period_id' => $period->id,
            'user_id' => $this->createUser($user->organization, 'employee')->id,
            'verified_at' => now(),
        ]);

        $this->postJson("/api/v1/hr/payroll-periods/{$period->id}/approve")->assertOk();
        $this->postJson("/api/v1/hr/payroll-periods/{$period->id}/mark-paid")->assertOk();

        // Re-running a settled period would regenerate payslips people have
        // already been paid against.
        $this->postJson("/api/v1/hr/payroll-periods/{$period->id}/run")
            ->assertStatus(422)
            ->assertJsonPath('error.message', fn ($m) => str_contains($m, 'already been paid'));

        $this->assertDatabaseHas('payroll_periods', ['id' => $period->id, 'status' => 'paid']);
    }

    public function test_an_approved_period_cannot_be_run_again(): void
    {
        $user = $this->actingAsUser('finance_manager');

        $period = PayrollPeriod::factory()->create([
            'organization_id' => $user->organization_id,
            'start_date' => now()->startOfMonth(),
            'end_date' => now()->endOfMonth(),
        ]);

        Payslip::factory()->create([
            'organization_id' => $user->organization_id,
            'payroll_period_id' => $period->id,
            'user_id' => $this->createUser($user->organization, 'employee')->id,
            'verified_at' => now(),
        ]);

        $this->postJson("/api/v1/hr/payroll-periods/{$period->id}/approve")->assertOk();

        $this->postJson("/api/v1/hr/payroll-periods/{$period->id}/run")
            ->assertStatus(422)
            ->assertJsonPath('error.message', fn ($m) => str_contains($m, 'has been approved'));
    }

    // ─── Payroll Approval ──────────────────────────────────────

    public function test_admin_can_approve_payroll_with_payslips(): void
    {
        $user = $this->actingAsUser('finance_manager');

        $period = PayrollPeriod::factory()->create([
            'organization_id' => $user->organization_id,
        ]);

        // Verified: approval is only reachable once every payslip in the
        // period has been reviewed.
        Payslip::factory()->create([
            'organization_id' => $user->organization_id,
            'payroll_period_id' => $period->id,
            'user_id' => $this->createUser($user->organization, 'employee')->id,
            'verified_at' => now(),
        ]);

        $response = $this->postJson("/api/v1/hr/payroll-periods/{$period->id}/approve");

        $response->assertOk()
            ->assertJsonPath('message', 'Payroll period approved.')
            ->assertJsonPath('data.status', 'approved');
    }

    public function test_cannot_approve_payroll_while_a_payslip_is_unverified(): void
    {
        $user = $this->actingAsUser('finance_manager');

        $period = PayrollPeriod::factory()->create([
            'organization_id' => $user->organization_id,
        ]);

        Payslip::factory()->create([
            'organization_id' => $user->organization_id,
            'payroll_period_id' => $period->id,
            'user_id' => $this->createUser($user->organization, 'employee')->id,
            'verified_at' => now(),
        ]);
        Payslip::factory()->create([
            'organization_id' => $user->organization_id,
            'payroll_period_id' => $period->id,
            'user_id' => $this->createUser($user->organization, 'employee')->id,
            'verified_at' => null,
        ]);

        $this->postJson("/api/v1/hr/payroll-periods/{$period->id}/approve")
            ->assertStatus(422)
            // The API's error envelope is {"error": {code, message}} — see the
            // render() handler in bootstrap/app.php.
            ->assertJsonPath('error.message', '1 of 2 payslips have not been sent yet. Review and send each one before approving.');

        // The period must be untouched by a refused approval.
        $this->assertDatabaseHas('payroll_periods', [
            'id' => $period->id,
            'status' => 'draft',
        ]);
    }

    public function test_cannot_approve_payroll_while_a_payslip_is_withdrawn(): void
    {
        $user = $this->actingAsUser('finance_manager');

        $period = PayrollPeriod::factory()->create([
            'organization_id' => $user->organization_id,
        ]);

        Payslip::factory()->create([
            'organization_id' => $user->organization_id,
            'payroll_period_id' => $period->id,
            'user_id' => $this->createUser($user->organization, 'employee')->id,
            'verified_at' => now(),
        ]);
        // Withdrawn: sent, then taken back. verified_at is deliberately KEPT so
        // the audit trail survives, which is exactly why "verified_at is null"
        // was the wrong test for "still to send".
        Payslip::factory()->create([
            'organization_id' => $user->organization_id,
            'payroll_period_id' => $period->id,
            'user_id' => $this->createUser($user->organization, 'employee')->id,
            'verified_at' => now()->subHour(),
            'withdrawn_at' => now(),
            'withdrawn_by' => $user->id,
        ]);

        $this->postJson("/api/v1/hr/payroll-periods/{$period->id}/approve")
            ->assertStatus(422)
            ->assertJsonPath('error.message', '1 of 2 payslips have not been sent yet. Review and send each one before approving.');

        $this->assertDatabaseHas('payroll_periods', [
            'id' => $period->id,
            'status' => 'draft',
        ]);
    }

    public function test_cannot_approve_payroll_without_payslips(): void
    {
        $user = $this->actingAsUser('finance_manager');

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

        // Both VERIFIED: an employee only ever sees released payslips, so a
        // draft here would empty the list and make the scoping assertion below
        // pass without testing anything.
        $own = Payslip::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'payroll_period_id' => $period->id,
            'verified_at' => now(),
        ]);
        Payslip::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $otherEmployee->id,
            'payroll_period_id' => $period->id,
            'verified_at' => now(),
        ]);

        $this->actingAs($employee, 'sanctum');

        $response = $this->getJson('/api/v1/hr/payslips');

        $response->assertOk();

        // Exactly one row, and it is theirs — asserted on the count as well as
        // the contents, so an empty list can never satisfy this test.
        $payslips = $response->json('data');
        $this->assertCount(1, $payslips);
        $this->assertEquals($own->id, $payslips[0]['id']);
        $this->assertEquals($employee->id, $payslips[0]['user_id']);
    }

    public function test_employee_cannot_see_own_payslip_until_it_is_verified(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $period = PayrollPeriod::factory()->create(['organization_id' => $org->id]);

        $payslip = Payslip::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'payroll_period_id' => $period->id,
            'verified_at' => null,
        ]);

        $this->actingAs($employee, 'sanctum');

        $this->getJson('/api/v1/hr/payslips')
            ->assertOk()
            ->assertJsonCount(0, 'data');

        // Not merely hidden from the list: a remembered id must not reach it,
        // and the PDF authorizes through this same lookup.
        $this->getJson("/api/v1/hr/payslips/{$payslip->id}")->assertNotFound();
        $this->getJson("/api/v1/hr/payslips/{$payslip->id}/download")->assertNotFound();
    }

    public function test_verifying_a_payslip_releases_it_to_the_employee(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'owner');
        $employee = $this->createUser($org, 'employee');
        $period = PayrollPeriod::factory()->create(['organization_id' => $org->id]);

        $payslip = Payslip::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'payroll_period_id' => $period->id,
            'verified_at' => null,
        ]);

        $this->actingAs($admin, 'sanctum')
            ->postJson("/api/v1/hr/payslips/{$payslip->id}/verify")
            ->assertOk();

        $this->assertDatabaseHas('payslips', [
            'id' => $payslip->id,
            'verified_by' => $admin->id,
        ]);

        $this->actingAs($employee, 'sanctum')
            ->getJson('/api/v1/hr/payslips')
            ->assertOk()
            ->assertJsonCount(1, 'data');

        // Withdrawing puts it back out of reach.
        $this->actingAs($admin, 'sanctum')
            ->postJson("/api/v1/hr/payslips/{$payslip->id}/unverify")
            ->assertOk();

        $this->actingAs($employee, 'sanctum')
            ->getJson('/api/v1/hr/payslips')
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_employee_cannot_verify_their_own_payslip(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $period = PayrollPeriod::factory()->create(['organization_id' => $org->id]);

        $payslip = Payslip::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'payroll_period_id' => $period->id,
            'verified_at' => null,
        ]);

        $this->actingAs($employee, 'sanctum')
            ->postJson("/api/v1/hr/payslips/{$payslip->id}/verify")
            ->assertForbidden();

        $this->assertDatabaseHas('payslips', [
            'id' => $payslip->id,
            'verified_at' => null,
        ]);
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
        $user = $this->actingAsUser('finance_manager');

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
        $user = $this->actingAsUser('finance_manager');

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
        $user = $this->actingAsUser('finance_manager');

        $otherOrg = $this->createOrganization();
        $otherStructure = SalaryStructure::factory()->create([
            'organization_id' => $otherOrg->id,
        ]);

        $response = $this->getJson("/api/v1/hr/salary-structures/{$otherStructure->id}");

        $response->assertNotFound();
    }

    public function test_cannot_access_other_org_payslips(): void
    {
        $user = $this->actingAsUser('finance_manager');

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
