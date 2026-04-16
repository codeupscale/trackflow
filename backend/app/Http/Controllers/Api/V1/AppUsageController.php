<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\AppUsageSummary;
use App\Services\AppUsageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AppUsageController extends Controller
{
    public function __construct(private AppUsageService $service) {}

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
}
