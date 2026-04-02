<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
use App\Http\Requests\Hr\StoreSalaryStructureRequest;
use App\Http\Requests\Hr\UpdateSalaryStructureRequest;
use App\Models\SalaryStructure;
use App\Services\PayrollService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SalaryStructureController extends Controller
{
    public function __construct(
        private readonly PayrollService $payrollService,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', SalaryStructure::class);

        $structures = $this->payrollService->getSalaryStructures($request->all());

        return response()->json($structures);
    }

    public function store(StoreSalaryStructureRequest $request): JsonResponse
    {
        $this->authorize('create', SalaryStructure::class);

        $structure = $this->payrollService->createSalaryStructure($request->validated());

        return response()->json(['data' => $structure], 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $structure = SalaryStructure::findOrFail($id);
        $this->authorize('view', $structure);

        return response()->json(['data' => $structure]);
    }

    public function update(UpdateSalaryStructureRequest $request, string $id): JsonResponse
    {
        $structure = SalaryStructure::findOrFail($id);
        $this->authorize('update', $structure);

        $updated = $this->payrollService->updateSalaryStructure($id, $request->validated());

        return response()->json(['data' => $updated]);
    }

    public function destroy(string $id): JsonResponse
    {
        $structure = SalaryStructure::findOrFail($id);
        $this->authorize('delete', $structure);

        $this->payrollService->deleteSalaryStructure($id);

        return response()->json(null, 204);
    }
}
