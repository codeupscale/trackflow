<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\TimeEntry;
use App\Models\User;
use App\Support\TimezoneAwareDateRange;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
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

        // Hours per user in range
        $rangeEntries = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
            ->where('organization_id', $orgId)
            ->where('started_at', '>=', $dateFrom)
            ->where('started_at', '<', $dateTo)
            ->whereNotNull('ended_at')
            ->where('type', 'tracked')
            ->selectRaw('user_id, SUM(duration_seconds) as total_seconds')
            ->groupBy('user_id')
            ->get()
            ->keyBy('user_id');

        // Activity % per user from activity_logs (accurate keyboard/mouse data per 30s window).
        // Single query for all users in the org — no N+1.
        // Formula: SUM(active_seconds) / (COUNT(*) * 30s) * 100
        $activityByUser = DB::table('activity_logs')
            ->join('time_entries', 'activity_logs.time_entry_id', '=', 'time_entries.id')
            ->where('activity_logs.organization_id', $orgId)
            ->where('time_entries.started_at', '>=', $dateFrom)
            ->where('time_entries.started_at', '<', $dateTo)
            ->where('time_entries.type', 'tracked')
            ->whereNotNull('time_entries.ended_at')
            ->selectRaw('activity_logs.user_id, SUM(activity_logs.active_seconds) as active_secs, COUNT(*) as log_count')
            ->groupBy('activity_logs.user_id')
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

        $teamSummary = $users->map(function ($u) use ($rangeEntries, $activityByUser, $rangeIncludesNow, $onlineByUserId) {
            $entry = $rangeEntries->get($u->id);
            $seconds = $entry ? (int) $entry->total_seconds : 0;
            if ($rangeIncludesNow && $onlineByUserId->has($u->id)) {
                $seconds += (int) $onlineByUserId->get($u->id)['elapsed_seconds'];
            }

            $al = $activityByUser->get($u->id);
            $logCount = $al ? (int) $al->log_count : 0;
            $activeSecs = $al ? (int) $al->active_secs : 0;
            $activityScore = $logCount > 0
                ? (int) round(($activeSecs / ($logCount * 30)) * 100)
                : 0;

            return [
                'user'           => $u,
                'today_seconds'  => $seconds,
                'activity_score' => $activityScore,
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

        // Activity % from activity_logs (accurate keyboard/mouse data per 30s window)
        // Formula: SUM(active_seconds) / (COUNT(*) * 30s) * 100
        $alStats = DB::table('activity_logs')
            ->join('time_entries', 'activity_logs.time_entry_id', '=', 'time_entries.id')
            ->where('activity_logs.organization_id', $user->organization_id)
            ->where('activity_logs.user_id', $user->id)
            ->where('time_entries.started_at', '>=', $dateFrom)
            ->where('time_entries.started_at', '<', $dateTo)
            ->where('time_entries.type', 'tracked')
            ->whereNotNull('time_entries.ended_at')
            ->selectRaw('SUM(activity_logs.active_seconds) as active_secs, COUNT(*) as log_count')
            ->first();

        $alLogCount   = (int) ($alStats->log_count ?? 0);
        $alActiveSecs = (int) ($alStats->active_secs ?? 0);
        $activityPercentage = $alLogCount > 0
            ? (int) round(($alActiveSecs / ($alLogCount * 30)) * 100)
            : null;

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
            'timer'               => $timer,
            'today_seconds'       => (int) $rangeSeconds,
            'week_seconds'        => (int) $weekSeconds,
            'weekly_hours_target' => $weeklyTarget,
            'daily_breakdown'     => $dailyBreakdown,
            'activity_percentage' => $activityPercentage,
            'date_from'           => $responseDateFrom,
            'date_to'             => $responseDateTo,
        ]);
    }
}
