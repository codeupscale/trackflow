<?php

namespace App\Services;

use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class DailyActivitySummaryService
{
    /**
     * Maximum duration (in seconds) for a single time entry.
     * Matches ReportService::MAX_ENTRY_DURATION.
     */
    private const MAX_ENTRY_DURATION = 43200;

    /**
     * SQL expression for capped duration (consistent with ReportService).
     */
    private static function durationExpr(string $prefix = ''): string
    {
        $cap = self::MAX_ENTRY_DURATION;
        $startCol = $prefix ? "{$prefix}.started_at" : 'started_at';
        $endCol = $prefix ? "{$prefix}.ended_at" : 'ended_at';

        return "LEAST(GREATEST(EXTRACT(EPOCH FROM ({$endCol} - {$startCol}))::int, 0), {$cap})";
    }

    /**
     * Gather daily activity summary for a single user on a given date.
     *
     * @return array{
     *     total_seconds: int,
     *     tracked_seconds: int,
     *     idle_seconds: int,
     *     activity_percentage: int,
     *     projects: array<int, array{name: string, color: string|null, total_seconds: int}>
     * }
     */
    public function getUserDailySummary(string $organizationId, string $userId, string $date): array
    {
        $dateStart = $date . ' 00:00:00';
        $dateEnd = $date . ' 23:59:59';

        $dur = self::durationExpr();

        // Aggregate totals for the user on this date, scoped by organization_id
        $totals = TimeEntry::withoutGlobalScopes()
            ->where('organization_id', $organizationId)
            ->where('user_id', $userId)
            ->where('started_at', '>=', $dateStart)
            ->where('started_at', '<=', $dateEnd)
            ->whereNotNull('ended_at')
            ->selectRaw("
                COALESCE(SUM({$dur}), 0) as total_seconds,
                COALESCE(SUM(CASE WHEN type = 'tracked' THEN {$dur} ELSE 0 END), 0) as tracked_seconds,
                COALESCE(SUM(CASE WHEN type = 'idle' THEN {$dur} ELSE 0 END), 0) as idle_seconds,
                CASE
                    WHEN SUM(CASE WHEN activity_score IS NOT NULL AND activity_score > 0
                         THEN {$dur} ELSE 0 END) > 0
                    THEN SUM(COALESCE(activity_score, 0) * {$dur})
                         / SUM(CASE WHEN activity_score IS NOT NULL AND activity_score > 0
                               THEN {$dur} ELSE 0 END)
                    ELSE 0
                END as activity_avg
            ")
            ->first();

        $totalSeconds = (int) ($totals->total_seconds ?? 0);
        $trackedSeconds = (int) ($totals->tracked_seconds ?? 0);
        $idleSeconds = (int) ($totals->idle_seconds ?? 0);
        $activityPercentage = (int) round($totals->activity_avg ?? 0);

        // Project breakdown, scoped by organization_id
        $teDur = self::durationExpr('time_entries');

        $projects = DB::table('time_entries')
            ->where('time_entries.organization_id', $organizationId)
            ->where('time_entries.user_id', $userId)
            ->where('time_entries.started_at', '>=', $dateStart)
            ->where('time_entries.started_at', '<=', $dateEnd)
            ->whereNotNull('time_entries.ended_at')
            ->whereNotNull('time_entries.project_id')
            ->join('projects', 'time_entries.project_id', '=', 'projects.id')
            ->selectRaw("
                projects.name as name,
                projects.color as color,
                COALESCE(SUM({$teDur}), 0) as total_seconds
            ")
            ->groupBy('projects.id', 'projects.name', 'projects.color')
            ->orderByDesc('total_seconds')
            ->get()
            ->map(fn ($row) => [
                'name' => $row->name,
                'color' => $row->color,
                'total_seconds' => (int) $row->total_seconds,
            ])
            ->all();

        return [
            'total_seconds' => $totalSeconds,
            'tracked_seconds' => $trackedSeconds,
            'idle_seconds' => $idleSeconds,
            'activity_percentage' => $activityPercentage,
            'projects' => $projects,
        ];
    }

    /**
     * Get active employees for an organization who should receive daily summaries.
     * Only employees receive this email — owners, admins, and managers are excluded.
     *
     * @return \Illuminate\Support\Collection<int, User>
     */
    public function getEligibleUsers(string $organizationId): \Illuminate\Support\Collection
    {
        return User::withoutGlobalScopes()
            ->where('organization_id', $organizationId)
            ->where('role', 'employee')
            ->where('is_active', true)
            ->whereNotNull('email')
            ->get();
    }
}
