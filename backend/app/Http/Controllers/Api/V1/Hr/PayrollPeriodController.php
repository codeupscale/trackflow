<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
use App\Http\Requests\Hr\StorePayrollPeriodRequest;
use App\Http\Requests\Hr\UpdatePayrollPeriodRequest;
use App\Jobs\RunPayrollJob;
use App\Models\PayrollPeriod;
use App\Services\PayrollService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PayrollPeriodController extends Controller
{
    public function __construct(
        private readonly PayrollService $payrollService,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', PayrollPeriod::class);

        $periods = $this->payrollService->getPayrollPeriods($request->all());

        return response()->json($periods);
    }

    public function store(StorePayrollPeriodRequest $request): JsonResponse
    {
        $this->authorize('create', PayrollPeriod::class);

        $period = $this->payrollService->createPayrollPeriod($request->validated());

        return response()->json(['data' => $period], 201);
    }

    public function show(string $id): JsonResponse
    {
        $period = PayrollPeriod::with(['approver:id,name,email', 'processor:id,name,email'])
            ->withCount([
                'payslips',
                // Withdrawn excluded, exactly as the listing counts it. A
                // withdrawn payslip carries the verified_at of the send that
                // was taken back — counting it as verified made the detail
                // screen claim payslips were out that had been pulled.
                'payslips as verified_payslips_count' => fn ($q) => $q->whereNotNull('verified_at')->whereNull('withdrawn_at'),
            ])
            ->findOrFail($id);

        $this->authorize('view', $period);

        // Tells the screen whether these payslips are still current. A draft
        // payslip is a snapshot from run time and does not follow a later
        // raise until the period is run again.
        $period->salaries_changed_since_run = $this->payrollService->salariesChangedSinceRun($period);

        return response()->json(['data' => $period]);
    }

    public function update(UpdatePayrollPeriodRequest $request, string $id): JsonResponse
    {
        $period = PayrollPeriod::findOrFail($id);
        $this->authorize('update', $period);

        $updated = $this->payrollService->updatePayrollPeriod($id, $request->validated());

        return response()->json(['data' => $updated]);
    }

    public function destroy(string $id): JsonResponse
    {
        $period = PayrollPeriod::findOrFail($id);
        $this->authorize('delete', $period);

        $this->payrollService->deletePayrollPeriod($id);

        return response()->json(null, 204);
    }

    public function run(Request $request, string $id): JsonResponse
    {
        $period = PayrollPeriod::findOrFail($id);
        $this->authorize('run', $period);

        // Checked BEFORE dispatch so the person pressing Run learns why it was
        // refused. The service repeats these, but a job that aborts fails into
        // the queue where nobody is watching.
        if ($reason = $this->payrollService->runBlockedReason($period, $request->user()->id)) {
            abort(422, $reason);
        }

        $missing = $this->payrollService->employeesWithoutSalaryFor($period);

        if ($missing->isNotEmpty()) {
            abort(422, $this->payrollService->missingSalaryMessage($missing));
        }

        RunPayrollJob::dispatch($period->id, $period->organization_id, $request->user()->id);

        return response()->json([
            'message' => 'Payroll run has been queued.',
            'data' => $period,
        ]);
    }

    /**
     * Close the period once the money has gone out. Gated on the same
     * permission as approval — it is the final step of the same sign-off.
     */
    public function markPaid(Request $request, string $id): JsonResponse
    {
        $period = PayrollPeriod::findOrFail($id);
        $this->authorize('approve', $period);

        $paid = $this->payrollService->markPayrollPaid($id);

        return response()->json([
            'message' => 'Payroll period marked as paid.',
            'data' => $paid,
        ]);
    }

    public function approve(Request $request, string $id): JsonResponse
    {
        $period = PayrollPeriod::findOrFail($id);
        $this->authorize('approve', $period);

        $approved = $this->payrollService->approvePayroll($id, $request->user());

        return response()->json([
            'message' => 'Payroll period approved.',
            'data' => $approved,
        ]);
    }
}
