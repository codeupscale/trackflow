<?php

namespace App\Services;

use App\Models\EmployeeSalaryAssignment;
use App\Models\PayComponent;
use App\Models\Payslip;
use App\Models\PayslipLineItem;
use App\Models\PayrollPeriod;
use App\Models\SalaryStructure;
use App\Models\User;
use Carbon\Carbon;
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
        // The position is eager-loaded so the assign dialog can group grades by
        // job without an extra request per grade.
        $query = SalaryStructure::with('position:id,title');

        if (! empty($filters['type'])) {
            $query->where('type', $filters['type']);
        }

        if (isset($filters['is_active'])) {
            $query->where('is_active', (bool) $filters['is_active']);
        }

        // Grades for one job. 'unlinked' returns those not yet tied to a
        // position, which is how an org part-way through setup sees its backlog.
        if (! empty($filters['position_id'])) {
            $filters['position_id'] === 'unlinked'
                ? $query->whereNull('position_id')
                : $query->where('position_id', $filters['position_id']);
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

    /**
     * Every active employee with their current salary assignment, if any.
     *
     * Driven from USERS with a left join so people WITHOUT a salary appear —
     * they are the ones that matter. runPayroll() iterates assignments, so an
     * unassigned employee is silently skipped and the run reports success while
     * producing no payslip for them. A list of only-assigned employees cannot
     * surface that; this one can.
     */
    public function getSalaryRoster(string $orgId, array $filters): LengthAwarePaginator
    {
        $today = Carbon::now()->toDateString();

        $query = User::where('users.organization_id', $orgId)
            ->where('users.is_active', true)
            ->whereNull('users.deleted_at')
            // The active assignment for today. Overlaps are prevented on write
            // (see assignSalaryToEmployee), so this cannot fan out.
            ->leftJoin('employee_salary_assignments as esa', function ($join) use ($orgId, $today) {
                $join->on('esa.user_id', '=', 'users.id')
                    ->where('esa.organization_id', $orgId)
                    ->whereNull('esa.deleted_at')
                    ->where('esa.effective_from', '<=', $today)
                    ->where(function ($q) use ($today) {
                        $q->whereNull('esa.effective_to')
                            ->orWhere('esa.effective_to', '>=', $today);
                    });
            })
            ->leftJoin('salary_structures as ss', 'esa.salary_structure_id', '=', 'ss.id')
            // The employee's POSITION, so the assign dialog can offer the grades
            // that belong to their job. Left joins throughout: an employee with
            // no profile, or a profile with no position, must still appear —
            // that is the normal state before an org finishes configuring.
            ->leftJoin('employee_profiles as ep', function ($join) use ($orgId) {
                $join->on('ep.user_id', '=', 'users.id')
                    ->where('ep.organization_id', $orgId);
            })
            ->leftJoin('positions as pos', 'ep.position_id', '=', 'pos.id')
            ->select([
                'users.id',
                'users.name',
                'users.email',
                'users.avatar_url',
                'users.role',
                'pos.id as position_id',
                'pos.title as position_title',
                'esa.id as assignment_id',
                'esa.effective_from',
                'esa.effective_to',
                // custom_base_salary is deliberately NOT selected here: it is
                // encrypted, and a raw join hands back the cipher with no cast
                // to decrypt it. The controller resolves it through the model,
                // which owns that cast.
                'ss.id as structure_id',
                'ss.name as structure_name',
                'ss.type as structure_type',
                'ss.base_salary as structure_base_salary',
            ]);

        if (! empty($filters['search'])) {
            $search = str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], $filters['search']);
            $query->where(function ($q) use ($search) {
                $q->where('users.name', 'ilike', "%{$search}%")
                    ->orWhere('users.email', 'ilike', "%{$search}%");
            });
        }

        // 'assigned' / 'unassigned' — the whole point of the screen.
        if (($filters['status'] ?? null) === 'assigned') {
            $query->whereNotNull('esa.id');
        } elseif (($filters['status'] ?? null) === 'unassigned') {
            $query->whereNull('esa.id');
        }

        return $query->orderBy('users.name')->paginate($filters['per_page'] ?? 25);
    }

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

    /**
     * Assign a salary, closing any assignment it supersedes.
     *
     * Overlapping assignments must not coexist: runPayroll() processes EVERY
     * assignment overlapping the period and force-deletes the prior payslip
     * before writing, so two active rows do not error — the last one processed
     * silently wins, and the employee is paid a non-deterministic amount.
     *
     * Any assignment still open on the day before the new one starts is ended
     * there, which preserves history: a payroll re-run for an earlier period
     * still resolves the salary that actually applied then. An assignment that
     * begins on or after the new start date is fully superseded and is
     * soft-deleted, since ending it would leave a negative-length window.
     */
    public function assignSalaryToEmployee(string $userId, array $data): EmployeeSalaryAssignment
    {
        return DB::transaction(function () use ($userId, $data) {
            $from = Carbon::parse($data['effective_from'])->toDateString();
            $dayBefore = Carbon::parse($from)->subDay()->toDateString();

            $existing = EmployeeSalaryAssignment::where('user_id', $userId)
                ->where(function ($q) use ($from) {
                    $q->whereNull('effective_to')
                        ->orWhere('effective_to', '>=', $from);
                })
                ->get();

            foreach ($existing as $row) {
                if ($row->effective_from->toDateString() >= $from) {
                    $row->delete();
                    continue;
                }

                $row->update(['effective_to' => $dayBefore]);
            }

            return EmployeeSalaryAssignment::create(array_merge($data, [
                'user_id' => $userId,
            ]));
        });
    }

    /**
     * Assign one salary structure to many employees at once.
     *
     * The whole set is one transaction: a bulk assign that half-succeeded
     * would leave payroll in the state this feature exists to prevent — some
     * people covered, some silently skipped — with no record of where it
     * stopped. Users are resolved WITHIN the actor's organization, so a
     * crafted id list can never attach a salary to another tenant's employee.
     */
    public function bulkAssignSalary(string $orgId, array $userIds, array $data): int
    {
        return DB::transaction(function () use ($orgId, $userIds, $data) {
            $ids = User::where('organization_id', $orgId)
                ->where('is_active', true)
                ->whereIn('id', $userIds)
                ->pluck('id');

            foreach ($ids as $userId) {
                // organization_id is passed EXPLICITLY rather than left to the
                // BelongsToOrganization hook, which fills it from the logged-in
                // user. That hook is fine inside a request and silently absent
                // everywhere else — a console command or a queued job hits a
                // not-null violation on insert. The org is already known here,
                // so there is no reason to depend on ambient auth state.
                $this->assignSalaryToEmployee($userId, $data + ['organization_id' => $orgId]);
            }

            return $ids->count();
        });
    }

    // ─── Payroll Periods ───────────────────────────────────────────

    public function getPayrollPeriods(array $filters): LengthAwarePaginator
    {
        // withCount is required, not cosmetic: a period sits in 'draft' both
        // before and after a run, so the payslip count is the only thing that
        // distinguishes "not run yet" from "ready to approve".
        // verified_payslips_count rides along so the run card can tell whether
        // Approve is reachable. Approval is refused until every payslip has
        // been checked, and without the count the button had no way to know —
        // it offered itself, then failed with a 422 that named a condition the
        // screen had never mentioned.
        $query = PayrollPeriod::with(['approver:id,name,email', 'processor:id,name,email'])
            ->withCount([
                'payslips',
                'payslips as verified_payslips_count' => fn ($q) => $q->whereNotNull('verified_at')->whereNull('withdrawn_at'),
            ]);

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
    /**
     * Active employees with no salary covering this period.
     *
     * The overlap test is the SAME one runPayroll() uses to pick assignments,
     * so this answers exactly "who would the run skip?" — a check written
     * against today's date instead would clear a period that ends next month
     * and still miss people.
     */
    public function employeesWithoutSalaryFor(PayrollPeriod $period): \Illuminate\Support\Collection
    {
        return User::query()
            ->where('users.organization_id', $period->organization_id)
            ->where('users.is_active', true)
            ->whereNull('users.deleted_at')
            ->whereNotExists(function ($q) use ($period) {
                $q->select(DB::raw(1))
                    ->from('employee_salary_assignments as esa')
                    ->whereColumn('esa.user_id', 'users.id')
                    ->where('esa.organization_id', $period->organization_id)
                    ->whereNull('esa.deleted_at')
                    ->where('esa.effective_from', '<=', $period->end_date)
                    ->where(function ($inner) use ($period) {
                        $inner->whereNull('esa.effective_to')
                            ->orWhere('esa.effective_to', '>=', $period->start_date);
                    });
            })
            ->orderBy('users.name')
            ->get(['users.id', 'users.name', 'users.email']);
    }

    /**
     * The message shown when a run is refused for missing salaries. Names the
     * people, because "3 employees have no salary" sends someone hunting
     * through a roster to find out which three.
     */
    public function missingSalaryMessage(\Illuminate\Support\Collection $missing): string
    {
        $names = $missing->take(5)->pluck('name')->implode(', ');
        $extra = $missing->count() - min(5, $missing->count());

        return $missing->count() . ' employee' . ($missing->count() === 1 ? '' : 's')
            . ' have no salary assigned: ' . $names
            . ($extra > 0 ? " and {$extra} more" : '')
            . '. Assign salaries before running payroll.';
    }

    /**
     * Has anyone's pay changed since this period was last run?
     *
     * A draft payslip is a snapshot taken at run time — it does not follow a
     * later raise until the period is run again. That is correct, but silent:
     * without this, a salary corrected after the run sits unnoticed until
     * someone is paid the old amount. Only draft periods are asked, since
     * approved and paid ones are deliberately frozen.
     */
    public function salariesChangedSinceRun(PayrollPeriod $period): bool
    {
        if ($period->status !== 'draft' || $period->processed_at === null) {
            return false;
        }

        $orgId = $period->organization_id;

        $assignmentTouched = DB::table('employee_salary_assignments')
            ->where('organization_id', $orgId)
            ->where('updated_at', '>', $period->processed_at)
            ->exists();

        if ($assignmentTouched) {
            return true;
        }

        // A structure change reaches everyone assigned to it, so the structure
        // table has to be checked as well as the assignments.
        return DB::table('salary_structures')
            ->where('organization_id', $orgId)
            ->whereNull('deleted_at')
            ->where('updated_at', '>', $period->processed_at)
            ->exists();
    }

    /**
     * Why a period cannot be run right now, or null when it can be.
     *
     * Shared by the controller (which answers the user before dispatching) and
     * the run itself (which must hold even when reached from a queued job), so
     * the two can never disagree about what is allowed.
     */
    public function runBlockedReason(PayrollPeriod $period, ?string $actorId = null): ?string
    {
        // A run BELONGS to whoever started it. Owner and finance manager can
        // both run payroll, and without this either could re-run the other's
        // work — regenerating payslips a colleague had already reviewed and
        // sent, with nothing on screen to say it had happened or who did it.
        // Whoever ran it keeps the run until it is reset.
        if ($actorId !== null
            && $period->processed_by !== null
            && $period->processed_by !== $actorId
        ) {
            $who = $period->processor?->name ?? 'someone else';

            return "This payroll was run by {$who}"
                . ($period->processed_at ? ' on ' . Carbon::parse($period->processed_at)->format('d M Y') : '')
                . '. Only they can run it again.';
        }

        // Paid and approved periods are settled. Re-running would regenerate
        // payslips people have already been paid against — the double-payment
        // case, and the one that actually costs money.
        if ($period->status === 'paid') {
            return 'This period has already been paid and cannot be run again.';
        }

        if ($period->status === 'approved') {
            return 'This period has been approved. Reopen it before running payroll again.';
        }

        if (! in_array($period->status, ['draft', 'processing'], true)) {
            return 'Payroll can only be run on draft periods.';
        }

        // A period that has not started yet has nothing to pay for: no
        // attendance, no overtime, no leave. Running early produces a payslip
        // that is wrong the moment the month actually begins.
        $today = Carbon::now($this->organizationTimezone($period->organization_id))->startOfDay();
        $starts = Carbon::parse($period->start_date)->startOfDay();

        if ($starts->greaterThan($today)) {
            return 'This period starts on ' . $starts->format('d M Y')
                . '. Payroll can only be run once the period has begun.';
        }

        return null;
    }

    private function organizationTimezone(string $orgId): string
    {
        $org = \App\Models\Organization::find($orgId);

        return $org?->getSetting('timezone') ?: config('app.timezone', 'UTC');
    }

    public function runPayroll(string $periodId, ?string $actorId = null): PayrollPeriod
    {
        $period = PayrollPeriod::findOrFail($periodId);

        // abort(422) rather than a RuntimeException: the latter surfaces as a
        // 500 "unexpected error", so the UI cannot tell the user what to do
        // about a precondition they can actually fix.
        if ($reason = $this->runBlockedReason($period, $actorId)) {
            abort(422, $reason);
        }

        // Refuse rather than silently skip. The run used to iterate salary
        // ASSIGNMENTS, so an employee without one produced no payslip and the
        // run still reported success — the failure mode being that someone
        // does not get paid and nobody finds out until they complain. Checked
        // here as well as in the controller because the run is dispatched as a
        // job: the controller's check gives the user a 422, this one stops a
        // queued job from writing a partial payroll.
        $missing = $this->employeesWithoutSalaryFor($period);

        if ($missing->isNotEmpty()) {
            abort(422, $this->missingSalaryMessage($missing));
        }

        return DB::transaction(function () use ($period, $actorId) {
            // processed_by is stamped with the run, so the period carries a name
            // as well as a time from the moment it starts.
            $period->update([
                'status' => 'processing',
                'processed_at' => now(),
                'processed_by' => $actorId ?? $period->processed_by,
            ]);

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

        // "Basic Salary", not "Base Salary": payslip designs say Basic, and the
        // field key is derived from this label — so the old wording meant a box
        // placed for Basic Salary resolved to nothing at all.
        $lineItemsData[] = [
            'label' => 'Basic Salary',
            'type' => 'earning',
            // Categorised, so it counts as basic pay rather than an allowance
            // in the listing's columns and in `pay.basic`.
            'category' => 'basic',
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
                // The component's own type IS the category — tax and deduction
                // are different things and the columns must tell them apart.
                'category' => $component->type,
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

            // Every payslip must have been looked at first. Approval is the
            // point of no return — it locks the figures and moves the period
            // towards payment — so letting it through with unread payslips
            // would make the per-employee review optional in practice, which
            // is the same as not having it.
            //
            // "Not sent" includes WITHDRAWN, not only never-verified. A
            // withdrawal keeps the original verified_at and records
            // withdrawn_at beside it — that is deliberate, so the audit trail
            // survives — which meant a payslip someone had explicitly taken
            // back still counted as reviewed here and sailed through approval.
            $unverified = $period->payslips()
                ->where(fn ($q) => $q->whereNull('verified_at')->orWhereNotNull('withdrawn_at'))
                ->count();

            if ($unverified > 0) {
                abort(422, "{$unverified} of {$payslipCount} payslips have not been sent yet. Review and send each one before approving.");
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

    /**
     * Close out a period once the money has actually gone out.
     *
     * 'paid' was previously a dead status — the UI filtered by it but nothing
     * ever set it, so an approved period stayed approved forever and "have we
     * paid this?" had no answer in the product. Approved is the only legal
     * predecessor: paying a period that was never approved would skip the
     * review step entirely.
     */
    public function markPayrollPaid(string $periodId): PayrollPeriod
    {
        return DB::transaction(function () use ($periodId) {
            $period = PayrollPeriod::lockForUpdate()->findOrFail($periodId);

            if ($period->status === 'paid') {
                // Idempotent: a double-click must not error.
                return $period->load('approver:id,name,email')->loadCount('payslips');
            }

            if ($period->status !== 'approved') {
                // abort(422) rather than a RuntimeException: the latter surfaces
                // as a 500 "unexpected error", so the UI cannot tell the user
                // what to do. This is a precondition, not a crash.
                abort(422, 'This payroll period must be approved before it can be marked as paid.');
            }

            $period->update(['status' => 'paid', 'paid_at' => now()]);
            $period->payslips()->where('status', 'approved')->update(['status' => 'paid']);

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
        return $this->payslipQuery($filters, $viewer)
            ->with([
                'user:id,name,email,avatar_url',
                // Who released this payslip, so the listing can say so rather
                // than only that it was released.
                'verifier:id,name',
                'payrollPeriod:id,name,start_date,end_date,status',
                'lineItems' => fn ($q) => $q->orderBy('sort_order'),
            ])
            // Summed in SQL rather than by loading and adding in PHP: the
            // listing shows a page of payslips and these are two more columns
            // on it, not a reason to pull every line item into memory.
            ->withSum(['lineItems as basic_total' => fn ($q) => $q->where('category', 'basic')], 'amount')
            ->withSum(['lineItems as tax_total' => fn ($q) => $q->where('category', 'tax')], 'amount')
            ->withSum(['lineItems as bonus_total' => fn ($q) => $q->where('category', 'bonus')], 'amount')
            ->orderByDesc('created_at')
            ->paginate($filters['per_page'] ?? 25);
    }

    /**
     * The scoping and filtering both the listing and its totals are built on.
     *
     * Deliberately carries no eager loads or select columns — those belong to
     * the listing. Sharing the WHERE clause and nothing else is what keeps a
     * total honest: it cannot cover a different set of payslips than the rows
     * it sits under.
     */
    private function payslipQuery(array $filters, User $viewer): \Illuminate\Database\Eloquent\Builder
    {
        $query = Payslip::query();

        // Archived employees are hidden here too. A payslip is history and is
        // never deleted — it simply stops appearing in the default list, and
        // the Archive tab (?archived=1) is where an archived person's slips are
        // read. An employee viewing their OWN slips is exempt: if they can
        // still sign in they are not archived, and the self-scope below already
        // narrows to them.
        $query->whereHas('user', fn ($q) => $q->where('is_active', ! ($filters['archived'] ?? false)));

        // Role-scoped access
        if ($this->permissionService->hasPermission($viewer, 'payroll.view_all')) {
            // Admin/accountant: see all
        } elseif ($this->permissionService->hasPermission($viewer, 'payroll.view_team')) {
            $teamUserIds = $this->permissionService->getProjectUserIds($viewer);
            $teamUserIds[] = $viewer->id;
            $query->whereIn('user_id', $teamUserIds);
        } else {
            // Employee: own only, and only ONCE VERIFIED. A payroll run
            // produces draft figures that HR has not yet checked; showing them
            // to staff turns every mid-run correction into an argument about a
            // number the employee was never meant to see.
            $query->where('user_id', $viewer->id)->whereNotNull('verified_at')->whereNull('withdrawn_at');
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

        // The month a payslip BELONGS to is its period's, not the row's
        // created_at: a December run processed in January is December's pay.
        if (! empty($filters['year']) || ! empty($filters['month'])) {
            $query->whereHas('payrollPeriod', function ($q) use ($filters) {
                if (! empty($filters['year'])) {
                    $q->whereYear('end_date', (int) $filters['year']);
                }
                if (! empty($filters['month'])) {
                    $q->whereMonth('end_date', (int) $filters['month']);
                }
            });
        }

        return $query;
    }

    /**
     * The same payslips `getPayslips()` would list, added up.
     *
     * Its own call rather than a property hung off the paginator — attaching
     * one is a dynamic property, deprecated since PHP 8.2. Both are built from
     * `payslipQuery()`, so the scoping and filters cannot drift apart.
     *
     * Totals cover the WHOLE filtered set, never the page. Summing the 25 rows
     * on screen would quietly under-report the moment someone has a
     * twenty-sixth payslip, and a yearly earnings figure that is silently wrong
     * is worse than none at all.
     */
    public function getPayslipTotals(array $filters, User $viewer): array
    {
        return $this->payslipTotals($this->payslipQuery($filters, $viewer));
    }

    /**
     * Gross, tax, deductions and net across every payslip a query matches.
     *
     * Tax comes from the line items by CATEGORY rather than being inferred from
     * `total_deductions`, which lumps tax in with loans and leave. Someone
     * checking a year's earnings against a tax filing needs it on its own.
     */
    private function payslipTotals($query): array
    {
        $row = $query
            ->reorder()
            ->toBase()
            ->selectRaw('COUNT(*) as slips')
            ->selectRaw("COUNT(*) FILTER (WHERE payslips.status IN ('approved','paid')) as finalised")
            ->selectRaw('COALESCE(SUM(payslips.gross_salary), 0) as gross')
            ->selectRaw('COALESCE(SUM(payslips.total_allowances), 0) as allowances')
            ->selectRaw('COALESCE(SUM(payslips.total_deductions), 0) as deductions')
            ->selectRaw('COALESCE(SUM(payslips.net_salary), 0) as net')
            // The category is a constant of this codebase, not user input, so
            // it is inlined rather than bound — one less binding to keep in
            // step with the select list being rebuilt above.
            ->selectRaw("COALESCE(SUM((SELECT COALESCE(SUM(li.amount), 0) FROM payslip_line_items li WHERE li.payslip_id = payslips.id AND li.category = 'tax')), 0) as tax")
            ->first();

        return [
            'slips' => (int) ($row->slips ?? 0),
            'finalised' => (int) ($row->finalised ?? 0),
            'gross' => (float) ($row->gross ?? 0),
            'allowances' => (float) ($row->allowances ?? 0),
            'tax' => (float) ($row->tax ?? 0),
            'deductions' => (float) ($row->deductions ?? 0),
            'net' => (float) ($row->net ?? 0),
        ];
    }

    /** The years this viewer actually has payslips in, newest first. */
    public function payslipYears(User $viewer): array
    {
        $query = Payslip::query();

        if (! $this->permissionService->hasPermission($viewer, 'payroll.view_all')) {
            if ($this->permissionService->hasPermission($viewer, 'payroll.view_team')) {
                $ids = $this->permissionService->getProjectUserIds($viewer);
                $ids[] = $viewer->id;
                $query->whereIn('user_id', $ids);
            } else {
                $query->where('user_id', $viewer->id)->whereNotNull('verified_at')->whereNull('withdrawn_at');
            }
        }

        return $query->join('payroll_periods as pp', 'payslips.payroll_period_id', '=', 'pp.id')
            ->selectRaw('DISTINCT EXTRACT(YEAR FROM pp.end_date)::int as year')
            ->orderByDesc('year')
            ->pluck('year')
            ->all();
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

        // Whoever can see the whole org's payroll can open any payslip at any
        // stage — that is exactly who does the verifying. Checked BEFORE the
        // self-branch so an HR user reviewing their OWN unverified payslip is
        // not blocked by the employee rule below.
        if ($this->permissionService->hasPermission($viewer, 'payroll.view_all')) {
            return $payslip;
        }

        // The employee themselves: own payslip, but only once verified. The
        // same gate as the list, applied here too — otherwise a guessed or
        // remembered id would reach an unverified payslip (and its PDF, which
        // authorizes through this very method).
        if ($viewer->id === $payslip->user_id) {
            if (! $payslip->isVerified()) {
                abort(404, 'This payslip is not available yet.');
            }

            return $payslip;
        }

        if ($this->permissionService->hasPermission($viewer, 'payroll.view_team')) {
            $teamUserIds = $this->permissionService->getProjectUserIds($viewer);
            if (in_array($payslip->user_id, $teamUserIds)) {
                return $payslip;
            }
        }

        abort(403, 'You are not authorized to view this payslip.');
    }

    /**
     * Replace a payslip's line items and recompute its totals.
     *
     * The whole set is sent and rewritten rather than patched line by line:
     * the totals are derived from the lines, so a partial update leaves a
     * window where gross, deductions and net disagree with what they are the
     * sum of.
     *
     * Editing RESETS verification. A verified payslip is one a person checked
     * and released to the employee — changing the figures underneath it means
     * what they approved is no longer what is on the document, so it has to be
     * checked again.
     */
    public function updatePayslipLines(string $payslipId, array $lines, User $actor): Payslip
    {
        return DB::transaction(function () use ($payslipId, $lines, $actor) {
            $payslip = Payslip::lockForUpdate()->findOrFail($payslipId);

            // Approved and paid payslips are a record of what was actually
            // paid. Correcting one is an adjustment against the next run, not
            // a rewrite of history.
            if (in_array($payslip->status, ['approved', 'paid'], true)) {
                abort(422, 'This payslip has been ' . $payslip->status . ' and can no longer be edited.');
            }

            $this->refuseSelfService($payslip, $actor, 'edit');

            $payslip->lineItems()->delete();

            $earnings = 0.0;
            $deductions = 0.0;
            $basic = 0.0;

            foreach (array_values($lines) as $index => $line) {
                $category = in_array($line['category'] ?? '', PayslipLineItem::CATEGORIES, true)
                    ? $line['category']
                    : 'other';

                $isEarning = in_array($category, PayslipLineItem::EARNING_CATEGORIES, true);
                $amount = round((float) ($line['amount'] ?? 0), 2);

                PayslipLineItem::create([
                    'payslip_id' => $payslip->id,
                    'label' => $line['label'],
                    // `type` is kept in sync with the category rather than
                    // trusted from the client: every reader that predates
                    // categories still filters on it.
                    'type' => $isEarning ? 'earning' : 'deduction',
                    'category' => $category,
                    'amount' => $amount,
                    'is_taxable' => (bool) ($line['is_taxable'] ?? false),
                    'sort_order' => $index,
                ]);

                if ($isEarning) {
                    $earnings += $amount;
                    if ($category === 'basic') {
                        $basic += $amount;
                    }
                } else {
                    $deductions += $amount;
                }
            }

            $payslip->forceFill([
                'gross_salary' => $earnings,
                // Allowances are the earnings that are NOT base pay — the
                // column means "added on top", so counting basic in it would
                // double the salary in any report that adds them together.
                'total_allowances' => $earnings - $basic,
                'total_deductions' => $deductions,
                'net_salary' => $earnings - $deductions,
                'verified_at' => null,
                'verified_by' => null,
            ])->save();

            return $payslip->fresh()->load([
                'user:id,name,email',
                'payrollPeriod:id,name,start_date,end_date,status',
                'lineItems' => fn ($q) => $q->orderBy('sort_order'),
            ]);
        });
    }

    /**
     * Verify one payslip, releasing it to the employee.
     *
     * One payslip at a time, on purpose: verification is the human check that
     * THIS person's pay is right, and a bulk "verify all" would return payroll
     * to the state this step exists to prevent — figures reaching staff that
     * nobody read.
     *
     * Idempotent. Re-verifying an already-verified payslip is a no-op rather
     * than an error, so a double-click cannot rewrite who checked it or when.
     */
    /**
     * Nobody signs off their own pay — except the owner.
     *
     * A finance manager can run payroll, verify every payslip and approve the
     * period, which means without this they could raise their own salary and
     * release it with nobody else involved. Separation of duties is the whole
     * control on a payroll system, and leave approval in this same product
     * already enforces it; payroll did not.
     *
     * The OWNER is exempt deliberately. They are the last authority in the
     * organization, and an org whose only payroll-capable person is the owner
     * would otherwise have no way to issue the owner's own payslip — a rule
     * that deadlocks the smallest customers is not a control, it is a bug.
     */
    private function refuseSelfService(Payslip $payslip, User $actor, string $action): void
    {
        if ($payslip->user_id !== $actor->id) {
            return;
        }

        if ($this->isOwner($actor)) {
            return;
        }

        abort(422, "You cannot {$action} your own payslip. Ask the owner to do it.");
    }

    /**
     * The same two tests PermissionService uses, for the same reason: the role
     * COLUMN is authoritative when a user has no pivot row, which is the normal
     * state for orgs created before RBAC.
     */
    private function isOwner(User $user): bool
    {
        if (($user->getRawOriginal('role') ?? 'employee') === 'owner') {
            return true;
        }

        return DB::table('user_roles')
            ->join('roles', 'roles.id', '=', 'user_roles.role_id')
            ->where('user_roles.user_id', $user->id)
            ->where('roles.priority', '>=', 100)
            ->exists();
    }

    public function verifyPayslip(string $payslipId, User $verifier): Payslip
    {
        return DB::transaction(function () use ($payslipId, $verifier) {
            $payslip = Payslip::lockForUpdate()->findOrFail($payslipId);

            $this->refuseSelfService($payslip, $verifier, 'verify');

            if ($payslip->isVerified()) {
                return $payslip->load(['user:id,name,email', 'verifier:id,name']);
            }

            // Clears any withdrawal: re-verifying is what puts the payslip back
            // in front of the employee, and leaving the old stamp would keep it
            // hidden while the screen said it had been sent.
            $payslip->forceFill([
                'verified_at' => now(),
                'verified_by' => $verifier->id,
                'withdrawn_at' => null,
                'withdrawn_by' => null,
            ])->save();

            return $payslip->load(['user:id,name,email', 'verifier:id,name']);
        });
    }

    /**
     * Withdraw a verification, hiding the payslip from the employee again.
     *
     * Needed because verification is the only thing standing between a draft
     * figure and the person it is about: a mistake caught after release must
     * have a way back that is not "delete the payslip".
     */
    public function unverifyPayslip(string $payslipId, User $actor): Payslip
    {
        return DB::transaction(function () use ($payslipId, $actor) {
            $payslip = Payslip::lockForUpdate()->findOrFail($payslipId);

            if (in_array($payslip->status, ['approved', 'paid'], true)) {
                abort(422, 'This payslip has already been approved, so it cannot be unverified.');
            }

            $this->refuseSelfService($payslip, $actor, 'withdraw');

            // RECORDED, not erased. `verified_at` and `verified_by` are left
            // exactly as they were: the payslip WAS checked, by a named person,
            // at a known time, and a later withdrawal does not make that untrue.
            // Nulling them left no evidence any of it had happened — including
            // no evidence of the withdrawal itself.
            $payslip->forceFill([
                'withdrawn_at' => now(),
                'withdrawn_by' => $actor->id,
            ])->save();

            return $payslip->load('user:id,name,email');
        });
    }
}
