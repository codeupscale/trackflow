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
            // Normalised here rather than trusting the raw query string: "0"
            // and "false" both have to mean "active only".
            $request->all() + ['archived' => $request->boolean('archived')],
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
