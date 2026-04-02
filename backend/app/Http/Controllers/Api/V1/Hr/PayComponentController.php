<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
use App\Http\Requests\Hr\StorePayComponentRequest;
use App\Http\Requests\Hr\UpdatePayComponentRequest;
use App\Models\PayComponent;
use App\Services\PayrollService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PayComponentController extends Controller
{
    public function __construct(
        private readonly PayrollService $payrollService,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', PayComponent::class);

        $components = $this->payrollService->getPayComponents($request->all());

        return response()->json($components);
    }

    public function store(StorePayComponentRequest $request): JsonResponse
    {
        $this->authorize('create', PayComponent::class);

        $component = $this->payrollService->createPayComponent($request->validated());

        return response()->json(['data' => $component], 201);
    }

    public function show(string $id): JsonResponse
    {
        $component = PayComponent::findOrFail($id);
        $this->authorize('view', $component);

        return response()->json(['data' => $component]);
    }

    public function update(UpdatePayComponentRequest $request, string $id): JsonResponse
    {
        $component = PayComponent::findOrFail($id);
        $this->authorize('update', $component);

        $updated = $this->payrollService->updatePayComponent($id, $request->validated());

        return response()->json(['data' => $updated]);
    }

    public function destroy(string $id): JsonResponse
    {
        $component = PayComponent::findOrFail($id);
        $this->authorize('delete', $component);

        $this->payrollService->deletePayComponent($id);

        return response()->json(null, 204);
    }
}
