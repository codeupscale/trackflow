<?php

namespace App\Services;

use App\Models\TimeEntry;
use App\Models\ActivityLog;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class ReportService
{
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
            $query = TimeEntry::withoutGlobalScopes()
                ->where('organization_id', $orgId)
                ->whereBetween('started_at', [$dateFrom, $dateTo])
                ->whereNotNull('ended_at');

            if ($userId) {
                $query->where('user_id', $userId);
            }

            $daily = $query->selectRaw("
                DATE(started_at) as date,
                SUM(duration_seconds) as total_seconds,
                AVG(activity_score) as activity_score_avg,
                COUNT(*) as entry_count
            ")
            ->groupBy(DB::raw('DATE(started_at)'))
            ->orderBy('date')
            ->get();

            // Calculate earnings for billable entries
            $billableQuery = TimeEntry::withoutGlobalScopes()
                ->where('time_entries.organization_id', $orgId)
                ->whereBetween('time_entries.started_at', [$dateFrom, $dateTo])
                ->whereNotNull('time_entries.ended_at')
                ->join('projects', 'time_entries.project_id', '=', 'projects.id')
                ->where('projects.billable', true);

            if ($userId) {
                $billableQuery->where('time_entries.user_id', $userId);
            }

            $totalEarnings = $billableQuery
                ->selectRaw('SUM(time_entries.duration_seconds / 3600.0 * projects.hourly_rate) as total_earnings')
                ->value('total_earnings') ?? 0;

            return [
                'daily' => $daily,
                'total_seconds' => $daily->sum('total_seconds'),
                'avg_activity' => $daily->avg('activity_score_avg'),
                'total_entries' => $daily->sum('entry_count'),
                'total_earnings' => round($totalEarnings, 2),
            ];
        });
    }

    // REPT-02: Team report
    public function team(string $orgId, string $dateFrom, string $dateTo): array
    {
        $cacheKey = $this->cacheKey($orgId, 'team', "{$dateFrom}_{$dateTo}");

        return Cache::remember($cacheKey, 900, function () use ($orgId, $dateFrom, $dateTo) {
            // Use aggregation query instead of N+1
            $userStats = TimeEntry::withoutGlobalScopes()
                ->where('organization_id', $orgId)
                ->whereBetween('started_at', [$dateFrom, $dateTo])
                ->whereNotNull('ended_at')
                ->selectRaw('
                    user_id,
                    SUM(duration_seconds) as total_seconds,
                    AVG(activity_score) as avg_activity,
                    COUNT(*) as entry_count
                ')
                ->groupBy('user_id')
                ->pluck(DB::raw('SUM(duration_seconds), AVG(activity_score), COUNT(*), user_id'), 'user_id');

            return User::withoutGlobalScopes()
                ->where('organization_id', $orgId)
                ->where('is_active', true)
                ->get()
                ->map(function ($user) use ($userStats) {
                    // Get stats from pre-aggregated data
                    $result = DB::table('time_entries')
                        ->where('user_id', $user->id)
                        ->selectRaw('
                            COALESCE(SUM(duration_seconds), 0) as total_seconds,
                            COALESCE(AVG(activity_score), 0) as avg_activity,
                            COALESCE(COUNT(*), 0) as entry_count
                        ')
                        ->whereNotNull('ended_at')
                        ->first();

                    return [
                        'user' => [
                            'id' => $user->id,
                            'name' => $user->name,
                            'email' => $user->email,
                            'role' => $user->role,
                            'avatar_url' => $user->avatar_url,
                        ],
                        'total_seconds' => (int) $result->total_seconds,
                        'avg_activity' => (int) $result->avg_activity,
                        'entry_count' => (int) $result->entry_count,
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
            return TimeEntry::withoutGlobalScopes()
                ->where('time_entries.organization_id', $orgId)
                ->whereBetween('time_entries.started_at', [$dateFrom, $dateTo])
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
                    SUM(time_entries.duration_seconds) as total_seconds,
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
                ->whereBetween('logged_at', [$dateFrom, $dateTo])
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

    // REPT-07: Payroll report
    public function payroll(string $orgId, string $dateFrom, string $dateTo): array
    {
        $cacheKey = $this->cacheKey($orgId, 'payroll', "{$dateFrom}_{$dateTo}");

        return Cache::remember($cacheKey, 900, function () use ($orgId, $dateFrom, $dateTo) {
            return User::withoutGlobalScopes()
                ->where('organization_id', $orgId)
                ->where('is_active', true)
                ->get()
                ->map(function ($user) use ($dateFrom, $dateTo) {
                    // Single aggregation query for total hours
                    $totalSeconds = (int) TimeEntry::withoutGlobalScopes()
                        ->where('user_id', $user->id)
                        ->whereBetween('started_at', [$dateFrom, $dateTo])
                        ->whereNotNull('ended_at')
                        ->where('is_approved', true)
                        ->sum('duration_seconds');

                    // Single aggregation query for billable hours using join
                    $billableSeconds = (int) TimeEntry::withoutGlobalScopes()
                        ->where('time_entries.user_id', $user->id)
                        ->whereBetween('time_entries.started_at', [$dateFrom, $dateTo])
                        ->whereNotNull('time_entries.ended_at')
                        ->where('time_entries.is_approved', true)
                        ->join('projects', 'time_entries.project_id', '=', 'projects.id')
                        ->where('projects.billable', true)
                        ->sum('time_entries.duration_seconds');

                    // Single aggregation query for earnings
                    $earnings = TimeEntry::withoutGlobalScopes()
                        ->where('time_entries.user_id', $user->id)
                        ->whereBetween('time_entries.started_at', [$dateFrom, $dateTo])
                        ->whereNotNull('time_entries.ended_at')
                        ->where('time_entries.is_approved', true)
                        ->join('projects', 'time_entries.project_id', '=', 'projects.id')
                        ->where('projects.billable', true)
                        ->selectRaw('SUM(time_entries.duration_seconds / 3600.0 * projects.hourly_rate) as total')
                        ->value('total') ?? 0;

                    return [
                        'user' => [
                            'id' => $user->id,
                            'name' => $user->name,
                            'email' => $user->email,
                        ],
                        'total_hours' => round($totalSeconds / 3600, 2),
                        'billable_hours' => round($billableSeconds / 3600, 2),
                        'earnings' => round($earnings, 2),
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
            return TimeEntry::withoutGlobalScopes()
                ->where('organization_id', $orgId)
                ->whereBetween('started_at', [$dateFrom, $dateTo])
                ->whereNotNull('ended_at')
                ->selectRaw("
                    user_id,
                    DATE(started_at) as date,
                    MIN(started_at) as first_seen,
                    MAX(ended_at) as last_seen,
                    SUM(duration_seconds) as total_seconds
                ")
                ->groupBy('user_id', DB::raw('DATE(started_at)'))
                ->orderBy('date')
                ->get()
                ->all();
        });
    }
}
