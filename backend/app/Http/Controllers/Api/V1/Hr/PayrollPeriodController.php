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
        $period = PayrollPeriod::with('approver:id,name,email')
            ->withCount('payslips')
            ->findOrFail($id);

        $this->authorize('view', $period);

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

        RunPayrollJob::dispatch($period->id, $period->organization_id);

        return response()->json([
            'message' => 'Payroll run has been queued.',
            'data' => $period,
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
