<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
use App\Http\Requests\Hr\UpdateOvertimeRuleRequest;
use App\Services\AttendanceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class OvertimeRuleController extends Controller
{
    public function __construct(
        private readonly AttendanceService $attendanceService,
    ) {}

    /**
     * Get the organization's overtime rule.
     */
    public function show(Request $request): JsonResponse
    {
        $rule = $this->attendanceService->getOvertimeRule(
            $request->user()->organization_id
        );

        return response()->json(['data' => $rule]);
    }

    /**
     * Update the organization's overtime rule (admin only).
     */
    public function update(UpdateOvertimeRuleRequest $request): JsonResponse
    {
        $this->authorize('manage', \App\Models\AttendanceRecord::class);

        $rule = $this->attendanceService->updateOvertimeRule(
            $request->user()->organization_id,
            $request->validated()
        );

        return response()->json(['message' => 'Overtime rule updated.', 'data' => $rule]);
    }
}
