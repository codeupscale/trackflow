<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Jobs\GenerateReportJob;
use App\Services\ReportService;
use App\Support\TimezoneAwareDateRange;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

class ReportController extends Controller
{
    public function __construct(private ReportService $reportService) {}

    private function parseDateRange(Request $request): array
    {
        $tz = $request->user()->getTimezoneForDates();
        return TimezoneAwareDateRange::toUtcBounds(
            $request->date_from,
            $request->date_to,
            $tz
        );
    }

    // REPT-01: Summary
    public function summary(Request $request): JsonResponse
    {
        $request->validate([
            'date_from' => 'required|date',
            'date_to' => 'required|date|after_or_equal:date_from',
            'user_id' => 'nullable|uuid',
        ]);

        $user = $request->user();
        $userId = $request->user_id;

        if ($user->isEmployee()) {
            $userId = $user->id;
        }

        [$dateFrom, $dateTo] = $this->parseDateRange($request);

        $data = $this->reportService->summary(
            $user->organization_id,
            $userId,
            $dateFrom,
            $dateTo
        );

        return response()->json($data);
    }

    // REPT-02: Team
    public function team(Request $request): JsonResponse
    {
        if ($request->user()->isEmployee()) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $request->validate([
            'date_from' => 'required|date',
            'date_to' => 'required|date|after_or_equal:date_from',
        ]);

        [$dateFrom, $dateTo] = $this->parseDateRange($request);

        $data = $this->reportService->team(
            $request->user()->organization_id,
            $dateFrom,
            $dateTo
        );

        return response()->json(['team' => $data]);
    }

    // REPT-03: Projects
    public function projects(Request $request): JsonResponse
    {
        $request->validate([
            'date_from' => 'required|date',
            'date_to' => 'required|date|after_or_equal:date_from',
        ]);

        [$dateFrom, $dateTo] = $this->parseDateRange($request);

        $data = $this->reportService->projects(
            $request->user()->organization_id,
            $dateFrom,
            $dateTo
        );

        return response()->json(['projects' => $data]);
    }

    // REPT-04: Apps
    public function apps(Request $request): JsonResponse
    {
        $request->validate([
            'date_from' => 'required|date',
            'date_to' => 'required|date|after_or_equal:date_from',
            'user_id' => 'nullable|uuid',
        ]);

        $userId = $request->user_id;
        if ($request->user()->isEmployee()) {
            $userId = $request->user()->id;
        }

        [$dateFrom, $dateTo] = $this->parseDateRange($request);

        $data = $this->reportService->apps(
            $request->user()->organization_id,
            $userId,
            $dateFrom,
            $dateTo
        );

        return response()->json(['apps' => $data]);
    }

    // REPT-05: Timeline
    public function timeline(Request $request): JsonResponse
    {
        $request->validate([
            'user_id' => 'required|uuid',
            'date' => 'required|date',
        ]);

        $userId = $request->user_id;
        if ($request->user()->isEmployee()) {
            $userId = $request->user()->id;
        }

        $data = $this->reportService->timeline(
            $request->user()->organization_id,
            $userId,
            $request->date
        );

        return response()->json($data);
    }

    // REPT-06: Export
    public function export(Request $request): JsonResponse
    {
        $request->validate([
            'type' => 'required|in:summary,team,projects,payroll,attendance',
            'format' => 'required|in:pdf,csv',
            'date_from' => 'required|date',
            'date_to' => 'required|date|after_or_equal:date_from',
        ]);

        [$dateFrom, $dateTo] = $this->parseDateRange($request);

        $jobId = Str::uuid()->toString();

        GenerateReportJob::dispatch(
            $jobId,
            $request->user()->organization_id,
            $request->user()->id,
            $request->type,
            $request->format,
            $dateFrom,
            $dateTo
        );

        return response()->json(['job_id' => $jobId], 202);
    }

    // REPT-07: Payroll
    public function payroll(Request $request): JsonResponse
    {
        if (!$request->user()->hasRole('owner', 'admin')) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $request->validate([
            'date_from' => 'required|date',
            'date_to' => 'required|date|after_or_equal:date_from',
        ]);

        [$dateFrom, $dateTo] = $this->parseDateRange($request);

        $data = $this->reportService->payroll(
            $request->user()->organization_id,
            $dateFrom,
            $dateTo
        );

        return response()->json(['payroll' => $data]);
    }

    // REPT-08: Attendance
    public function attendance(Request $request): JsonResponse
    {
        if ($request->user()->isEmployee()) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $request->validate([
            'date_from' => 'required|date',
            'date_to' => 'required|date|after_or_equal:date_from',
        ]);

        [$dateFrom, $dateTo] = $this->parseDateRange($request);

        $data = $this->reportService->attendance(
            $request->user()->organization_id,
            $dateFrom,
            $dateTo
        );

        return response()->json(['attendance' => $data]);
    }

    // Job status check
    public function jobStatus(string $id): JsonResponse
    {
        $status = Cache::get("job:{$id}:status", 'pending');
        $url = Cache::get("job:{$id}:url");
        $error = Cache::get("job:{$id}:error");

        return response()->json([
            'job_id' => $id,
            'status' => $status,
            'download_url' => $url,
            'error' => $error,
        ]);
    }
}
