<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
use App\Http\Requests\Hr\StorePositionRequest;
use App\Http\Requests\Hr\UpdatePositionRequest;
use App\Models\Position;
use App\Services\OrganizationStructureService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PositionController extends Controller
{
    public function __construct(
        private readonly OrganizationStructureService $service,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $query = Position::where('organization_id', $request->user()->organization_id);

        if ($request->filled('department_id')) {
            $query->where('department_id', $request->input('department_id'));
        }

        if ($request->filled('level')) {
            $query->where('level', $request->input('level'));
        }

        $positions = $query->orderBy('title')->paginate(25);

        return response()->json($positions);
    }

    public function store(StorePositionRequest $request): JsonResponse
    {
        $this->authorize('create', Position::class);

        $position = $this->service->createPosition(
            $request->user()->organization,
            $request->validated(),
        );

        return response()->json(['data' => $position], 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $position = Position::where('organization_id', $request->user()->organization_id)
            ->with('department')
            ->findOrFail($id);

        $this->authorize('view', $position);

        return response()->json(['data' => $position]);
    }

    public function update(UpdatePositionRequest $request, string $id): JsonResponse
    {
        $position = Position::where('organization_id', $request->user()->organization_id)
            ->findOrFail($id);

        $this->authorize('update', $position);

        $position = $this->service->updatePosition($position, $request->validated());

        return response()->json(['data' => $position]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $position = Position::where('organization_id', $request->user()->organization_id)
            ->findOrFail($id);

        $this->authorize('delete', $position);

        $this->service->archivePosition($position);

        return response()->json(['message' => 'Position archived.']);
    }
}
