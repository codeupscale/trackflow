<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
use App\Http\Requests\Hr\StoreShiftRequest;
use App\Http\Requests\Hr\UpdateShiftRequest;
use App\Models\Shift;
use App\Services\ShiftService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ShiftController extends Controller
{
    public function __construct(
        private readonly ShiftService $shiftService,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', Shift::class);

        $shifts = $this->shiftService->listShifts(
            $request->user()->organization_id,
            $request->only(['is_active', 'search', 'per_page']),
        );

        // Per-row rights, so the UI never has to re-derive ownership rules (a
        // team manager may edit only shifts they created).
        $actor = $request->user();
        $shifts->getCollection()->transform(function (Shift $shift) use ($actor) {
            $data = $shift->toArray();
            $data['creator'] = $shift->creator ? [
                'id' => $shift->creator->id,
                'name' => $shift->creator->name,
            ] : null;
            $data['can_edit'] = $actor->can('update', $shift);
            $data['can_delete'] = $actor->can('delete', $shift);

            return $data;
        });

        return response()->json($shifts);
    }

    public function store(StoreShiftRequest $request): JsonResponse
    {
        $this->authorize('create', Shift::class);

        $shift = $this->shiftService->createShift(
            $request->user()->organization_id,
            $request->validated(),
            $request->user(),
        );

        return response()->json(['data' => $shift], 201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $shift = Shift::where('organization_id', $request->user()->organization_id)
            ->findOrFail($id);

        $this->authorize('view', $shift);

        $shift = $this->shiftService->getShift($request->user()->organization_id, $id);

        return response()->json(['data' => $shift]);
    }

    public function update(UpdateShiftRequest $request, string $id): JsonResponse
    {
        $shift = Shift::where('organization_id', $request->user()->organization_id)
            ->findOrFail($id);

        $this->authorize('update', $shift);

        $updated = $this->shiftService->updateShift($shift, $request->validated());

        return response()->json(['data' => $updated]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $shift = Shift::where('organization_id', $request->user()->organization_id)
            ->findOrFail($id);

        $this->authorize('delete', $shift);

        $this->shiftService->deleteShift($shift);

        return response()->json(null, 204);
    }
}
