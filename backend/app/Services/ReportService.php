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

        if (DB::connection()->getDriverName() === 'sqlite') {
            // SQLite: julianday diff * 86400 = seconds; MIN/MAX are scalar in SQLite
            return "MIN(MAX(CAST((julianday({$endCol}) - julianday({$startCol})) * 86400 AS INTEGER), 0), {$cap})";
        }

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

            $teDur = self::durationExpr('time_entries');

            // Billable breakdown: billable_seconds + earnings in one query
            $billableSeconds = 0;
            $totalEarnings = 0;
            if ($totalTrackedSeconds > 0) {
                $billableQuery = DB::table('time_entries')
                    ->where('time_entries.organization_id', $orgId)
                    ->where('time_entries.started_at', '>=', $dateFrom)
                    ->where('time_entries.started_at', '<', $dateTo)
                    ->whereNotNull('time_entries.ended_at')
                    ->where('time_entries.type', 'tracked')
                    ->join('projects', 'time_entries.project_id', '=', 'projects.id')
                    ->where('projects.billable', true);

                if ($userId) {
                    $billableQuery->where('time_entries.user_id', $userId);
                }

                $billableResult = $billableQuery
                    ->selectRaw("COALESCE(SUM({$teDur}), 0) as billable_seconds, COALESCE(SUM({$teDur} / 3600.0 * projects.hourly_rate), 0) as total_earnings")
                    ->first();

                $billableSeconds = (int) ($billableResult->billable_seconds ?? 0);
                $totalEarnings = (float) ($billableResult->total_earnings ?? 0);
            }

            $nonBillableSeconds = $totalTrackedSeconds - $billableSeconds;
            $totalForRatio = $billableSeconds + $nonBillableSeconds;
            $billablePct = $totalForRatio > 0 ? (int) round($billableSeconds / $totalForRatio * 100) : 0;
            $nonBillablePct = 100 - $billablePct;
            $billableRatio = "{$billablePct}:{$nonBillablePct}";

            // Previous period: shift date range backwards by its own length
            $periodLengthSeconds = strtotime($dateTo) - strtotime($dateFrom);
            $prevFrom = date('Y-m-d H:i:s', strtotime($dateFrom) - $periodLengthSeconds);
            $prevTo = $dateFrom;

            $prevQuery = TimeEntry::withoutGlobalScopes()
                ->where('organization_id', $orgId)
                ->where('started_at', '>=', $prevFrom)
                ->where('started_at', '<', $prevTo)
                ->whereNotNull('ended_at');

            if ($userId) {
                $prevQuery->where('user_id', $userId);
            }

            $prevTotalSeconds = (int) ($prevQuery->selectRaw("COALESCE(SUM({$dur}), 0) as total_seconds")->value('total_seconds') ?? 0);
            $previousPeriodHours = round($prevTotalSeconds / 3600, 2);

            // Previous period budget
            $previousBudgetUsed = 0;
            if ($prevTotalSeconds > 0) {
                $prevBudgetQuery = DB::table('time_entries')
                    ->where('time_entries.organization_id', $orgId)
                    ->where('time_entries.started_at', '>=', $prevFrom)
                    ->where('time_entries.started_at', '<', $prevTo)
                    ->whereNotNull('time_entries.ended_at')
                    ->where('time_entries.type', 'tracked')
                    ->join('projects', 'time_entries.project_id', '=', 'projects.id')
                    ->where('projects.billable', true);

                if ($userId) {
                    $prevBudgetQuery->where('time_entries.user_id', $userId);
                }

                $previousBudgetUsed = (float) ($prevBudgetQuery
                    ->selectRaw("COALESCE(SUM({$teDur} / 3600.0 * projects.hourly_rate), 0) as total_earnings")
                    ->value('total_earnings') ?? 0);
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
                'previous_period_hours' => $previousPeriodHours,
                'total_budget_used' => round($totalEarnings, 2),
                'previous_budget_used' => round($previousBudgetUsed, 2),
                'billable_seconds' => $billableSeconds,
                'non_billable_seconds' => $nonBillableSeconds,
                'billable_ratio' => $billableRatio,
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

    // REPT-03: Projects report (project-level aggregation, top 10)
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
                ->selectRaw("
                    projects.id as project_id,
                    projects.name as project_name,
                    projects.color as project_color,
                    SUM({$dur}) as total_seconds
                ")
                ->groupBy('projects.id', 'projects.name', 'projects.color')
                ->orderByDesc('total_seconds')
                ->limit(10)
                ->get()
                ->map(fn ($row) => [
                    'project_id' => $row->project_id,
                    'name' => $row->project_name,
                    'color' => $row->project_color,
                    'total_hours' => round((int) $row->total_seconds / 3600, 1),
                    'total_seconds' => (int) $row->total_seconds,
                ])
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

    // REPT-09: Analytics (KPIs + chart data)
    public function analytics(string $orgId, ?string $userId, string $dateFrom, string $dateTo): array
    {
        $cacheKey = $this->cacheKey($orgId, 'analytics', "{$dateFrom}_{$dateTo}", $userId);

        return Cache::remember($cacheKey, 900, function () use ($orgId, $userId, $dateFrom, $dateTo) {
            $dur = self::durationExpr('te');

            // --- Base conditions for current period ---
            $baseWhere = function ($q) use ($orgId, $userId, $dateFrom, $dateTo) {
                $q->where('te.organization_id', $orgId)
                  ->where('te.started_at', '>=', $dateFrom)
                  ->where('te.started_at', '<', $dateTo)
                  ->whereNotNull('te.ended_at');
                if ($userId) {
                    $q->where('te.user_id', $userId);
                }
            };

            // --- KPI 1: total_tracked_hours + change_percent vs previous period ---
            $periodLengthSeconds = strtotime($dateTo) - strtotime($dateFrom);
            $prevFrom = date('Y-m-d H:i:s', strtotime($dateFrom) - $periodLengthSeconds);
            $prevTo = $dateFrom;

            $currentHoursRow = DB::table('time_entries as te')
                ->where(function ($q) use ($baseWhere) { $baseWhere($q); })
                ->selectRaw("COALESCE(SUM({$dur}), 0) as total_seconds")
                ->first();
            $currentTotalSeconds = (int) ($currentHoursRow->total_seconds ?? 0);
            $currentTotalHours = round($currentTotalSeconds / 3600, 1);

            $prevHoursRow = DB::table('time_entries as te')
                ->where('te.organization_id', $orgId)
                ->where('te.started_at', '>=', $prevFrom)
                ->where('te.started_at', '<', $prevTo)
                ->whereNotNull('te.ended_at')
                ->when($userId, fn ($q) => $q->where('te.user_id', $userId))
                ->selectRaw("COALESCE(SUM({$dur}), 0) as total_seconds")
                ->first();
            $prevTotalSeconds = (int) ($prevHoursRow->total_seconds ?? 0);

            $changePercent = $prevTotalSeconds > 0
                ? round(($currentTotalSeconds - $prevTotalSeconds) / $prevTotalSeconds * 100, 1)
                : null;

            // --- KPI 2: avg_activity_percent (duration-weighted, tracked entries only) ---
            $activityRow = DB::table('time_entries as te')
                ->where(function ($q) use ($baseWhere) { $baseWhere($q); })
                ->where('te.type', 'tracked')
                ->selectRaw("
                    CASE
                        WHEN SUM(CASE WHEN te.activity_score IS NOT NULL AND te.activity_score > 0
                             THEN {$dur} ELSE 0 END) > 0
                        THEN SUM(COALESCE(te.activity_score, 0) * {$dur})
                             / SUM(CASE WHEN te.activity_score IS NOT NULL AND te.activity_score > 0
                                   THEN {$dur} ELSE 0 END)
                        ELSE 0
                    END as avg_activity
                ")
                ->first();
            $avgActivity = round((float) ($activityRow->avg_activity ?? 0), 1);

            // --- KPI 3: total_budget_used + change_percent ---
            $budgetRow = DB::table('time_entries as te')
                ->join('projects as p', 'te.project_id', '=', 'p.id')
                ->where(function ($q) use ($baseWhere) { $baseWhere($q); })
                ->where('p.billable', true)
                ->selectRaw("COALESCE(SUM({$dur} / 3600.0 * p.hourly_rate), 0) as total_budget")
                ->first();
            $currentBudget = round((float) ($budgetRow->total_budget ?? 0), 2);

            $prevBudgetRow = DB::table('time_entries as te')
                ->join('projects as p', 'te.project_id', '=', 'p.id')
                ->where('te.organization_id', $orgId)
                ->where('te.started_at', '>=', $prevFrom)
                ->where('te.started_at', '<', $prevTo)
                ->whereNotNull('te.ended_at')
                ->where('p.billable', true)
                ->when($userId, fn ($q) => $q->where('te.user_id', $userId))
                ->selectRaw("COALESCE(SUM({$dur} / 3600.0 * p.hourly_rate), 0) as total_budget")
                ->first();
            $prevBudget = (float) ($prevBudgetRow->total_budget ?? 0);

            $budgetChangePercent = $prevBudget > 0
                ? round(($currentBudget - $prevBudget) / $prevBudget * 100, 1)
                : null;

            // --- KPI 4: billable_ratio ---
            $billableRow = DB::table('time_entries as te')
                ->leftJoin('projects as p', 'te.project_id', '=', 'p.id')
                ->where(function ($q) use ($baseWhere) { $baseWhere($q); })
                ->selectRaw("
                    COALESCE(SUM(CASE WHEN p.billable = true THEN {$dur} ELSE 0 END), 0) as billable_seconds,
                    COALESCE(SUM(CASE WHEN p.billable IS NULL OR p.billable = false THEN {$dur} ELSE 0 END), 0) as non_billable_seconds
                ")
                ->first();
            $billableSec = (int) ($billableRow->billable_seconds ?? 0);
            $nonBillableSec = (int) ($billableRow->non_billable_seconds ?? 0);
            $totalBillableSec = $billableSec + $nonBillableSec;
            $billablePercent = $totalBillableSec > 0 ? (int) round($billableSec / $totalBillableSec * 100) : 0;

            // --- Chart 1: time_per_project (top 8) ---
            $timePerProject = DB::table('time_entries as te')
                ->join('projects as p', 'te.project_id', '=', 'p.id')
                ->where(function ($q) use ($baseWhere) { $baseWhere($q); })
                ->whereNotNull('te.project_id')
                ->selectRaw("p.name as project_name, p.color, SUM({$dur}) / 3600.0 as total_hours")
                ->groupBy('p.id', 'p.name', 'p.color')
                ->orderByDesc('total_hours')
                ->limit(8)
                ->get()
                ->map(fn ($row) => [
                    'project_name' => $row->project_name,
                    'color' => $row->color,
                    'total_hours' => round((float) $row->total_hours, 1),
                ])
                ->all();

            // --- Chart 2: team_activity_levels (by day of week) ---
            $dayNames = [0 => 'Sun', 1 => 'Mon', 2 => 'Tue', 3 => 'Wed', 4 => 'Thu', 5 => 'Fri', 6 => 'Sat'];

            $activityByDay = DB::table('time_entries as te')
                ->where(function ($q) use ($baseWhere) { $baseWhere($q); })
                ->where('te.type', 'tracked')
                ->whereNotNull('te.activity_score')
                ->where('te.activity_score', '>', 0)
                ->selectRaw("
                    EXTRACT(DOW FROM te.started_at AT TIME ZONE 'UTC')::int as day_num,
                    AVG(te.activity_score) as avg_activity
                ")
                ->groupBy(DB::raw("EXTRACT(DOW FROM te.started_at AT TIME ZONE 'UTC')"))
                ->get()
                ->keyBy('day_num');

            $teamActivityLevels = [];
            foreach ([1, 2, 3, 4, 5, 6, 0] as $dayNum) {
                $row = $activityByDay->get($dayNum);
                $teamActivityLevels[] = [
                    'day' => $dayNames[$dayNum],
                    'day_num' => $dayNum,
                    'avg_activity' => $row ? round((float) $row->avg_activity, 1) : 0,
                ];
            }

            return [
                'kpis' => [
                    'total_tracked_hours' => [
                        'value' => $currentTotalHours,
                        'change_percent' => $changePercent,
                    ],
                    'avg_activity_percent' => [
                        'value' => $avgActivity,
                        'change_percent' => null,
                    ],
                    'total_budget_used' => [
                        'value' => $currentBudget,
                        'change_percent' => $budgetChangePercent,
                    ],
                    'billable_ratio' => [
                        'billable' => $billablePercent,
                        'non_billable' => 100 - $billablePercent,
                    ],
                ],
                'time_per_project' => $timePerProject,
                'team_activity_levels' => $teamActivityLevels,
            ];
        });
    }

    // REPT-10: Detailed logs (paginated time entries with joins)
    public function detailedLogs(string $orgId, ?string $userId, string $dateFrom, string $dateTo, int $perPage = 10, int $page = 1): array
    {
        $cacheKey = $this->cacheKey($orgId, 'detailed_logs', "{$dateFrom}_{$dateTo}_{$perPage}_{$page}", $userId);

        return Cache::remember($cacheKey, 900, function () use ($orgId, $userId, $dateFrom, $dateTo, $perPage, $page) {
            $dur = self::durationExpr('te');

            $baseQuery = DB::table('time_entries as te')
                ->join('users as u', 'te.user_id', '=', 'u.id')
                ->leftJoin('projects as p', 'te.project_id', '=', 'p.id')
                ->leftJoin('tasks as t', 'te.task_id', '=', 't.id')
                ->where('te.organization_id', $orgId)
                ->where('te.started_at', '>=', $dateFrom)
                ->where('te.started_at', '<', $dateTo)
                ->whereNotNull('te.ended_at');

            if ($userId) {
                $baseQuery->where('te.user_id', $userId);
            }

            $total = (clone $baseQuery)->count();

            $offset = ($page - 1) * $perPage;

            $rows = (clone $baseQuery)
                ->select([
                    'te.id',
                    'u.name as member_name',
                    'u.role as member_role',
                    'p.name as project_name',
                    'p.color as project_color',
                    'p.billable',
                    'p.hourly_rate',
                    't.name as task_name',
                    'te.activity_score',
                    'te.started_at',
                ])
                ->selectRaw("{$dur} as duration_seconds")
                ->orderByDesc('te.started_at')
                ->offset($offset)
                ->limit($perPage)
                ->get();

            $data = $rows->map(fn ($row) => [
                'id' => $row->id,
                'member_name' => $row->member_name,
                'member_role' => $row->member_role,
                'project_name' => $row->project_name,
                'project_color' => $row->project_color,
                'task_name' => $row->task_name,
                'duration_seconds' => (int) $row->duration_seconds,
                'activity_percent' => (int) ($row->activity_score ?? 0),
                'billable_amount' => $row->billable
                    ? round(((int) $row->duration_seconds) / 3600 * (float) $row->hourly_rate, 2)
                    : 0,
                'started_at' => $row->started_at,
            ])->all();

            return [
                'data' => $data,
                'meta' => [
                    'current_page' => $page,
                    'last_page' => (int) ceil($total / $perPage) ?: 1,
                    'total' => $total,
                    'per_page' => $perPage,
                ],
            ];
        });
    }

    // REPT-11: Activity by day of week (weighted average activity per weekday)
    public function activityByDay(string $orgId, ?string $userId, string $dateFrom, string $dateTo): array
    {
        $cacheKey = $this->cacheKey($orgId, 'activity_by_day', "{$dateFrom}_{$dateTo}", $userId);

        return Cache::remember($cacheKey, 900, function () use ($orgId, $userId, $dateFrom, $dateTo) {
            $dur = self::durationExpr();

            $query = TimeEntry::withoutGlobalScopes()
                ->where('organization_id', $orgId)
                ->where('started_at', '>=', $dateFrom)
                ->where('started_at', '<', $dateTo)
                ->whereNotNull('ended_at')
                ->whereNotNull('activity_score')
                ->where('activity_score', '>', 0);

            if ($userId) {
                $query->where('user_id', $userId);
            }

            $rows = $query->selectRaw("
                    EXTRACT(DOW FROM started_at)::int as day_num,
                    CASE
                        WHEN SUM({$dur}) > 0
                        THEN SUM(COALESCE(activity_score, 0) * {$dur}) / SUM({$dur})
                        ELSE 0
                    END as activity_percent
                ")
                ->groupBy(DB::raw('EXTRACT(DOW FROM started_at)'))
                ->get()
                ->keyBy('day_num');

            // Map DOW numbers to day names, ordered Mon-Sun
            $dayNames = [0 => 'Sun', 1 => 'Mon', 2 => 'Tue', 3 => 'Wed', 4 => 'Thu', 5 => 'Fri', 6 => 'Sat'];
            $ordered = [1, 2, 3, 4, 5, 6, 0]; // Mon through Sun

            $result = [];
            foreach ($ordered as $dayNum) {
                $row = $rows->get($dayNum);
                $result[] = [
                    'day' => $dayNames[$dayNum],
                    'activity_percent' => $row ? round((float) $row->activity_percent, 1) : 0,
                ];
            }

            return $result;
        });
    }

    // REPT-12: Detailed time logs (paginated, with user/project/task joins)
    public function timeLogs(string $orgId, ?string $userId, string $dateFrom, string $dateTo, int $perPage = 15): \Illuminate\Contracts\Pagination\LengthAwarePaginator
    {
        $dur = self::durationExpr('time_entries');

        $query = DB::table('time_entries')
            ->join('users', 'time_entries.user_id', '=', 'users.id')
            ->leftJoin('projects', 'time_entries.project_id', '=', 'projects.id')
            ->leftJoin('tasks', 'time_entries.task_id', '=', 'tasks.id')
            ->where('time_entries.organization_id', $orgId)
            ->where('time_entries.started_at', '>=', $dateFrom)
            ->where('time_entries.started_at', '<', $dateTo)
            ->whereNotNull('time_entries.ended_at');

        if ($userId) {
            $query->where('time_entries.user_id', $userId);
        }

        return $query->select([
                'time_entries.id',
                'users.name as user_name',
                'users.role as user_role',
                'projects.name as project_name',
                'projects.color as project_color',
                'projects.billable',
                'projects.hourly_rate',
                'tasks.name as task_name',
                'time_entries.activity_score',
                'time_entries.started_at',
            ])
            ->selectRaw("{$dur} as duration_seconds")
            ->selectRaw("CASE WHEN projects.billable = true THEN ROUND({$dur} / 3600.0 * projects.hourly_rate, 2) ELSE 0 END as billable_amount")
            ->orderByDesc('time_entries.started_at')
            ->paginate($perPage);
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
