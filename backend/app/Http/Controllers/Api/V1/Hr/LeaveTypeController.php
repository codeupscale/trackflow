<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
use App\Http\Requests\Hr\StoreLeaveTypeRequest;
use App\Models\LeaveType;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LeaveTypeController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $leaveTypes = LeaveType::where('organization_id', $request->user()->organization_id)
            ->where('is_active', true)
            ->orderBy('name')
            ->paginate(25);

        return response()->json($leaveTypes);
    }

    public function store(StoreLeaveTypeRequest $request): JsonResponse
    {
        $leaveType = LeaveType::create([
            'organization_id' => $request->user()->organization_id,
            ...$request->validated(),
        ]);

        return response()->json(['data' => $leaveType], 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        if (! $request->user()->hasRole('owner', 'admin')) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $leaveType = LeaveType::where('organization_id', $request->user()->organization_id)
            ->findOrFail($id);

        $validated = $request->validate([
            'name' => 'sometimes|string|max:100',
            'is_paid' => 'sometimes|boolean',
            'days_per_year' => 'sometimes|numeric|min:0|max:365',
            'accrual_type' => 'sometimes|string|in:upfront,monthly,anniversary',
            'carryover_days' => 'sometimes|numeric|min:0',
            'max_consecutive_days' => 'nullable|integer|min:1',
            'requires_document' => 'sometimes|boolean',
            'requires_approval' => 'sometimes|boolean',
            'applicable_genders' => 'sometimes|string|in:all,male,female',
        ]);

        $leaveType->update($validated);

        return response()->json(['data' => $leaveType]);
    }
}
