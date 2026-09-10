<?php

namespace App\Console\Commands;

use App\Models\Department;
use App\Models\EmployeeProfile;
use App\Models\Organization;
use App\Models\PayComponent;
use App\Models\PayrollPeriod;
use App\Models\Position;
use App\Models\SalaryStructure;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Everything the payroll flow needs to be walked end to end, except the
 * salary assignments and the payroll run itself — those are the steps under
 * test, and seeding them would remove the thing being tested.
 *
 * Idempotent: matches on natural keys and updates, so it can be run after a
 * `payroll:reset-test` or a re-seed without duplicating anything.
 *
 * Departments, designations and grades are LINKED, because the automatic
 * assign reads a person's designation and gives them the grade attached to
 * it — an employee whose designation has no grade is reported as skipped
 * rather than assigned, which is a different path through the flow.
 */
class SeedPayrollFixtures extends Command
{
    protected $signature = 'payroll:seed-fixtures {--org= : Organization id. Defaults to the only one.}';

    protected $description = 'Create departments, designations, salary grades, pay components and the current period for payroll testing.';

    /** designation => [department, base salary, band min, band max, code, level] */
    private const ROLES = [
        'Software Engineer' => ['Engineering', 150000, 120000, 180000, 'SWE', 'mid'],
        'Backend Engineer' => ['Engineering', 145000, 120000, 180000, 'BE', 'mid'],
        'QA Engineer' => ['Engineering', 120000, 100000, 150000, 'QA', 'mid'],
        'Product Designer' => ['Design', 140000, 110000, 170000, 'PD', 'mid'],
        'Engineering Manager' => ['Engineering', 250000, 200000, 300000, 'EM', 'manager'],
        'HR Manager' => ['People', 180000, 150000, 220000, 'HRM', 'manager'],
        'Finance Manager' => ['Finance', 190000, 160000, 230000, 'FIN', 'manager'],
        'Founder' => ['Leadership', 350000, 250000, 450000, 'FDR', 'c_level'],
    ];

    /** Which designation each seeded demo account holds. */
    private const ASSIGNMENTS = [
        'owner@acme.com' => 'Founder',
        'manager@acme.com' => 'Engineering Manager',
        'hr@acme.com' => 'HR Manager',
        'finance@acme.com' => 'Finance Manager',
        'alice@acme.com' => 'Software Engineer',
        'bob@acme.com' => 'Product Designer',
        'carol@acme.com' => 'QA Engineer',
        'dave@acme.com' => 'Backend Engineer',
    ];

    /**
     * NONE of these are mandatory. Payroll applies only mandatory components
     * automatically; everything here is added per payslip by a person, which
     * is the owner's decision (2026-09-09). The names match the boxes on the
     * uploaded payslip design, whose field keys are derived from the label.
     */
    private const COMPONENTS = [
        ['Medical Allowance', 'allowance', 'fixed', 10000],
        ['Over Time', 'allowance', 'fixed', 0],
        ['Leave Encashment', 'allowance', 'fixed', 0],
        ['Arrears', 'allowance', 'fixed', 0],
        ['Performance Bonus', 'bonus', 'fixed', 0],
        ['Loan Deduction', 'deduction', 'fixed', 0],
        ['Leave Deduction', 'deduction', 'fixed', 0],
        ['Other Deduction', 'deduction', 'fixed', 0],
        ['Income Tax', 'tax', 'percentage', 10],
    ];

    public function handle(): int
    {
        if (! app()->environment('local', 'testing')) {
            $this->error('Local only — this writes demo fixtures.');

            return self::FAILURE;
        }

        $org = $this->option('org')
            ? Organization::withoutGlobalScopes()->find($this->option('org'))
            : Organization::withoutGlobalScopes()->first();

        if (! $org) {
            $this->error('No organization found. Run `php artisan db:seed` first.');

            return self::FAILURE;
        }

        $this->line("Organization: {$org->name}");

        DB::transaction(function () use ($org) {
            $departments = $this->seedDepartments($org);
            $positions = $this->seedPositions($org, $departments);
            $this->seedGrades($org, $positions);
            $this->seedComponents($org);
            $this->seedProfiles($org, $positions, $departments);
            $this->seedCurrentPeriod($org);
        });

        $this->newLine();
        $this->info('Payroll fixtures ready. Flow to walk at HR → Payroll:');
        $this->line('  Fetch employees → assign salaries → run payroll → verify each → approve → mark paid');
        $this->newLine();
        $this->warn('NOT restored: the uploaded payslip design image. Re-upload it under');
        $this->warn('HR → Payroll → Payslip Design, then the field placements can be restored.');

        return self::SUCCESS;
    }

