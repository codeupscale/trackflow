<?php

namespace App\Services;

use App\Models\TimeEntry;
use App\Models\ActivityLog;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class ReportService
{
    /**
     * Maximum duration (in seconds) for a single time entry in reports.
     * Any entry exceeding this is capped to prevent runaway timers from
     * corrupting report totals. 12 hours = 43200 seconds.
     */
    private const MAX_ENTRY_DURATION = 43200;

    /**
     * SQL expression for capped duration: compute from timestamps (more accurate
     * than duration_seconds which can be corrupted), then cap at MAX_ENTRY_DURATION.
     */
    private static function durationExpr(string $prefix = ''): string
    {
        $cap = self::MAX_ENTRY_DURATION;
        $startCol = $prefix ? "{$prefix}.started_at" : 'started_at';
        $endCol = $prefix ? "{$prefix}.ended_at" : 'ended_at';
        return "LEAST(GREATEST(EXTRACT(EPOCH FROM ({$endCol} - {$startCol}))::int, 0), {$cap})";
    }

    private function cacheKey(string $orgId, string $type, string $period, ?string $userId = null): string
    {
        $userHash = $userId ? md5($userId) : 'all';
        // Include period in hash to ensure different date ranges get different cache entries
        return "report:{$orgId}:{$type}:" . md5("{$period}:{$userHash}");
    }

    // REPT-01: Summary report
    public function summary(string $orgId, ?string $userId, string $dateFrom, string $dateTo): array
    {
        $cacheKey = $this->cacheKey($orgId, 'summary', "{$dateFrom}_{$dateTo}", $userId);

        return Cache::remember($cacheKey, 900, function () use ($orgId, $userId, $dateFrom, $dateTo) {
            // Daily breakdown with duration-weighted activity (single query)
            $query = TimeEntry::withoutGlobalScopes()
                ->where('organization_id', $orgId)
                ->where('started_at', '>=', $dateFrom)
                ->where('started_at', '<', $dateTo)
                ->whereNotNull('ended_at');

            if ($userId) {
                $query->where('user_id', $userId);
            }

            $dur = self::durationExpr();

            // Use EXTRACT(EPOCH FROM ...) for accurate duration — duration_seconds
            // can be corrupted by idle-deduction bugs in older desktop versions.
            // Cap each entry at MAX_ENTRY_DURATION to prevent runaway timers.
            $daily = $query->selectRaw("
                DATE(started_at) as date,
                SUM({$dur}) as total_seconds,
                CASE
                    WHEN SUM(CASE WHEN activity_score IS NOT NULL AND activity_score > 0
                         THEN {$dur} ELSE 0 END) > 0
                    THEN SUM(COALESCE(activity_score, 0) * {$dur})
                         / SUM(CASE WHEN activity_score IS NOT NULL AND activity_score > 0
                               THEN {$dur} ELSE 0 END)
                    ELSE 0
                END as activity_score_avg,
                COUNT(*) as entry_count,
                COALESCE(SUM(CASE WHEN type = 'tracked' THEN {$dur} ELSE 0 END), 0) as tracked_seconds,
                COALESCE(SUM(CASE WHEN type = 'idle' THEN {$dur} ELSE 0 END), 0) as idle_seconds
            ")
            ->groupBy(DB::raw('DATE(started_at)'))
            ->orderBy('date')
            ->get();

            $totalTrackedSeconds = (int) $daily->sum('tracked_seconds');
            $totalIdleSeconds = (int) $daily->sum('idle_seconds');
            $totalWithIdle = $totalTrackedSeconds + $totalIdleSeconds;
            $idlePercent = $totalWithIdle > 0 ? round($totalIdleSeconds / $totalWithIdle * 100, 1) : 0;

            // Earnings: single query with join (only if there are tracked entries)
            $totalEarnings = 0;
            if ($totalTrackedSeconds > 0) {
                $teDur = self::durationExpr('time_entries');

                $earningsQuery = DB::table('time_entries')
                    ->where('time_entries.organization_id', $orgId)
                    ->where('time_entries.started_at', '>=', $dateFrom)
                    ->where('time_entries.started_at', '<', $dateTo)
                    ->whereNotNull('time_entries.ended_at')
                    ->where('time_entries.type', 'tracked')
                    ->join('projects', 'time_entries.project_id', '=', 'projects.id')
                    ->where('projects.billable', true);

                if ($userId) {
                    $earningsQuery->where('time_entries.user_id', $userId);
                }

                $totalEarnings = $earningsQuery
                    ->selectRaw("COALESCE(SUM({$teDur} / 3600.0 * projects.hourly_rate), 0) as total_earnings")
                    ->value('total_earnings') ?? 0;
            }

            return [
                'daily' => $daily,
                'total_seconds' => $daily->sum('total_seconds'),
                'total_seconds_tracked' => $totalTrackedSeconds,
                'total_seconds_idle' => $totalIdleSeconds,
                'idle_hours' => round($totalIdleSeconds / 3600, 2),
                'idle_percent' => $idlePercent,
                'avg_activity' => $daily->avg('activity_score_avg'),
                'total_entries' => $daily->sum('entry_count'),
                'total_earnings' => round($totalEarnings, 2),
            ];
        });
    }

    // REPT-02: Team report — single aggregation query (no N+1)
    public function team(string $orgId, string $dateFrom, string $dateTo): array
    {
        $cacheKey = $this->cacheKey($orgId, 'team', "{$dateFrom}_{$dateTo}");

        return Cache::remember($cacheKey, 900, function () use ($orgId, $dateFrom, $dateTo) {
            $dur = self::durationExpr();

            // Single query: aggregate all metrics per user (fixes N+1: was 3 queries per user)
            $userStats = DB::table('time_entries')
                ->where('organization_id', $orgId)
                ->where('started_at', '>=', $dateFrom)
                ->where('started_at', '<', $dateTo)
                ->whereNotNull('ended_at')
                ->selectRaw("
                    user_id,
                    COALESCE(SUM({$dur}), 0) as total_seconds,
                    COUNT(*) as entry_count,
                    COALESCE(SUM(CASE WHEN type = 'tracked' THEN {$dur} ELSE 0 END), 0) as tracked_seconds,
                    COALESCE(SUM(CASE WHEN type = 'idle' THEN {$dur} ELSE 0 END), 0) as idle_seconds,
                    CASE
                        WHEN SUM(CASE WHEN activity_score IS NOT NULL AND activity_score > 0 THEN {$dur} ELSE 0 END) > 0
                        THEN SUM(COALESCE(activity_score, 0) * {$dur}) / SUM(CASE WHEN activity_score IS NOT NULL AND activity_score > 0 THEN {$dur} ELSE 0 END)
                        ELSE 0
                    END as avg_activity
                ")
                ->groupBy('user_id')
                ->get()
                ->keyBy('user_id');

            return User::withoutGlobalScopes()
                ->where('organization_id', $orgId)
                ->where('is_active', true)
                ->get()
                ->map(function ($user) use ($userStats) {
                    $stats = $userStats->get($user->id);
                    $totalSeconds = $stats ? (int) $stats->total_seconds : 0;
                    $trackedSeconds = $stats ? (int) $stats->tracked_seconds : 0;
                    $idleSeconds = $stats ? (int) $stats->idle_seconds : 0;
                    $totalWithIdle = $trackedSeconds + $idleSeconds;
                    $idlePercent = $totalWithIdle > 0 ? round($idleSeconds / $totalWithIdle * 100, 1) : 0;

                    return [
                        'user' => [
                            'id' => $user->id,
                            'name' => $user->name,
                            'email' => $user->email,
                            'role' => $user->role,
                            'avatar_url' => $user->avatar_url,
                        ],
                        'total_seconds' => $totalSeconds,
                        'avg_activity' => $stats ? (int) round($stats->avg_activity) : 0,
                        'entry_count' => $stats ? (int) $stats->entry_count : 0,
                        'seconds_idle' => $idleSeconds,
                        'idle_hours' => round($idleSeconds / 3600, 2),
                        'idle_percent' => $idlePercent,
                    ];
                })
                ->sortByDesc('total_seconds')
                ->values()
                ->all();
        });
    }

    // REPT-03: Projects report
    public function projects(string $orgId, string $dateFrom, string $dateTo): array
    {
        $cacheKey = $this->cacheKey($orgId, 'projects', "{$dateFrom}_{$dateTo}");

        return Cache::remember($cacheKey, 900, function () use ($orgId, $dateFrom, $dateTo) {
            $dur = self::durationExpr('time_entries');

            return TimeEntry::withoutGlobalScopes()
                ->where('time_entries.organization_id', $orgId)
                ->where('time_entries.started_at', '>=', $dateFrom)
                ->where('time_entries.started_at', '<', $dateTo)
                ->whereNotNull('time_entries.ended_at')
                ->whereNotNull('time_entries.project_id')
                ->join('projects', 'time_entries.project_id', '=', 'projects.id')
                ->leftJoin('tasks', 'time_entries.task_id', '=', 'tasks.id')
                ->selectRaw("
                    projects.id as project_id,
                    projects.name as project_name,
                    projects.color as project_color,
                    projects.billable,
                    projects.hourly_rate,
                    tasks.id as task_id,
                    tasks.name as task_name,
                    SUM({$dur}) as total_seconds,
                    COUNT(time_entries.id) as entry_count
                ")
                ->groupBy('projects.id', 'projects.name', 'projects.color', 'projects.billable', 'projects.hourly_rate', 'tasks.id', 'tasks.name')
                ->orderByDesc('total_seconds')
                ->get()
                ->groupBy('project_id')
                ->map(function ($tasks, $projectId) {
                    $first = $tasks->first();
                    return [
                        'project_id' => $projectId,
                        'project_name' => $first->project_name,
                        'color' => $first->project_color,
                        'billable' => $first->billable,
                        'hourly_rate' => $first->hourly_rate,
                        'total_seconds' => (int) $tasks->sum('total_seconds'),
                        'tasks' => $tasks->map(fn($t) => [
                            'task_id' => $t->task_id,
                            'task_name' => $t->task_name,
                            'total_seconds' => (int) $t->total_seconds,
                            'entry_count' => (int) $t->entry_count,
                        ])->values(),
                    ];
                })
                ->values()
                ->all();
        });
    }

    // REPT-04: Top apps report
    public function apps(string $orgId, ?string $userId, string $dateFrom, string $dateTo): array
    {
        $cacheKey = $this->cacheKey($orgId, 'apps', "{$dateFrom}_{$dateTo}", $userId);

        return Cache::remember($cacheKey, 900, function () use ($orgId, $userId, $dateFrom, $dateTo) {
            $query = ActivityLog::withoutGlobalScopes()
                ->where('organization_id', $orgId)
                ->where('logged_at', '>=', $dateFrom)
                ->where('logged_at', '<', $dateTo)
                ->whereNotNull('active_app');

            if ($userId) {
                $query->where('user_id', $userId);
            }

            return $query->selectRaw("
                active_app,
                COUNT(*) as count,
                COUNT(*) * 30 as estimated_seconds
            ")
            ->groupBy('active_app')
            ->orderByDesc('count')
            ->limit(20)
            ->get()
            ->all();
        });
    }

    // REPT-05: Timeline
    public function timeline(string $orgId, string $userId, string $date): array
    {
        $cacheKey = $this->cacheKey($orgId, 'timeline', $date, $userId);

        return Cache::remember($cacheKey, 900, function () use ($orgId, $userId, $date) {
            $entries = TimeEntry::withoutGlobalScopes()
                ->where('organization_id', $orgId)
                ->where('user_id', $userId)
                ->whereDate('started_at', $date)
                ->orderBy('started_at')
                ->get(['id', 'started_at', 'ended_at', 'project_id', 'type', 'activity_score']);

            $activities = ActivityLog::withoutGlobalScopes()
                ->where('organization_id', $orgId)
                ->where('user_id', $userId)
                ->whereDate('logged_at', $date)
                ->orderBy('logged_at')
                ->get(['logged_at', 'keyboard_events', 'mouse_events', 'active_app']);

            return [
                'entries' => $entries,
                'activities' => $activities,
            ];
        });
    }

    // REPT-07: Payroll report — single aggregation query (was 3 queries per user)
    public function payroll(string $orgId, string $dateFrom, string $dateTo): array
    {
        $cacheKey = $this->cacheKey($orgId, 'payroll', "{$dateFrom}_{$dateTo}");

        return Cache::remember($cacheKey, 900, function () use ($orgId, $dateFrom, $dateTo) {
            $dur = self::durationExpr('time_entries');

            // Single query: aggregate total, billable, and earnings per user
            $payrollStats = DB::table('time_entries')
                ->where('time_entries.organization_id', $orgId)
                ->where('time_entries.started_at', '>=', $dateFrom)
                ->where('time_entries.started_at', '<', $dateTo)
                ->whereNotNull('time_entries.ended_at')
                ->where('time_entries.is_approved', true)
                ->leftJoin('projects', 'time_entries.project_id', '=', 'projects.id')
                ->selectRaw("
                    time_entries.user_id,
                    COALESCE(SUM({$dur}), 0) as total_seconds,
                    COALESCE(SUM(CASE WHEN projects.billable = true THEN {$dur} ELSE 0 END), 0) as billable_seconds,
                    COALESCE(SUM(CASE WHEN projects.billable = true THEN {$dur} / 3600.0 * projects.hourly_rate ELSE 0 END), 0) as earnings
                ")
                ->groupBy('time_entries.user_id')
                ->get()
                ->keyBy('user_id');

            return User::withoutGlobalScopes()
                ->where('organization_id', $orgId)
                ->where('is_active', true)
                ->get()
                ->map(function ($user) use ($payrollStats) {
                    $stats = $payrollStats->get($user->id);
                    return [
                        'user' => [
                            'id' => $user->id,
                            'name' => $user->name,
                            'email' => $user->email,
                        ],
                        'total_hours' => round(($stats->total_seconds ?? 0) / 3600, 2),
                        'billable_hours' => round(($stats->billable_seconds ?? 0) / 3600, 2),
                        'earnings' => round($stats->earnings ?? 0, 2),
                    ];
                })
                ->values()
                ->all();
        });
    }

    // REPT-08: Attendance report
    public function attendance(string $orgId, string $dateFrom, string $dateTo): array
    {
        $cacheKey = $this->cacheKey($orgId, 'attendance', "{$dateFrom}_{$dateTo}");

        return Cache::remember($cacheKey, 900, function () use ($orgId, $dateFrom, $dateTo) {
            $dur = self::durationExpr();

            // Fetch user names for this org (avoids N+1 and shows names instead of UUIDs)
            $users = User::withoutGlobalScopes()
                ->where('organization_id', $orgId)
                ->pluck('name', 'id');

            $rows = TimeEntry::withoutGlobalScopes()
                ->where('organization_id', $orgId)
                ->where('started_at', '>=', $dateFrom)
                ->where('started_at', '<', $dateTo)
                ->whereNotNull('ended_at')
                ->selectRaw("
                    user_id,
                    DATE(started_at) as date,
                    MIN(started_at) as first_seen,
                    MAX(ended_at) as last_seen,
                    SUM({$dur}) as total_seconds
                ")
                ->groupBy('user_id', DB::raw('DATE(started_at)'))
                ->orderBy('date')
                ->get();

            // Attach user name to each row
            return $rows->map(function ($row) use ($users) {
                $row->user_name = $users->get($row->user_id, 'Unknown');
                return $row;
            })->all();
        });
    }
}
