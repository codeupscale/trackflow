<?php

namespace App\Services;

use App\Models\EmployeeSalaryAssignment;
use App\Models\PayComponent;
use App\Models\Payslip;
use App\Models\PayslipLineItem;
use App\Models\PayrollPeriod;
use App\Models\SalaryStructure;
use App\Models\User;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;

class PayrollService
{
    public function __construct(
        private readonly PermissionService $permissionService,
    ) {}

    // ─── Salary Structures ─────────────────────────────────────────

    public function getSalaryStructures(array $filters): LengthAwarePaginator
    {
        $query = SalaryStructure::query();

        if (! empty($filters['type'])) {
            $query->where('type', $filters['type']);
        }

        if (isset($filters['is_active'])) {
            $query->where('is_active', (bool) $filters['is_active']);
        }

        return $query->orderByDesc('created_at')
            ->paginate($filters['per_page'] ?? 25);
    }

    public function createSalaryStructure(array $data): SalaryStructure
    {
        return SalaryStructure::create($data);
    }

    public function updateSalaryStructure(string $id, array $data): SalaryStructure
    {
        $structure = SalaryStructure::findOrFail($id);
        $structure->update($data);

        return $structure->fresh();
    }

    public function deleteSalaryStructure(string $id): void
    {
        $structure = SalaryStructure::findOrFail($id);
        $structure->delete();
    }

    // ─── Pay Components ────────────────────────────────────────────

    public function getPayComponents(array $filters): LengthAwarePaginator
    {
        $query = PayComponent::query();

        if (! empty($filters['type'])) {
            $query->where('type', $filters['type']);
        }

        return $query->orderByDesc('created_at')
            ->paginate($filters['per_page'] ?? 25);
    }

    public function createPayComponent(array $data): PayComponent
    {
        return PayComponent::create($data);
    }

    public function updatePayComponent(string $id, array $data): PayComponent
    {
        $component = PayComponent::findOrFail($id);
        $component->update($data);

        return $component->fresh();
    }

    public function deletePayComponent(string $id): void
    {
        $component = PayComponent::findOrFail($id);
        $component->delete();
    }

    // ─── Employee Salary Assignments ───────────────────────────────

    public function getEmployeeSalary(string $userId): ?EmployeeSalaryAssignment
    {
        return EmployeeSalaryAssignment::where('user_id', $userId)
            ->where('effective_from', '<=', now())
            ->where(function ($q) {
                $q->whereNull('effective_to')
                    ->orWhere('effective_to', '>=', now());
            })
            ->with('salaryStructure')
            ->latest('effective_from')
            ->first();
    }

    public function assignSalaryToEmployee(string $userId, array $data): EmployeeSalaryAssignment
    {
        return EmployeeSalaryAssignment::create(array_merge($data, [
            'user_id' => $userId,
        ]));
    }

    // ─── Payroll Periods ───────────────────────────────────────────

    public function getPayrollPeriods(array $filters): LengthAwarePaginator
    {
        $query = PayrollPeriod::with('approver:id,name,email');

        if (! empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }

        return $query->orderByDesc('start_date')
            ->paginate($filters['per_page'] ?? 25);
    }

    public function createPayrollPeriod(array $data): PayrollPeriod
    {
        return PayrollPeriod::create(array_merge(['status' => 'draft'], $data));
    }

    public function updatePayrollPeriod(string $id, array $data): PayrollPeriod
    {
        $period = PayrollPeriod::findOrFail($id);

        if ($period->status !== 'draft') {
            throw new \RuntimeException('Only draft payroll periods can be edited.');
        }

        $period->update($data);

        return $period->fresh();
    }

    public function deletePayrollPeriod(string $id): void
    {
        $period = PayrollPeriod::findOrFail($id);

        if ($period->status !== 'draft') {
            throw new \RuntimeException('Only draft payroll periods can be deleted.');
        }

        $period->delete();
    }

    // ─── Payroll Run ───────────────────────────────────────────────

    /**
     * Run payroll for a given period. Creates payslips + line items for every
     * employee with an active salary assignment.
     *
     * This method runs inside a DB transaction.  For large orgs the caller
     * should dispatch RunPayrollJob instead of calling this directly.
     */
    public function runPayroll(string $periodId): PayrollPeriod
    {
        $period = PayrollPeriod::findOrFail($periodId);

        if (! in_array($period->status, ['draft', 'processing'])) {
            throw new \RuntimeException('Payroll can only be run on draft or processing periods.');
        }

        return DB::transaction(function () use ($period) {
            $period->update(['status' => 'processing', 'processed_at' => now()]);

            $orgId = $period->organization_id;

            // Get all mandatory pay components for this org
            $mandatoryComponents = PayComponent::where('organization_id', $orgId)
                ->where('is_mandatory', true)
                ->get();

            // Process employees in chunks to avoid memory issues
            EmployeeSalaryAssignment::where('organization_id', $orgId)
                ->where('effective_from', '<=', $period->end_date)
                ->where(function ($q) use ($period) {
                    $q->whereNull('effective_to')
                        ->orWhere('effective_to', '>=', $period->start_date);
                })
                ->with('salaryStructure', 'user:id,name,email')
                ->chunk(200, function ($assignments) use ($period, $mandatoryComponents) {
                    foreach ($assignments as $assignment) {
                        $this->createPayslipForAssignment($assignment, $period, $mandatoryComponents);
                    }
                });

            $period->update(['status' => 'draft']); // back to draft until approved

            return $period->fresh()->loadCount('payslips');
        });
    }

