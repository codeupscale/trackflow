<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\AppUsageSummary;
use App\Services\AppUsageService;
use App\Services\PermissionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class AppUsageController extends Controller
{
    public function __construct(
        private AppUsageService $service,
        private PermissionService $permissions,
    ) {}

    /**
     * GET /api/v1/app-usage/daily?date=&user_id=
     *
     * Returns daily app usage for the authenticated user (or a specified user
     * when the caller has team+ reports.view scope).
     */
    public function daily(Request $request): JsonResponse
    {
        $request->validate([
            'date' => 'required|date',
            'user_id' => 'nullable|uuid',
        ]);

        $this->authorize('viewDaily', [AppUsageSummary::class, $request->query('user_id')]);

        $userId = $request->query('user_id') ?? $request->user()->id;

        return response()->json(
            $this->service->getDailySummary(
                $request->user()->organization_id,
                $userId,
                $request->query('date')
            )
        );
    }

    /**
     * GET /api/v1/app-usage/team?start_date=&end_date=
     *
     * Returns team-wide app usage aggregated per user per app. Manager/admin only.
     */
    public function team(Request $request): JsonResponse
    {
        $request->validate([
            'start_date' => 'required|date',
            'end_date' => 'required|date|after_or_equal:start_date',
        ]);

        $this->authorize('viewTeam', AppUsageSummary::class);

        return response()->json(
            $this->service->getTeamSummary(
                $request->user()->organization_id,
                $request->query('start_date'),
                $request->query('end_date')
            )
        );
    }

    /**
     * GET /api/v1/app-usage/top?start_date=&end_date=&limit=10
     *
     * Returns org-wide top apps by duration. Admin only.
     */
    public function top(Request $request): JsonResponse
    {
        $request->validate([
            'start_date' => 'required|date',
            'end_date' => 'required|date|after_or_equal:start_date',
            'limit' => 'nullable|integer|min:1|max:50',
        ]);

        $this->authorize('viewTop', AppUsageSummary::class);

        return response()->json(
            $this->service->getTopApps(
                $request->user()->organization_id,
                $request->query('start_date'),
                $request->query('end_date'),
                (int) $request->query('limit', 10)
            )
        );
    }

    /**
     * GET /api/v1/app-usage/export?format=csv|pdf&view=my|team|top&...
     */
    public function export(Request $request): Response
    {
        abort_unless(
            $this->permissions->hasPermission($request->user(), 'reports.export'),
            403,
            'You do not have permission to export reports.'
        );

        $validated = $request->validate([
            'format' => ['required', 'in:csv,pdf'],
            'view' => ['required', 'in:my,team,top'],
            'date' => ['nullable', 'date', 'required_if:view,my'],
            'user_id' => ['nullable', 'uuid'],
            'start_date' => ['nullable', 'date', 'required_unless:view,my'],
            'end_date' => ['nullable', 'date', 'required_unless:view,my', 'after_or_equal:start_date'],
        ]);

        $view = $validated['view'];
        if ($view === 'my') {
            $this->authorize('viewDaily', [AppUsageSummary::class, $request->query('user_id')]);
        } elseif ($view === 'team') {
            $this->authorize('viewTeam', AppUsageSummary::class);
        } else {
            $this->authorize('viewTop', AppUsageSummary::class);
        }

        $actor = $request->user();

        return $validated['format'] === 'pdf'
            ? $this->service->pdf($actor, $validated)
            : $this->service->csv($actor, $validated);
    }
}
