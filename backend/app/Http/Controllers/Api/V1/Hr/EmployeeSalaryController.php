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

    /**
     * Salary roster: every active employee and whether they have a salary.
     * Unassigned employees are the point — payroll skips them silently.
     */
    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', EmployeeSalaryAssignment::class);

        $orgId = $request->user()->organization_id;

        $roster = $this->payrollService->getSalaryRoster(
            $orgId,
            $request->only(['search', 'status', 'per_page']),
        );

        // custom_base_salary is encrypted, so it is resolved through the MODEL —
        // its `encrypted` cast is the only thing that knows how to read it.
        // Decrypting a raw joined column by hand is brittle and silently yields
        // null on any mismatch, which shows an overridden salary as the
        // structure default. One extra query per page, keyed by assignment id.
        $assignmentIds = $roster->getCollection()->pluck('assignment_id')->filter()->all();
        $customBases = $assignmentIds === []
            ? collect()
            : EmployeeSalaryAssignment::whereIn('id', $assignmentIds)
                ->get()
                ->mapWithKeys(fn ($a) => [
                    $a->id => $a->custom_base_salary !== null ? (float) $a->custom_base_salary : null,
                ]);

        $roster->getCollection()->transform(function ($row) use ($customBases) {
            $custom = $row->assignment_id ? ($customBases[$row->assignment_id] ?? null) : null;

            return [
                'id' => $row->id,
                'name' => $row->name,
                'email' => $row->email,
                'avatar_url' => $row->avatar_url,
                'role' => $row->role,
                'assignment' => $row->assignment_id ? [
                    'id' => $row->assignment_id,
                    'effective_from' => $row->effective_from,
                    'effective_to' => $row->effective_to,
                    'custom_base_salary' => $custom,
                    'effective_base_salary' => $custom ?? (float) $row->structure_base_salary,
                    'structure' => [
                        'id' => $row->structure_id,
                        'name' => $row->structure_name,
                        'type' => $row->structure_type,
                        'base_salary' => (float) $row->structure_base_salary,
                    ],
                ] : null,
            ];
        });

        return response()->json($roster);
    }

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
