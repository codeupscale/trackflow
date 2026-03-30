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
        $users = User::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
            ->where('organization_id', $orgId)
            ->where('is_active', true)
            ->get(['id', 'name', 'email', 'role', 'last_active_at', 'avatar_url']);

        // Batch Redis fetch: 1 call instead of N (one per user)
        // Build keys from user IDs to avoid fragile string parsing
        $userIds = $users->pluck('id')->values()->all();
        $redisKeys = array_map(fn ($id) => "timer:{$id}", $userIds);
        $redisValues = count($redisKeys) > 0 ? Redis::mget($redisKeys) : [];
        $userById = $users->keyBy('id');
        $now = now();

        $onlineUsers = [];
        foreach ($userIds as $i => $userId) {
            $timerData = $redisValues[$i] ?? null;
            if ($timerData) {
                $data = json_decode($timerData, true);
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
        // Duration-weighted average: only entries with meaningful activity (score > 0) contribute
        // to the activity percentage. Entries with NULL or 0 score (idle/no heartbeats) still
        // count toward total hours but don't drag down the activity average.
        // This matches Hubstaff: idle time counts as hours worked but doesn't affect activity %.
        $rangeEntries = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
            ->where('organization_id', $orgId)
            ->where('started_at', '>=', $dateFrom)
            ->where('started_at', '<', $dateTo)
            ->whereNotNull('ended_at')
            ->where('type', 'tracked')
            ->selectRaw('
                user_id,
                SUM(duration_seconds) as total_seconds,
                CASE
                    WHEN SUM(CASE WHEN activity_score IS NOT NULL AND activity_score > 0 THEN duration_seconds ELSE 0 END) > 0
                    THEN SUM(CASE WHEN activity_score IS NOT NULL AND activity_score > 0 THEN activity_score * duration_seconds ELSE 0 END)
                         / SUM(CASE WHEN activity_score IS NOT NULL AND activity_score > 0 THEN duration_seconds ELSE 0 END)
                    ELSE 0
                END as avg_activity
            ')
            ->groupBy('user_id')
            ->get()
            ->keyBy('user_id');

        // Active projects in range: distinct project_id (exclude null)
        $activeProjectsCount = (int) TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
            ->where('organization_id', $orgId)
            ->where('started_at', '>=', $dateFrom)
            ->where('started_at', '<', $dateTo)
            ->whereNotNull('ended_at')
            ->where('type', 'tracked')
            ->whereNotNull('project_id')
            ->selectRaw('COUNT(DISTINCT project_id) as c')
            ->value('c');

        $now = Carbon::now();
        $rangeIncludesNow = $now >= Carbon::parse($dateFrom) && $now < Carbon::parse($dateTo);
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

        $rangeSeconds = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
            ->where('user_id', $user->id)
            ->where('started_at', '>=', $dateFrom)
            ->where('started_at', '<', $dateTo)
            ->whereNotNull('ended_at')
            ->where('type', 'tracked')
            ->sum('duration_seconds');

        $now = Carbon::now();
        if ($now >= Carbon::parse($dateFrom) && $now < Carbon::parse($dateTo) && $timer) {
            $rangeSeconds += (int) $timer['elapsed_seconds'];
        }

        // Week range uses the user's timezone so the boundaries align with their calendar week
        $weekStart = Carbon::now($tz)->startOfWeek(); // Monday 00:00 local
        $weekEnd = Carbon::now($tz)->endOfWeek();     // Sunday 23:59 local
        [$weekStartUtc, $weekEndUtc] = TimezoneAwareDateRange::toUtcBounds(
            $weekStart->toDateString(),
            $weekEnd->toDateString(),
            $tz
        );

        $weekSeconds = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
            ->where('user_id', $user->id)
            ->where('started_at', '>=', $weekStartUtc)
            ->where('started_at', '<', $weekEndUtc)
            ->whereNotNull('ended_at')
            ->where('type', 'tracked')
            ->sum('duration_seconds');

        // Include current running timer in weekly total (if timer is running within this week)
        if ($timer) {
            $weekSeconds += (int) $timer['elapsed_seconds'];
        }

        // Use weekly_limit_hours (set via Settings UI) — fall back to weekly_hours_target for backwards compat
        $weeklyTarget = (int) ($user->organization->getSetting('weekly_limit_hours', null)
            ?? $user->organization->getSetting('weekly_hours_target', 0));

        // Daily breakdown for the current week (Mon–Sun) for bar chart
        $dailyBreakdown = [];
        $todayLocal = Carbon::now($tz)->toDateString();
        for ($d = 0; $d < 7; $d++) {
            $dayLocal = $weekStart->copy()->addDays($d);
            $dayStr = $dayLocal->toDateString();
            [$dayStartUtc, $dayEndUtc] = TimezoneAwareDateRange::toUtcBounds($dayStr, $dayStr, $tz);

            $daySecs = (int) TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
                ->where('user_id', $user->id)
                ->where('started_at', '>=', $dayStartUtc)
                ->where('started_at', '<', $dayEndUtc)
                ->whereNotNull('ended_at')
                ->where('type', 'tracked')
                ->sum('duration_seconds');

            // Add running timer elapsed to today's bar
            if ($dayStr === $todayLocal && $timer) {
                $daySecs += (int) $timer['elapsed_seconds'];
            }

            $dailyBreakdown[] = [
                'date' => $dayStr,
                'day' => $dayLocal->format('D'),  // Mon, Tue, etc.
                'seconds' => $daySecs,
                'hours' => round($daySecs / self::SECONDS_PER_HOUR, 1),
            ];
        }

        return response()->json([
            'timer' => $timer,
            'today_seconds' => (int) $rangeSeconds,
            'week_seconds' => (int) $weekSeconds,
            'weekly_hours_target' => $weeklyTarget,
            'daily_breakdown' => $dailyBreakdown,
            'date_from' => $responseDateFrom,
            'date_to' => $responseDateTo,
        ]);
    }
}
