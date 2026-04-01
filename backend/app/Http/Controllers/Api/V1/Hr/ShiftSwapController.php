<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
use App\Http\Requests\Hr\RejectShiftSwapRequest;
use App\Http\Requests\Hr\StoreShiftSwapRequest;
use App\Models\ShiftSwapRequest;
use App\Services\ShiftService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ShiftSwapController extends Controller
{
    public function __construct(
        private readonly ShiftService $shiftService,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', ShiftSwapRequest::class);

        $swaps = $this->shiftService->listSwapRequests(
            $request->user()->organization_id,
            $request->user(),
            $request->only(['status', 'per_page']),
        );

        return response()->json($swaps);
    }

    public function store(StoreShiftSwapRequest $request): JsonResponse
    {
        $this->authorize('create', ShiftSwapRequest::class);

        $swap = $this->shiftService->createSwapRequest(
            $request->user(),
            $request->validated(),
        );

        return response()->json(['data' => $swap], 201);
    }

    public function approve(Request $request, string $id): JsonResponse
    {
        $swap = ShiftSwapRequest::where('organization_id', $request->user()->organization_id)
            ->findOrFail($id);

        $this->authorize('approve', $swap);

        if ($swap->status !== 'pending') {
            return response()->json(['message' => 'Only pending swap requests can be approved.'], 422);
        }

        $result = $this->shiftService->approveSwap($swap, $request->user());

        return response()->json(['message' => 'Swap request approved.', 'data' => $result]);
    }

    public function reject(RejectShiftSwapRequest $request, string $id): JsonResponse
    {
        $swap = ShiftSwapRequest::where('organization_id', $request->user()->organization_id)
            ->findOrFail($id);

        $this->authorize('approve', $swap);

        if ($swap->status !== 'pending') {
            return response()->json(['message' => 'Only pending swap requests can be rejected.'], 422);
        }

        $result = $this->shiftService->rejectSwap(
            $swap,
            $request->user(),
            $request->validated('reviewer_note'),
        );

        return response()->json(['message' => 'Swap request rejected.', 'data' => $result]);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $swap = ShiftSwapRequest::where('organization_id', $request->user()->organization_id)
            ->findOrFail($id);

        $this->authorize('delete', $swap);

        $this->shiftService->cancelSwap($swap);

        return response()->json(null, 204);
    }
}
