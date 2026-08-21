<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\PermissionService;
use App\Services\ReportService;
use App\Support\ReportExportFormatter;
use App\Support\TimezoneAwareDateRange;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Cache;

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


    /**
     * Which user(s) the actor is allowed to see, honouring the requested filter.
     *
     * Returns a single id, a list of ids, or null for "everyone in the organization".
     *
     * The decision comes from the SCOPE on the actor's `reports.view` grant, never
     * from a role name. Two reasons the old `$user->isEmployee()` test was wrong:
     *
     *  - `reports.view` is granted to the `employee` role at scope `own`, so an
     *    employee legitimately reaches these endpoints. The web client gates the
     *    user picker on merely HOLDING the permission, so it rendered a full team
     *    dropdown, sent `user_id`, and the controller then silently clamped every
     *    request back to the caller. Picking any user — or "All Users" — returned
     *    the logged-in user's own figures.
     *  - `isEmployee()` reads the `users.role` STRING, which is only a fallback for
     *    users with no `user_roles` row, and the role set is open (orgs define custom
     *    roles). Deciding data visibility from it is wrong in both directions.
     */
    /**
     * May the actor see anyone other than themselves? Team, projects, payroll and
     * attendance reports are inherently about other people, so an `own`-scoped
     * actor has nothing to see in them.
     */
    private function canViewOthers(Request $request): bool
    {
        $user = $request->user();

        return ($user->getRawOriginal('role') ?? '') === 'owner'
            || app(PermissionService::class)->hasPermission($user, 'reports.view', 'project');
    }

    private function scopedUserId(Request $request): string|array|null
    {
        $user = $request->user();
        $requested = $request->input('user_id') ?: null;
        $scope = app(PermissionService::class)->getScope($user, 'reports.view');

        // Owners bypass the permission map entirely, as they do everywhere else.
        if ($scope === 'organization' || ($user->getRawOriginal('role') ?? '') === 'owner') {
            return $requested;
        }

        if ($scope === 'project') {
            $visible = app(PermissionService::class)->getProjectUserIds($user);

            // A requested user outside the actor's team narrows to nothing rather
            // than widening the scope — same contract as ProjectTimeReportService.
            if ($requested !== null) {
                return in_array($requested, $visible, true) ? $requested : $user->id;
            }

            return $visible;
        }

        // 'own', or no grant at all.
        return $user->id;
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
        $userId = $this->scopedUserId($request);

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
        if (! $this->canViewOthers($request)) {
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

        $userId = $this->scopedUserId($request);

        [$dateFrom, $dateTo] = $this->parseDateRange($request);

        // App usage summaries bucket by org-local calendar date, not UTC instants.
        $data = $this->reportService->apps(
            $request->user()->organization_id,
            $userId,
            $request->date_from,
            $request->date_to,
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

        // `user_id` is required here, so the resolver always yields a single id
        // (it only returns a list when no specific user was asked for).
        $scoped = $this->scopedUserId($request);
        $userId = is_array($scoped) ? $request->user()->id : ($scoped ?? $request->user()->id);

        $data = $this->reportService->timeline(
            $request->user()->organization_id,
            $userId,
            $request->date
        );

        return response()->json($data);
    }

    // REPT-06: Export — generates the file synchronously and streams it back as a
    // download. Honors the optional single-user filter for user-scoped report types.
    public function export(Request $request): Response
    {
        $request->validate([
            'type' => 'required|in:summary,team,projects,apps,payroll,attendance',
            'format' => 'required|in:pdf,csv',
            'date_from' => 'required|date',
            'date_to' => 'required|date|after_or_equal:date_from',
            'user_id' => 'nullable|uuid',
        ]);

        $user = $request->user();
        $orgId = $user->organization_id;

        // Employees can only ever export their own data.
        $userId = $this->scopedUserId($request);

        [$dateFrom, $dateTo] = $this->parseDateRange($request);

        // summary is user-scoped; team/projects/payroll/attendance are org-wide.
        // apps uses calendar dates on app_usage_summaries.
        $data = match ($request->type) {
            'summary' => $this->reportService->summary($orgId, $userId, $dateFrom, $dateTo),
            'team' => $this->reportService->team($orgId, $dateFrom, $dateTo),
            'projects' => $this->reportService->projects($orgId, $dateFrom, $dateTo),
            'apps' => $this->reportService->apps(
                $orgId,
                $userId,
                $request->date_from,
                $request->date_to,
            ),
            'payroll' => $this->reportService->payroll($orgId, $dateFrom, $dateTo),
            'attendance' => $this->reportService->attendance($orgId, $dateFrom, $dateTo),
        };

        $filename = "report-{$request->type}-{$request->date_from}-to-{$request->date_to}";

        if ($request->format === 'csv') {
            return response(ReportExportFormatter::csv($request->type, $data), 200, [
                'Content-Type' => 'text/csv; charset=UTF-8',
                'Content-Disposition' => "attachment; filename=\"{$filename}.csv\"",
            ]);
        }

        return response(ReportExportFormatter::pdf($request->type, $data, $request->date_from, $request->date_to), 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => "attachment; filename=\"{$filename}.pdf\"",
        ]);
    }

    // REPT-07: Payroll
    public function payroll(Request $request): JsonResponse
    {
        if (!$request->user()->hasRole('owner', 'org_manager', 'hr_manager', 'finance_manager')) {
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
        if (! $this->canViewOthers($request)) {
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

    // REPT-11: Activity by day of week
    public function activityByDay(Request $request): JsonResponse
    {
        $request->validate([
            'date_from' => 'required|date',
            'date_to' => 'required|date|after_or_equal:date_from',
            'user_id' => 'nullable|uuid',
        ]);

        $user = $request->user();
        $userId = $this->scopedUserId($request);

        [$dateFrom, $dateTo] = $this->parseDateRange($request);

        $data = $this->reportService->activityByDay(
            $user->organization_id,
            $userId,
            $dateFrom,
            $dateTo
        );

        return response()->json(['data' => $data]);
    }

    // REPT-12: Detailed time logs (paginated)
    public function timeLogs(Request $request): JsonResponse
    {
        $request->validate([
            'date_from' => 'required|date',
            'date_to' => 'required|date|after_or_equal:date_from',
            'user_id' => 'nullable|uuid',
            'page' => 'nullable|integer|min:1',
        ]);

        $user = $request->user();
        $userId = $this->scopedUserId($request);

        [$dateFrom, $dateTo] = $this->parseDateRange($request);

        $paginator = $this->reportService->timeLogs(
            $user->organization_id,
            $userId,
            $dateFrom,
            $dateTo,
            15
        );

        return response()->json($paginator);
    }

    // REPT-09: Analytics
    public function analytics(Request $request): JsonResponse
    {
        $request->validate([
            'date_from' => 'required|date',
            'date_to' => 'required|date|after_or_equal:date_from',
            'user_id' => 'nullable|uuid',
        ]);

        $user = $request->user();
        $userId = $this->scopedUserId($request);

        [$dateFrom, $dateTo] = $this->parseDateRange($request);

        $data = $this->reportService->analytics(
            $user->organization_id,
            $userId,
            $dateFrom,
            $dateTo
        );

        return response()->json($data);
    }

    // REPT-10: Detailed Logs
    public function detailedLogs(Request $request): JsonResponse
    {
        $request->validate([
            'date_from' => 'required|date',
            'date_to' => 'required|date|after_or_equal:date_from',
            'user_id' => 'nullable|uuid',
            'per_page' => 'nullable|integer|min:1|max:50',
        ]);

        $user = $request->user();
        $userId = $this->scopedUserId($request);

        [$dateFrom, $dateTo] = $this->parseDateRange($request);

        $data = $this->reportService->detailedLogs(
            $user->organization_id,
            $userId,
            $dateFrom,
            $dateTo,
            (int) ($request->per_page ?? 10),
            (int) ($request->page ?? 1)
        );

        return response()->json($data);
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
