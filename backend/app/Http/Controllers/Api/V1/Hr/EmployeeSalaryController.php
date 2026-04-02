<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
use App\Http\Requests\Hr\AssignEmployeeSalaryRequest;
use App\Models\EmployeeSalaryAssignment;
use App\Models\User;
use App\Services\PayrollService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class EmployeeSalaryController extends Controller
{
    public function __construct(
        private readonly PayrollService $payrollService,
    ) {}

    public function show(Request $request, string $employeeId): JsonResponse
    {
        $this->authorize('view', [EmployeeSalaryAssignment::class, $employeeId]);

        $assignment = $this->payrollService->getEmployeeSalary($employeeId);

        return response()->json(['data' => $assignment]);
    }

    public function store(AssignEmployeeSalaryRequest $request, string $employeeId): JsonResponse
    {
        $this->authorize('create', EmployeeSalaryAssignment::class);

        // Verify employee exists in same org
        User::where('organization_id', $request->user()->organization_id)
            ->findOrFail($employeeId);

        $assignment = $this->payrollService->assignSalaryToEmployee(
            $employeeId,
            $request->validated(),
        );

        return response()->json(['data' => $assignment->load('salaryStructure')], 201);
    }
}
