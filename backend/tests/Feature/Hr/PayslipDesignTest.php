<?php

namespace Tests\Feature\Hr;

use App\Models\Department;
use App\Models\EmployeeProfile;
use App\Models\PayComponent;
use App\Models\PayrollPeriod;
use App\Models\Payslip;
use App\Models\PayslipLineItem;
use App\Models\PayslipTemplate;
use App\Models\Position;
use App\Services\PayslipTemplateService;
use Tests\TestCase;

class PayslipDesignTest extends TestCase
{
    private function service(): PayslipTemplateService
    {
        return app(PayslipTemplateService::class);
    }

    public function test_picker_offers_every_configured_pay_component(): void
    {
        $user = $this->actingAsUser('finance_manager');

        // A design is built BEFORE payroll runs, so a component must be
        // placeable as soon as it is configured — not only after a run has
        // produced a line item for it.
        PayComponent::factory()->create([
            'organization_id' => $user->organization_id,
            'name' => 'Over Time',
            'type' => 'allowance',
        ]);
        PayComponent::factory()->create([
            'organization_id' => $user->organization_id,
            'name' => 'Tax Deduction',
            'type' => 'tax',
        ]);

        $catalogue = $this->service()->imageFieldCatalogue($user->organization_id, 'Acme');

        $earnings = collect($catalogue['Earnings'] ?? [])->pluck('key');
        $deductions = collect($catalogue['Deductions'] ?? [])->pluck('key');

        $this->assertContains('component.over-time', $earnings->all());
        $this->assertContains('component.tax-deduction', $deductions->all());
    }

    public function test_each_employee_resolves_their_own_profile_and_amounts(): void
    {
        $user = $this->actingAsUser('finance_manager');
        $orgId = $user->organization_id;

        $position = Position::factory()->create([
            'organization_id' => $orgId,
            'title' => 'Software Engineer',
        ]);
        $department = Department::factory()->create([
            'organization_id' => $orgId,
            'name' => 'Engineering',
        ]);

        $employee = $this->createUser($user->organization, 'employee');
        EmployeeProfile::factory()->create([
            'organization_id' => $orgId,
            'user_id' => $employee->id,
            'position_id' => $position->id,
            'department_id' => $department->id,
            'employee_id' => 'EMP-0042',
        ]);

        $period = PayrollPeriod::factory()->create(['organization_id' => $orgId]);
        $payslip = Payslip::factory()->create([
            'organization_id' => $orgId,
            'user_id' => $employee->id,
            'payroll_period_id' => $period->id,
            'gross_salary' => 150000,
            'total_deductions' => 5000,
            'net_salary' => 145000,
        ]);
        // No factory for line items — created directly, which is also closer
        // to what runPayroll writes.
        PayslipLineItem::create([
            'payslip_id' => $payslip->id,
            'label' => 'Over Time',
            'type' => 'earning',
            'amount' => 12000,
            'is_taxable' => false,
            'sort_order' => 1,
        ]);

        // The design must REFERENCE the profile fields, or they are not
        // fetched — the extra join is paid for only when something prints it.
        $template = PayslipTemplate::create([
            'organization_id' => $orgId,
            'layout' => 'image',
            'background_image_data_uri' => 'data:image/png;base64,AAAA',
            'field_positions' => [
                ['key' => 'employee.name', 'x' => 10, 'y' => 10],
                ['key' => 'employee.designation', 'x' => 10, 'y' => 14],
                ['key' => 'employee.department', 'x' => 10, 'y' => 18],
                ['key' => 'employee.employee_id', 'x' => 10, 'y' => 22],
                ['key' => 'component.over-time', 'x' => 60, 'y' => 30],
                ['key' => 'pay.net', 'x' => 60, 'y' => 40],
            ],
        ]);

        $values = $this->service()->imageFieldValues(
            $this->service()->renderData($payslip, $template),
        );

        $this->assertSame($employee->name, $values['employee.name']);
        $this->assertSame('Software Engineer', $values['employee.designation']);
        $this->assertSame('Engineering', $values['employee.department']);
        $this->assertSame('EMP-0042', $values['employee.employee_id']);
        $this->assertStringContainsString('12,000.00', $values['component.over-time']);
        $this->assertStringContainsString('145,000.00', $values['pay.net']);
    }

