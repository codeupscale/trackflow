<?php

namespace App\Services;

use App\Models\AppUsageSummary;
use App\Models\User;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;

class AppUsageService
{
    /**
     * Record a heartbeat's app usage into the daily summary.
     *
     * Upserts by (organization_id, user_id, date, app_name) and increments
     * duration_seconds by $intervalSeconds. Updates window_title to the latest value.
     */
    public function recordHeartbeat(User $user, string $appName, ?string $windowTitle, int $intervalSeconds): void
    {
        $today = now()->toDateString();

        // Use DB upsert for atomicity — avoids race conditions on concurrent heartbeats
        DB::table('app_usage_summaries')->upsert(
            [
                'id' => (string) \Illuminate\Support\Str::uuid(),
                'organization_id' => $user->organization_id,
                'user_id' => $user->id,
                'date' => $today,
                'app_name' => $appName,
                'window_title' => $windowTitle ? mb_substr($windowTitle, 0, 500) : null,
                'duration_seconds' => $intervalSeconds,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            ['organization_id', 'user_id', 'date', 'app_name'], // unique key columns
            [ // columns to update on conflict
                'duration_seconds' => DB::raw("app_usage_summaries.duration_seconds + {$intervalSeconds}"),
                'window_title' => $windowTitle ? mb_substr($windowTitle, 0, 500) : null,
                'updated_at' => now(),
            ]
        );
    }

    /**
     * Get daily app usage summary for a specific user and date.
     * Returns paginated results sorted by duration_seconds descending.
     */
    public function getDailySummary(string $orgId, string $userId, string $date): LengthAwarePaginator
    {
        return AppUsageSummary::withoutGlobalScopes()
            ->where('organization_id', $orgId)
            ->where('user_id', $userId)
            ->where('date', $date)
            ->orderByDesc('duration_seconds')
            ->paginate(20);
    }

    /**
     * Get team-wide app usage aggregated per user per app across a date range.
     * Org-scoped with explicit WHERE clause for raw query safety.
     */
    public function getTeamSummary(string $orgId, string $startDate, string $endDate): LengthAwarePaginator
    {
        return DB::table('app_usage_summaries')
            ->join('users', 'app_usage_summaries.user_id', '=', 'users.id')
            ->where('app_usage_summaries.organization_id', $orgId)
            ->whereBetween('app_usage_summaries.date', [$startDate, $endDate])
            ->select(
                'app_usage_summaries.user_id',
                'users.name as user_name',
                'app_usage_summaries.app_name',
                DB::raw('SUM(app_usage_summaries.duration_seconds) as total_seconds'),
                DB::raw('COUNT(DISTINCT app_usage_summaries.date) as days_used')
            )
            ->groupBy('app_usage_summaries.user_id', 'users.name', 'app_usage_summaries.app_name')
            ->orderByDesc('total_seconds')
            ->paginate(30);
    }

    /**
     * Get top apps across the entire organization for a date range.
     * Returns paginated results (use limit param on the frontend to control display).
     */
    public function getTopApps(string $orgId, string $startDate, string $endDate, int $limit = 10): LengthAwarePaginator
    {
        return DB::table('app_usage_summaries')
            ->where('organization_id', $orgId)
            ->whereBetween('date', [$startDate, $endDate])
            ->select(
                'app_name',
                DB::raw('SUM(duration_seconds) as total_seconds'),
                DB::raw('COUNT(DISTINCT user_id) as user_count'),
                DB::raw('COUNT(DISTINCT date) as days_active')
            )
            ->groupBy('app_name')
            ->orderByDesc('total_seconds')
            ->paginate($limit);
    }
}
