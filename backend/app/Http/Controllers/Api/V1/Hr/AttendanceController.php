<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
use App\Services\AttendanceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AttendanceController extends Controller
{
    public function __construct(
        private readonly AttendanceService $attendanceService,
    ) {}

    /**
     * Own attendance records (paginated, date range filter).
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'start_date' => ['sometimes', 'date'],
            'end_date' => ['sometimes', 'date', 'after_or_equal:start_date'],
            'status' => ['sometimes', 'string', 'in:present,absent,half_day,on_leave,weekend,holiday'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);

        $user = $request->user();

        $records = $this->attendanceService->getAttendance(
            $user->id,
            $user->organization_id,
            $request->only(['start_date', 'end_date', 'status', 'per_page'])
        );

        return response()->json($records);
    }

    /**
     * Team attendance (manager/admin): paginated with dept/user/date filters.
     */
    public function teamIndex(Request $request): JsonResponse
    {
        $this->authorize('viewTeam', \App\Models\AttendanceRecord::class);

        $request->validate([
            'start_date' => ['sometimes', 'date'],
            'end_date' => ['sometimes', 'date', 'after_or_equal:start_date'],
            'status' => ['sometimes', 'string', 'in:present,absent,half_day,on_leave,weekend,holiday'],
            'user_id' => ['sometimes', 'uuid'],
            'department_id' => ['sometimes', 'uuid'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);

        $records = $this->attendanceService->getTeamAttendance(
            $request->user()->organization_id,
            $request->only(['start_date', 'end_date', 'status', 'user_id', 'department_id', 'per_page'])
        );

        return response()->json($records);
    }

    /**
     * Monthly attendance summary for the authenticated user.
     */
    public function summary(Request $request): JsonResponse
    {
        $request->validate([
            'month' => ['required', 'integer', 'min:1', 'max:12'],
            'year' => ['required', 'integer', 'min:2020', 'max:2100'],
        ]);

        $user = $request->user();

        $summary = $this->attendanceService->getAttendanceSummary(
            $user->id,
            $user->organization_id,
            (int) $request->input('month'),
            (int) $request->input('year')
        );

        return response()->json(['data' => $summary]);
    }

    /**
     * Admin: trigger attendance generation for a specific date.
     */
    public function store(Request $request): JsonResponse
    {
        $this->authorize('manage', \App\Models\AttendanceRecord::class);

        $request->validate([
            'date' => ['required', 'date', 'before_or_equal:today'],
        ]);

        $count = $this->attendanceService->generateDailyAttendance(
            $request->user()->organization_id,
            $request->input('date')
        );

        return response()->json([
            'message' => "Attendance generated for {$count} users.",
            'data' => ['users_processed' => $count],
        ]);
    }
}