    /**
     * Create a single payslip with line items for one employee assignment.
     */
    private function createPayslipForAssignment(
        EmployeeSalaryAssignment $assignment,
        PayrollPeriod $period,
        $mandatoryComponents
    ): Payslip {
        $baseSalary = $assignment->custom_base_salary
            ? (float) $assignment->custom_base_salary
            : (float) $assignment->salaryStructure->base_salary;

        $totalAllowances = 0;
        $totalDeductions = 0;
        $sortOrder = 0;
        $lineItemsData = [];

        // Base salary line item
        $lineItemsData[] = [
            'label' => 'Base Salary',
            'type' => 'earning',
            'amount' => $baseSalary,
            'is_taxable' => true,
            'sort_order' => $sortOrder++,
        ];

        // Apply mandatory components
        foreach ($mandatoryComponents as $component) {
            $amount = $this->calculateComponentAmount($component, $baseSalary);

            $lineItemsData[] = [
                'pay_component_id' => $component->id,
                'label' => $component->name,
                'type' => in_array($component->type, ['allowance', 'bonus']) ? 'earning' : 'deduction',
                'amount' => $amount,
                'is_taxable' => $component->is_taxable,
                'sort_order' => $sortOrder++,
            ];

            if (in_array($component->type, ['allowance', 'bonus'])) {
                $totalAllowances += $amount;
            } else {
                $totalDeductions += $amount;
            }
        }

        $grossSalary = $baseSalary + $totalAllowances;
        $netSalary = $grossSalary - $totalDeductions;

        // Delete existing payslip for this user+period (re-run scenario)
        Payslip::where('user_id', $assignment->user_id)
            ->where('payroll_period_id', $period->id)
            ->forceDelete();

        $payslip = Payslip::create([
            'organization_id' => $period->organization_id,
            'user_id' => $assignment->user_id,
            'payroll_period_id' => $period->id,
            'gross_salary' => $grossSalary,
            'total_deductions' => $totalDeductions,
            'total_allowances' => $totalAllowances,
            'net_salary' => $netSalary,
            'status' => 'draft',
        ]);

        // Bulk-create line items
        foreach ($lineItemsData as $item) {
            $payslip->lineItems()->create($item);
        }

        return $payslip;
    }

    /**
     * Calculate the monetary amount for a pay component.
     */
    private function calculateComponentAmount(PayComponent $component, float $baseSalary): float
    {
        if ($component->calculation_type === 'percentage') {
            return round($baseSalary * ((float) $component->value / 100), 2);
        }

        return (float) $component->value;
    }

    // ─── Payroll Approval ──────────────────────────────────────────

    public function approvePayroll(string $periodId, User $approver): PayrollPeriod
    {
        return DB::transaction(function () use ($periodId, $approver) {
            $period = PayrollPeriod::lockForUpdate()->findOrFail($periodId);

            if ($period->status !== 'draft') {
                throw new \RuntimeException('Only draft payroll periods with generated payslips can be approved.');
            }

            // Check payslips exist
            $payslipCount = $period->payslips()->count();
            if ($payslipCount === 0) {
                throw new \RuntimeException('Cannot approve a payroll period with no payslips. Run payroll first.');
            }

            $period->update([
                'status' => 'approved',
                'approved_by' => $approver->id,
            ]);

            // Mark all draft payslips as approved
            $period->payslips()->where('status', 'draft')->update(['status' => 'approved']);

            return $period->fresh()->load('approver:id,name,email')->loadCount('payslips');
        });
    }

    // ─── Payslips (role-scoped) ────────────────────────────────────

    /**
     * Get payslips with role-based scoping:
     * - Employee: own payslips only
     * - Manager: team payslips
     * - Admin/Accountant: all payslips
     */
    public function getPayslips(array $filters, User $viewer): LengthAwarePaginator
    {
        $query = Payslip::with([
            'user:id,name,email,avatar_url',
            'payrollPeriod:id,name,start_date,end_date,status',
        ]);

        // Role-scoped access
        if ($this->permissionService->hasPermission($viewer, 'payroll.view_all')) {
            // Admin/accountant: see all
        } elseif ($this->permissionService->hasPermission($viewer, 'payroll.view_team')) {
            $teamUserIds = $this->permissionService->getTeamUserIds($viewer);
            $teamUserIds[] = $viewer->id;
            $query->whereIn('user_id', $teamUserIds);
        } else {
            // Employee: own only
            $query->where('user_id', $viewer->id);
        }

        // Filters
        if (! empty($filters['payroll_period_id'])) {
            $query->where('payroll_period_id', $filters['payroll_period_id']);
        }

        if (! empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }

        if (! empty($filters['user_id'])) {
            $query->where('user_id', $filters['user_id']);
        }

        return $query->orderByDesc('created_at')
            ->paginate($filters['per_page'] ?? 25);
    }

    /**
     * Get a single payslip detail with line items. Authorization check included.
     */
    public function getPayslipDetail(string $payslipId, User $viewer): Payslip
    {
        $payslip = Payslip::with([
            'user:id,name,email,avatar_url',
            'payrollPeriod',
            'lineItems' => fn ($q) => $q->orderBy('sort_order'),
        ])->findOrFail($payslipId);

        // Authorization: employee can view own, manager can view team, admin/accountant can view all
        if ($viewer->id === $payslip->user_id) {
            return $payslip;
        }

        if ($this->permissionService->hasPermission($viewer, 'payroll.view_all')) {
            return $payslip;
        }

        if ($this->permissionService->hasPermission($viewer, 'payroll.view_team')) {
            $teamUserIds = $this->permissionService->getTeamUserIds($viewer);
            if (in_array($payslip->user_id, $teamUserIds)) {
                return $payslip;
            }
        }

        abort(403, 'You are not authorized to view this payslip.');
    }
}
