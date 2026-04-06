<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
use App\Services\PayrollService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PayslipController extends Controller
{
    public function __construct(
        private readonly PayrollService $payrollService,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $payslips = $this->payrollService->getPayslips(
            $request->all(),
            $request->user(),
        );

        return response()->json($payslips);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $payslip = $this->payrollService->getPayslipDetail($id, $request->user());

        return response()->json(['data' => $payslip]);
    }
}