    /** @return array<string,string> name => id */
    private function seedDepartments(Organization $org): array
    {
        $names = collect(self::ROLES)->pluck(0)->unique();
        $map = [];

        foreach ($names as $name) {
            $map[$name] = Department::withoutGlobalScopes()->updateOrCreate(
                ['organization_id' => $org->id, 'name' => $name],
                ['code' => strtoupper(substr($name, 0, 3)), 'is_active' => true],
            )->id;
        }

        $this->line('  departments:  ' . count($map));

        return $map;
    }

    /** @return array<string,string> title => id */
    private function seedPositions(Organization $org, array $departments): array
    {
        $map = [];

        foreach (self::ROLES as $title => [$department, , , , $code, $level]) {
            $map[$title] = Position::withoutGlobalScopes()->updateOrCreate(
                ['organization_id' => $org->id, 'title' => $title],
                [
                    'department_id' => $departments[$department],
                    // Both NOT NULL, and `code` is uniquely indexed per org.
                    'code' => $code,
                    'level' => $level,
                    'employment_type' => 'full_time',
                    'is_active' => true,
                ],
            )->id;
        }

        $this->line('  designations: ' . count($map));

        return $map;
    }

    private function seedGrades(Organization $org, array $positions): void
    {
        foreach (self::ROLES as $title => [, $base, $min, $max]) {
            SalaryStructure::withoutGlobalScopes()->updateOrCreate(
                ['organization_id' => $org->id, 'name' => "{$title} — Grade"],
                [
                    'type' => 'monthly',
                    'base_salary' => $base,
                    // The org's currency governs display; the column is kept
                    // in step so nothing reads a stale code from it.
                    'currency' => $org->getSetting('currency'),
                    'is_active' => true,
                    'effective_from' => now()->startOfYear()->toDateString(),
                    'position_id' => $positions[$title],
                    'min_salary' => $min,
                    'max_salary' => $max,
                ],
            );
        }

        $this->line('  salary grades: ' . count(self::ROLES) . ' (each linked to a designation)');
    }

    private function seedComponents(Organization $org): void
    {
        foreach (self::COMPONENTS as [$name, $type, $calc, $value]) {
            PayComponent::withoutGlobalScopes()->updateOrCreate(
                ['organization_id' => $org->id, 'name' => $name],
                [
                    'type' => $type,
                    'calculation_type' => $calc,
                    'value' => $value,
                    'is_taxable' => $type === 'allowance',
                    'is_mandatory' => false,
                    'applies_to' => 'all',
                ],
            );
        }

        $this->line('  pay components: ' . count(self::COMPONENTS) . ' (none mandatory — added per payslip by hand)');
    }

    private function seedProfiles(Organization $org, array $positions, array $departments): void
    {
        $count = 0;

        foreach (self::ASSIGNMENTS as $email => $title) {
            $user = User::withoutGlobalScopes()
                ->where('organization_id', $org->id)
                ->where('email', $email)
                ->first();

            if (! $user) {
                continue;
            }

            [$department] = self::ROLES[$title];

            EmployeeProfile::withoutGlobalScopes()->updateOrCreate(
                ['organization_id' => $org->id, 'user_id' => $user->id],
                [
                    'employee_id' => 'EMP-' . str_pad((string) (++$count), 4, '0', STR_PAD_LEFT),
                    'department_id' => $departments[$department],
                    'position_id' => $positions[$title],
                    'employment_status' => 'active',
                    'employment_type' => 'full_time',
                    'date_of_joining' => '2022-03-14',
                    'work_location' => 'Lahore',
                    'nationality' => 'Pakistani',
                    // Every field the payslip design prints, so no box on it
                    // renders blank during a test run.
                    'payment_mode' => 'Bank Transfer',
                    'bank_name' => 'Meezan Bank',
                    'bank_account_title' => $user->name,
                    'bank_account_number' => 'PK36MEZN000123456789010' . $count,
                    'tax_id' => '35202-1234567-' . $count,
                ],
            );

            // The payslip reads the designation from the profile's position and
            // falls back to job_title, so both are set.
            $user->forceFill(['job_title' => $title])->save();
        }

        $this->line("  employee profiles: {$count} (designation, bank and CNIC filled)");
    }

    private function seedCurrentPeriod(Organization $org): void
    {
        $start = now()->startOfMonth();

        PayrollPeriod::withoutGlobalScopes()->updateOrCreate(
            ['organization_id' => $org->id, 'start_date' => $start->toDateString()],
            [
                'name' => $start->format('F Y'),
                'period_type' => 'monthly',
                'end_date' => $start->copy()->endOfMonth()->toDateString(),
                'status' => 'draft',
            ],
        );

        $this->line('  payroll period: ' . $start->format('F Y') . ' (draft, not run)');
    }
}
