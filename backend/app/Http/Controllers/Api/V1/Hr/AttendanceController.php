<?php

namespace App\Http\Controllers\Api\V1\Hr;

use App\Http\Controllers\Controller;
use App\Models\AttendanceRecord;
use App\Services\AttendanceService;
use App\Services\CheckInService;
use App\Support\ReportExportFormatter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class AttendanceController extends Controller
{
    public function __construct(
        private readonly AttendanceService $attendanceService,
        private readonly CheckInService $checkInService,
    ) {}

    /**
     * Check in for the current org-local day. No request body is accepted —
     * the server clock is authoritative.
     */
    public function checkIn(Request $request): JsonResponse
    {
        $this->authorize('checkIn', AttendanceRecord::class);

        $this->checkInService->checkIn($request->user());

        return response()->json([
            'message' => 'Checked in successfully.',
            'data' => $this->checkInService->getTodayStatus($request->user()),
        ], 201);
    }

    /**
     * Check out, closing the open session. No request body is accepted.
     */
    public function checkOut(Request $request): JsonResponse
    {
        $this->authorize('checkIn', AttendanceRecord::class);

        $this->checkInService->checkOut($request->user());

        return response()->json([
            'message' => 'Checked out successfully.',
            'data' => $this->checkInService->getTodayStatus($request->user()),
        ]);
    }

    /**
     * Today's check-in status for the authenticated user.
     */
    public function todayStatus(Request $request): JsonResponse
    {
        $this->authorize('checkIn', AttendanceRecord::class);

        return response()->json([
            'data' => $this->checkInService->getTodayStatus($request->user()),
        ]);
    }

    /**
     * Role-scoped list of check-in records (paginated).
     */
    public function checkInsIndex(Request $request): JsonResponse
    {
        $this->authorize('viewCheckIns', AttendanceRecord::class);

        $request->validate([
            'start_date' => ['sometimes', 'date'],
            'end_date' => ['sometimes', 'date', 'after_or_equal:start_date'],
            'user_id' => ['sometimes', 'uuid'],
            'status' => ['sometimes', 'string', 'in:present,absent,half_day,on_leave,weekend,holiday'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);

        $records = $this->checkInService->listCheckIns(
            $request->user(),
            $request->only(['start_date', 'end_date', 'user_id', 'status', 'per_page'])
        );

        return response()->json($records);
    }

    /**
     * Per-employee check-in rollup for a day or month (role-scoped, paginated).
     */
    public function checkInsSummary(Request $request): JsonResponse
    {
        $this->authorize('viewCheckIns', AttendanceRecord::class);

        $request->validate([
            'period' => ['sometimes', 'in:day,month'],
            'date' => ['sometimes', 'date_format:Y-m-d'],
            'month' => ['sometimes', 'date_format:Y-m'],
            'user_id' => ['sometimes', 'uuid'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);

        $summary = $this->checkInService->summarize(
            $request->user(),
            $request->only(['period', 'date', 'month', 'user_id', 'per_page'])
        );

        return response()->json($summary);
    }

    /**
     * Download a check-in report (CSV) for a day or month, all employees or one.
     * Streamed synchronously as an attachment — matches the Reports export contract.
     */
    public function checkInsExport(Request $request): Response
    {
        $this->authorize('export', AttendanceRecord::class);

        $request->validate([
            'period' => ['sometimes', 'in:day,month'],
            'date' => ['sometimes', 'date_format:Y-m-d'],
            'month' => ['sometimes', 'date_format:Y-m'],
            'user_id' => ['sometimes', 'uuid'],
            'view' => ['sometimes', 'in:detail,summary'],
            'format' => ['sometimes', 'in:csv'],
        ]);

        $user = $request->user();
        $filters = $request->only(['period', 'date', 'month', 'user_id']);
        $view = $request->input('view', 'detail');

        $csv = $view === 'summary'
            ? ReportExportFormatter::checkInSummary($this->checkInService->summaryRowGenerator($user, $filters))
            : ReportExportFormatter::checkInDetail($this->checkInService->detailRowGenerator($user, $filters));

        $period = $request->input('period', 'day');
        $range = $period === 'month'
            ? $request->input('month', now()->format('Y-m'))
            : $request->input('date', now()->toDateString());
        $filename = "check-ins-{$view}-{$period}-{$range}";

        return response($csv, 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => "attachment; filename=\"{$filename}.csv\"",
        ]);
    }

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
