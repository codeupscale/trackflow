<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\TimeEntry;
use App\Models\User;
use App\Support\TimezoneAwareDateRange;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Redis;

class DashboardController extends Controller
{
    // Seconds per hour constant for time conversions
    private const SECONDS_PER_HOUR = 3600;

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $orgId = $user->organization_id;

        // Employees only see their own data
        if ($user->isEmployee()) {
            return $this->employeeDashboard($user, $request);
        }

        $tz = $user->getTimezoneForDates();
        if ($request->has('date_from') && $request->has('date_to')) {
            [$dateFrom, $dateTo] = TimezoneAwareDateRange::toUtcBounds(
                $request->date_from,
                $request->date_to,
                $tz
            );
            $responseDateFrom = $request->date_from;
            $responseDateTo = $request->date_to;
        } else {
            [$dateFrom, $dateTo] = TimezoneAwareDateRange::userTodayUtcBounds($tz);
            $responseDateFrom = Carbon::now($tz)->toDateString();
            $responseDateTo = $responseDateFrom;
        }

        // Managers/admins/owners see the full team dashboard
        $users = User::withoutGlobalScopes()
            ->where('organization_id', $orgId)
            ->where('is_active', true)
            ->get(['id', 'name', 'email', 'role', 'last_active_at', 'avatar_url']);

        // Batch Redis fetch: 1 call instead of N (one per user)
        $redisKeys = $users->map(fn ($u) => "timer:{$u->id}")->values()->all();
        $redisValues = count($redisKeys) > 0 ? Redis::mget($redisKeys) : [];
        $userById = $users->keyBy('id');
        $now = now();

        $onlineUsers = [];
        foreach ($redisKeys as $i => $key) {
            $timerData = $redisValues[$i] ?? null;
            if ($timerData) {
                $data = json_decode($timerData, true);
                $userId = str_replace('timer:', '', $key);
                $u = $userById->get($userId);
                if ($u) {
                    $onlineUsers[] = [
                        'user' => $u,
                        'timer' => $data,
                        'elapsed_seconds' => (int) abs($now->diffInSeconds(Carbon::parse($data['started_at']))),
                    ];
                }
            }
        }

        // Time entries in range (completed, tracked) — team sum + duration-weighted activity
        // Duration-weighted average: longer entries contribute more to the score.
        // This matches Hubstaff's approach: a 1-min entry at 10% shouldn't drag down
        // an 8-hour entry at 90%. COALESCE handles NULL activity_score (short entries with no heartbeats).
        $rangeEntries = TimeEntry::withoutGlobalScopes()
            ->where('organization_id', $orgId)
            ->where('started_at', '>=', $dateFrom)
            ->where('started_at', '<=', $dateTo)
            ->whereNotNull('ended_at')
            ->where('type', 'tracked')
            ->selectRaw('
                user_id,
                SUM(duration_seconds) as total_seconds,
                CASE
                    WHEN SUM(CASE WHEN activity_score IS NOT NULL THEN duration_seconds ELSE 0 END) > 0
                    THEN SUM(COALESCE(activity_score, 0) * duration_seconds) / SUM(CASE WHEN activity_score IS NOT NULL THEN duration_seconds ELSE 0 END)
                    ELSE 0
                END as avg_activity
            ')
            ->groupBy('user_id')
            ->get()
            ->keyBy('user_id');

        // Active projects in range: distinct project_id (exclude null)
        $activeProjectsCount = (int) TimeEntry::withoutGlobalScopes()
            ->where('organization_id', $orgId)
            ->where('started_at', '>=', $dateFrom)
            ->where('started_at', '<=', $dateTo)
            ->whereNotNull('ended_at')
            ->where('type', 'tracked')
            ->whereNotNull('project_id')
            ->selectRaw('COUNT(DISTINCT project_id) as c')
            ->value('c');

        $now = Carbon::now();
        $rangeIncludesNow = $now->between($dateFrom, $dateTo);
        $onlineByUserId = collect($onlineUsers)->keyBy(fn ($o) => $o['user']->id);

        $teamSummary = $users->map(function ($u) use ($rangeEntries, $rangeIncludesNow, $onlineByUserId) {
            $entry = $rangeEntries->get($u->id);
            $seconds = $entry ? (int) $entry->total_seconds : 0;
            if ($rangeIncludesNow && $onlineByUserId->has($u->id)) {
                $seconds += (int) $onlineByUserId->get($u->id)['elapsed_seconds'];
            }
            return [
                'user' => $u,
                'today_seconds' => $seconds,
                'activity_score' => $entry ? (int) $entry->avg_activity : 0,
            ];
        });

        return response()->json([
            'online_users' => $onlineUsers,
            'team_summary' => $teamSummary,
            'total_online' => count($onlineUsers),
            'active_projects' => $activeProjectsCount,
            'date_from' => $responseDateFrom,
            'date_to' => $responseDateTo,
        ]);
    }

    private function employeeDashboard(User $user, Request $request): JsonResponse
    {
        $timerData = Redis::get("timer:{$user->id}");
        $timer = null;
        if ($timerData) {
            $data = json_decode($timerData, true);
            $timer = [
                'timer' => $data,
                'elapsed_seconds' => (int) abs(now()->diffInSeconds(Carbon::parse($data['started_at']))),
            ];
        }

        $tz = $user->getTimezoneForDates();
        if ($request->has('date_from') && $request->has('date_to')) {
            [$dateFrom, $dateTo] = TimezoneAwareDateRange::toUtcBounds(
                $request->date_from,
                $request->date_to,
                $tz
            );
            $responseDateFrom = $request->date_from;
            $responseDateTo = $request->date_to;
        } else {
            [$dateFrom, $dateTo] = TimezoneAwareDateRange::userTodayUtcBounds($tz);
            $responseDateFrom = Carbon::now($tz)->toDateString();
            $responseDateTo = $responseDateFrom;
        }

        $rangeSeconds = TimeEntry::withoutGlobalScopes()
            ->where('user_id', $user->id)
            ->where('started_at', '>=', $dateFrom)
            ->where('started_at', '<=', $dateTo)
            ->whereNotNull('ended_at')
            ->where('type', 'tracked')
            ->sum('duration_seconds');

        $now = Carbon::now();
        if ($now->between($dateFrom, $dateTo) && $timer) {
            $rangeSeconds += (int) $timer['elapsed_seconds'];
        }

        $weekSeconds = TimeEntry::withoutGlobalScopes()
            ->where('user_id', $user->id)
            ->where('started_at', '>=', now()->startOfWeek())
            ->whereNotNull('ended_at')
            ->sum('duration_seconds');

        return response()->json([
            'timer' => $timer,
            'today_seconds' => (int) $rangeSeconds,
            'week_seconds' => (int) $weekSeconds,
            'date_from' => $responseDateFrom,
            'date_to' => $responseDateTo,
        ]);
    }
}
