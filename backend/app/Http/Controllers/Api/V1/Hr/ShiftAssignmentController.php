<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
use App\Http\Requests\Hr\AssignShiftRequest;
use App\Http\Requests\Hr\BulkAssignShiftRequest;
use App\Models\Shift;
use App\Services\ShiftService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ShiftAssignmentController extends Controller
{
    public function __construct(
        private readonly ShiftService $shiftService,
    ) {}

    public function index(Request $request, string $shiftId): JsonResponse
    {
        $shift = Shift::where('organization_id', $request->user()->organization_id)
            ->findOrFail($shiftId);

        $this->authorize('manage', $shift);

        $assignments = $this->shiftService->getShiftAssignments(
            $request->user()->organization_id,
            $shiftId,
        );

        return response()->json($assignments);
    }

    public function assign(AssignShiftRequest $request, string $shiftId): JsonResponse
    {
        $shift = Shift::where('organization_id', $request->user()->organization_id)
            ->findOrFail($shiftId);

        $this->authorize('manage', $shift);

        $data = $request->validated();

        $this->shiftService->assignUser(
            $request->user()->organization_id,
            $data['user_id'],
            $shiftId,
            $data['effective_from'],
            $data['effective_to'] ?? null,
        );

        return response()->json(['message' => 'User assigned to shift.'], 201);
    }

    public function unassign(Request $request, string $shiftId): JsonResponse
    {
        $shift = Shift::where('organization_id', $request->user()->organization_id)
            ->findOrFail($shiftId);

        $this->authorize('manage', $shift);

        $request->validate([
            'user_id' => ['required', 'uuid'],
        ]);

        $this->shiftService->unassignUser(
            $request->user()->organization_id,
            $request->input('user_id'),
            $shiftId,
        );

        return response()->json(['message' => 'User unassigned from shift.']);
    }

    public function bulkAssign(BulkAssignShiftRequest $request, string $shiftId): JsonResponse
    {
        $shift = Shift::where('organization_id', $request->user()->organization_id)
            ->findOrFail($shiftId);

        $this->authorize('manage', $shift);

        $data = $request->validated();

        $count = $this->shiftService->bulkAssign(
            $request->user()->organization_id,
            $shiftId,
            $data['user_ids'],
            $data['effective_from'],
            $data['effective_to'] ?? null,
        );

        return response()->json(['data' => ['assigned_count' => $count]]);
    }
}
