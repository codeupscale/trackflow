<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
use App\Models\LeaveType;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

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

    public function store(Request $request): JsonResponse
    {
        $this->authorize('create', LeaveType::class);

        $orgId = $request->user()->organization_id;

        $validated = $request->validate([
            'name' => 'required|string|max:100',
            'code' => [
                'required', 'string', 'max:20',
                Rule::unique('leave_types', 'code')->where('organization_id', $orgId),
            ],
            'is_paid' => 'sometimes|boolean',
            'days_per_year' => 'required|numeric|min:0|max:365',
            'accrual_type' => 'sometimes|string|in:upfront,monthly,anniversary',
            'carryover_days' => 'sometimes|numeric|min:0',
            'max_consecutive_days' => 'nullable|integer|min:1',
            'requires_document' => 'sometimes|boolean',
            'requires_approval' => 'sometimes|boolean',
            'applicable_genders' => 'sometimes|string|in:all,male,female',
        ]);

        $leaveType = LeaveType::create([
            'organization_id' => $request->user()->organization_id,
            ...$validated,
        ]);

        return response()->json(['leave_type' => $leaveType], 201);
    }
}
