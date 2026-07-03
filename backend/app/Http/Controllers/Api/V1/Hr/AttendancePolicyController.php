<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
use App\Models\AttendancePolicy;
use App\Services\CheckInService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

class AttendancePolicyController extends Controller
{
    public function __construct(
        private readonly CheckInService $checkInService,
    ) {}

    /**
     * Show the org's attendance check-in policy (created with defaults if absent).
     */
    public function show(Request $request): JsonResponse
    {
        $this->authorize('view', AttendancePolicy::class);

        $policy = $this->checkInService->getPolicy($request->user()->organization_id);

        return response()->json(['data' => $policy]);
    }

    /**
     * Update the org's attendance check-in policy. Times must remain correctly
     * ordered: check_in_time <= late_threshold < checkout_time.
     */
    public function update(Request $request): JsonResponse
    {
        $this->authorize('managePolicy', AttendancePolicy::class);

        $orgId = $request->user()->organization_id;

        $validator = Validator::make($request->all(), [
            'check_in_time' => ['sometimes', 'date_format:H:i,H:i:s'],
            'late_threshold' => ['sometimes', 'date_format:H:i,H:i:s'],
            'checkout_time' => ['sometimes', 'date_format:H:i,H:i:s'],
            'timezone' => ['sometimes', 'timezone'],
            'allow_early_check_in' => ['sometimes', 'boolean'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        // Cross-field time ordering, evaluated against the effective (incoming or
        // existing) values so partial updates are validated correctly.
        $validator->after(function ($v) use ($request, $orgId) {
            if ($v->errors()->isNotEmpty()) {
                return; // don't compare malformed times
            }

            $policy = $this->checkInService->getPolicy($orgId);
            $checkIn = $request->input('check_in_time', $policy->check_in_time);
            $late = $request->input('late_threshold', $policy->late_threshold);
            $off = $request->input('checkout_time', $policy->checkout_time);

            if (strtotime($late) < strtotime($checkIn)) {
                $v->errors()->add('late_threshold', 'The late threshold must be at or after the check-in time.');
            }

            if (strtotime($off) <= strtotime($late)) {
                $v->errors()->add('checkout_time', 'The checkout time must be after the late threshold.');
            }
        });

        $data = $validator->validate();

        $policy = $this->checkInService->updatePolicy($orgId, $data);

        return response()->json([
            'message' => 'Attendance policy updated.',
            'data' => $policy,
        ]);
    }
}