    public function test_every_box_on_a_real_payslip_design_resolves_from_the_employee_record(): void
    {
        $user = $this->actingAsUser('finance_manager');
        $orgId = $user->organization_id;

        $position = Position::factory()->create([
            'organization_id' => $orgId, 'title' => 'Software Engineer',
        ]);
        $department = Department::factory()->create([
            'organization_id' => $orgId, 'name' => 'Engineering',
        ]);

        $employee = $this->createUser($user->organization, 'employee');
        EmployeeProfile::factory()->create([
            'organization_id' => $orgId,
            'user_id' => $employee->id,
            'position_id' => $position->id,
            'department_id' => $department->id,
            'employment_type' => 'full_time',
            'employee_id' => 'CU-101',
            'date_of_joining' => now()->subYears(2)->subMonths(3),
            'tax_id' => '35202-1234567-8',
            'payment_mode' => 'Bank Transfer',
            'bank_name' => 'Meezan Bank',
            'bank_account_title' => 'Muhammad Ali',
            'bank_account_number' => 'PK36MEZN0001234567890123',
        ]);

        $period = PayrollPeriod::factory()->create([
            'organization_id' => $orgId, 'name' => 'September 2026',
        ]);
        $payslip = Payslip::factory()->create([
            'organization_id' => $orgId,
            'user_id' => $employee->id,
            'payroll_period_id' => $period->id,
            'gross_salary' => 180000,
            'total_deductions' => 22000,
            'net_salary' => 158000,
        ]);

        foreach ([
            ['Basic Salary', 'earning', 150000],
            ['Over Time', 'earning', 20000],
            ['Medical Allowance', 'earning', 10000],
            ['Tax Deduction', 'deduction', 18000],
            ['Loan Deduction', 'deduction', 4000],
        ] as $i => [$label, $type, $amount]) {
            PayslipLineItem::create([
                'payslip_id' => $payslip->id,
                'label' => $label,
                'type' => $type,
                'amount' => $amount,
                'is_taxable' => false,
                'sort_order' => $i,
            ]);
        }

        // Every box on the Code UpScale slip, placed.
        $template = PayslipTemplate::create([
            'organization_id' => $orgId,
            'layout' => 'image',
            'background_image_data_uri' => 'data:image/png;base64,AAAA',
            'field_positions' => collect([
                'employee.name', 'employee.designation', 'employee.department',
                'employee.employment_type', 'employee.cnic', 'employee.date_of_joining',
                'employee.service_period', 'employee.mode_of_payment', 'employee.bank_name',
                'employee.account_title', 'employee.account_number',
                'component.basic-salary', 'component.over-time', 'component.medical-allowance',
                'component.tax-deduction', 'component.loan-deduction',
                'pay.gross', 'pay.deductions', 'pay.net', 'period.name',
            ])->map(fn ($key, $i) => ['key' => $key, 'x' => 30, 'y' => 5 + $i * 4])->all(),
        ]);

        $values = $this->service()->imageFieldValues(
            $this->service()->renderData($payslip, $template),
        );

        $this->assertSame($employee->name, $values['employee.name']);
        $this->assertSame('Software Engineer', $values['employee.designation']);
        $this->assertSame('Engineering', $values['employee.department']);
        $this->assertSame('Full Time', $values['employee.employment_type']);
        $this->assertSame('35202-1234567-8', $values['employee.cnic']);
        $this->assertSame('2 years, 3 months', $values['employee.service_period']);
        $this->assertSame('Bank Transfer', $values['employee.mode_of_payment']);
        $this->assertSame('Meezan Bank', $values['employee.bank_name']);
        // The stored title wins over the employee's display name.
        $this->assertSame('Muhammad Ali', $values['employee.account_title']);
        $this->assertSame('PK36MEZN0001234567890123', $values['employee.account_number']);
        $this->assertSame('September 2026', $values['period.name']);

        foreach ([
            'component.basic-salary' => '150,000.00',
            'component.over-time' => '20,000.00',
            'component.medical-allowance' => '10,000.00',
            'component.tax-deduction' => '18,000.00',
            'component.loan-deduction' => '4,000.00',
            'pay.gross' => '180,000.00',
            'pay.deductions' => '22,000.00',
            'pay.net' => '158,000.00',
        ] as $key => $expected) {
            $this->assertStringContainsString($expected, $values[$key], "{$key} should print {$expected}");
        }

        // A row the employee has no entry for prints nothing rather than a
        // stray zero — the box on the artwork simply stays empty.
        $this->assertArrayNotHasKey('component.performance-bonus', $values);
    }

    public function test_a_field_saved_without_an_alignment_still_renders(): void
    {
        $user = $this->actingAsUser('finance_manager');
        $orgId = $user->organization_id;

        $period = PayrollPeriod::factory()->create(['organization_id' => $orgId]);
        $payslip = Payslip::factory()->create([
            'organization_id' => $orgId,
            'user_id' => $this->createUser($user->organization, 'employee')->id,
            'payroll_period_id' => $period->id,
        ]);

        $template = PayslipTemplate::create([
            'organization_id' => $orgId,
            'layout' => 'image',
            'background_image_data_uri' => 'data:image/png;base64,AAAA',
            // No align, size, bold or colour: every property is optional, and
            // reading one that was never saved used to crash the WHOLE payslip
            // rather than fall back to its default.
            'field_positions' => [
                ['key' => 'employee.name', 'x' => 10, 'y' => 10],
                ['key' => 'custom', 'text' => 'Salary Slip', 'x' => 60, 'y' => 6],
            ],
        ]);

        $data = $this->service()->renderData($payslip, $template);
        $html = view('payslips.image', $data + [
            'field_values' => $this->service()->imageFieldValues($data),
        ])->render();

        $this->assertStringContainsString($payslip->user->name, $html);
        // A custom box prints the org's own text, escaped.
        $this->assertStringContainsString('Salary Slip', $html);
    }

    public function test_custom_text_is_escaped_not_rendered_as_markup(): void
    {
        $user = $this->actingAsUser('finance_manager');
        $orgId = $user->organization_id;

        $period = PayrollPeriod::factory()->create(['organization_id' => $orgId]);
        $payslip = Payslip::factory()->create([
            'organization_id' => $orgId,
            'user_id' => $this->createUser($user->organization, 'employee')->id,
            'payroll_period_id' => $period->id,
        ]);

        $template = PayslipTemplate::create([
            'organization_id' => $orgId,
            'layout' => 'image',
            'background_image_data_uri' => 'data:image/png;base64,AAAA',
            'field_positions' => [
                ['key' => 'custom', 'text' => '<script>alert(1)</script>', 'x' => 10, 'y' => 10],
            ],
        ]);

        $data = $this->service()->renderData($payslip, $template);
        $html = view('payslips.image', $data + [
            'field_values' => $this->service()->imageFieldValues($data),
        ])->render();

        $this->assertStringNotContainsString('<script>', $html);
        $this->assertStringContainsString('&lt;script&gt;', $html);
    }
}
