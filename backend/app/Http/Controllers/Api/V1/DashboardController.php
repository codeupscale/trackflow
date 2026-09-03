<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\TimeEntry;
use App\Models\User;
use App\Support\TimezoneAwareDateRange;
use App\Support\WorkedTime;
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

        // Collect entry IDs from Redis to batch-verify they are still open in the DB
        $pendingOnline = [];
        foreach ($userIds as $i => $userId) {
            $timerData = $redisValues[$i] ?? null;
            if ($timerData) {
                $data = json_decode($timerData, true);
                $u = $userById->get($userId);
                if ($u && !empty($data['entry_id'])) {
                    $pendingOnline[$userId] = ['user' => $u, 'data' => $data];
                }
            }
        }

        // Batch verify: only count as online if the DB entry is still open
        $openEntryIds = [];
        if (!empty($pendingOnline)) {
            $entryIds = array_map(fn ($p) => $p['data']['entry_id'], $pendingOnline);
            $openEntryIds = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
                ->whereIn('id', $entryIds)
                ->whereNull('ended_at')
                ->pluck('id')
                ->flip()
                ->all();

            // Clean up stale Redis keys for entries that are already closed
            $staleUserIds = [];
            foreach ($pendingOnline as $userId => $p) {
                if (!isset($openEntryIds[$p['data']['entry_id']])) {
                    $staleUserIds[] = "timer:{$userId}";
                }
            }
            if (!empty($staleUserIds)) {
                Redis::del(...$staleUserIds);
            }
        }

        $onlineUsers = [];
        foreach ($pendingOnline as $userId => $p) {
            if (!isset($openEntryIds[$p['data']['entry_id']])) {
                continue; // stale key — skip
            }
            $onlineUsers[] = [
                'user' => $p['user'],
                'timer' => $p['data'],
                'elapsed_seconds' => (int) abs($now->diffInSeconds(Carbon::parse($p['data']['started_at']))),
            ];
        }

        // Hours per user in range.
        // Every APPROVED non-idle entry counts, manual included — the card is "hours worked",
        // not "tracker uptime", and every other rollup (ReportService, timesheets, attendance,
        // DailyActivitySummaryService) already sums manual time once it is approved. Narrowing
        // this to type='tracked' made the dashboard the only surface that silently dropped an
        // approved manual entry. The idle bucket stays excluded, as it always was, and
        // pending/rejected manual time stays invisible via approval_status.
        $rangeEntries = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
            ->where('organization_id', $orgId)
            ->where('started_at', '>=', $dateFrom)
            ->where('started_at', '<', $dateTo)
            ->whereNotNull('ended_at')
            ->where('type', '!=', 'idle')
            ->where('approval_status', 'approved')
            ->selectRaw('user_id, SUM(' . WorkedTime::durationExpr() . ') as total_seconds')
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
            ->where('type', '!=', 'idle')
            ->where('approval_status', 'approved')
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

            // Guard against stale Redis keys: verify the entry is still open in the DB.
            // There is a small window after TimerService::stopTimer() commits to the DB
            // but before Redis::del() fires where the key still exists. Without this check
            // the stopped entry's duration_seconds would be counted twice — once from the
            // completed-entries SUM query (whereNotNull('ended_at')) and again here as
            // elapsed_seconds — inflating today's and the week's totals.
            $entryStillOpen = !empty($data['entry_id']) && TimeEntry::withoutGlobalScope(
                \App\Models\Scopes\GlobalOrganizationScope::class
            )
                ->where('id', $data['entry_id'])
                ->whereNull('ended_at')
                ->exists();

            if ($entryStillOpen) {
                $timer = [
                    'timer'           => $data,
                    'elapsed_seconds' => (int) abs(now()->diffInSeconds(Carbon::parse($data['started_at']))),
                ];
            } else {
                // Entry already closed — clean up the stale key so this check isn't repeated.
                Redis::del("timer:{$user->id}");
            }
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

        // Approved non-idle entries, manual included — see the note on the team rollup above.
        $rangeSeconds = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
            ->where('user_id', $user->id)
            ->where('started_at', '>=', $dateFrom)
            ->where('started_at', '<', $dateTo)
            ->whereNotNull('ended_at')
            ->where('type', '!=', 'idle')
            ->where('approval_status', 'approved')
            ->selectRaw('COALESCE(SUM(' . WorkedTime::durationExpr() . '), 0) as total_seconds')
            ->value('total_seconds');

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
        $weekOffset = (int) $request->input('week_offset', 0);
        $weekStart = Carbon::now($tz)->startOfWeek()->addWeeks($weekOffset);
        $weekEnd   = Carbon::now($tz)->endOfWeek()->addWeeks($weekOffset);
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
            ->where('type', '!=', 'idle')
            ->where('approval_status', 'approved')
            ->selectRaw('COALESCE(SUM(' . WorkedTime::durationExpr() . '), 0) as total_seconds')
            ->value('total_seconds');

        // Include current running timer in weekly total only if it started within this week.
        // Without the boundary check a timer that started in a previous week would add its
        // full elapsed_seconds (potentially days) to the current week's total.
        if ($timer) {
            $timerStartedAt = Carbon::parse($timer['timer']['started_at']);
            if ($timerStartedAt >= Carbon::parse($weekStartUtc) && $timerStartedAt < Carbon::parse($weekEndUtc)) {
                $weekSeconds += (int) $timer['elapsed_seconds'];
            }
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
                ->where('type', '!=', 'idle')
                ->where('approval_status', 'approved')
                ->selectRaw('COALESCE(SUM(' . WorkedTime::durationExpr() . '), 0) as total_seconds')
                ->value('total_seconds');

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
            'week_offset'         => $weekOffset,
            'week_start'          => $weekStart->toDateString(),
            'week_end'            => $weekEnd->toDateString(),
            'date_from'           => $responseDateFrom,
            'date_to'             => $responseDateTo,
        ]);
    }

    /**
     * "What did I spend my time on?" — the caller's OWN hours for one month,
     * grouped by project.
     *
     * Always self-scoped, whatever the caller's role: this answers a question
     * about your own work, so there is no user_id parameter to widen it with.
     * That is also why it sits behind dashboard.view_own_stats — the one
     * permission every role holds — rather than reports.view, which employees
     * deliberately do not have.
     *
     * The month is resolved in the user's date timezone (the same zone the
     * dashboard cards and the daily breakdown bucket by), so a late-evening
     * entry does not fall into the next month for anyone east of UTC. Worked
     * time is the documented rule — closed, not idle, approved — and the
     * duration comes from WorkedTime so this card can never disagree with the
     * "This Week" card sitting above it.
     */
    public function projectHours(Request $request): JsonResponse
    {
        $request->validate([
            'period' => ['sometimes', 'in:today,week,month,custom'],
            'month' => ['sometimes', 'nullable', 'date_format:Y-m'],
            'week_of' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'start_date' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'end_date' => ['sometimes', 'nullable', 'date_format:Y-m-d', 'after_or_equal:start_date'],
            'project_id' => ['sometimes', 'nullable', 'uuid'],
        ]);

        $user = $request->user();
        $tz = $user->getTimezoneForDates();

        // Same period contract as the project-time report (week / month /
        // custom), so one mental model covers both screens.
        [$from, $to, $startDate, $endDate] = $this->resolveProjectHoursRange($request, $tz);

        $duration = WorkedTime::durationExpr('time_entries');

        $query = TimeEntry::withoutGlobalScope(\App\Models\Scopes\GlobalOrganizationScope::class)
            // Explicit org scope alongside user_id: this is a raw aggregate, and
            // rule 1 does not make an exception for "the user id implies it".
            ->where('time_entries.organization_id', $user->organization_id)
            ->where('time_entries.user_id', $user->id)
            ->where('time_entries.started_at', '>=', $from)
            ->where('time_entries.started_at', '<', $to)
            ->whereNotNull('time_entries.ended_at')
            ->where('time_entries.type', '!=', 'idle')
            ->where('time_entries.approval_status', 'approved');

        if ($request->filled('project_id')) {
            $query->where('time_entries.project_id', $request->input('project_id'));
        }

        $rows = $query
            ->leftJoin('projects', 'projects.id', '=', 'time_entries.project_id')
            ->groupBy('time_entries.project_id', 'projects.name', 'projects.color')
            ->selectRaw("
                time_entries.project_id,
                projects.name as project_name,
                projects.color as project_color,
                COUNT(*) as entry_count,
                COALESCE(SUM({$duration}), 0) as total_seconds
            ")
            ->orderByDesc('total_seconds')
            ->get();

        $projects = $rows->map(fn ($row) => [
            'project_id' => $row->project_id,
            // A tracked entry with no project is real work and must still be
            // counted, or the rows would not add up to the total.
            'name' => $row->project_name ?? 'No project',
            'color' => $row->project_color,
            'entry_count' => (int) $row->entry_count,
            'total_seconds' => (int) $row->total_seconds,
        ])->values();

        return response()->json([
            'period' => $request->input('period', 'month'),
            'date_from' => $startDate,
            'date_to' => $endDate,
            'total_seconds' => (int) $projects->sum('total_seconds'),
            'projects' => $projects,
        ]);
    }

    /**
     * [$startUtc, $endUtc, $startLocalDate, $endLocalDate] for the requested
     * period, resolved in the user's date timezone.
     *
     * Mirrors ProjectTimeReportService::resolveRange — deliberately the same
     * parameter names (period / month / week_of / start_date+end_date), so the
     * two surfaces cannot drift into answering the same question differently.
     * The local dates are returned alongside the UTC bounds because the client
     * renders the range it asked for, not the instant it was translated to.
     */
    private function resolveProjectHoursRange(Request $request, string $tz): array
    {
        $period = $request->input('period', 'month');

        if ($period === 'today') {
            // Today in the user's own zone, not the server's — the same day the
            // "Today's Hours" card counts.
            $start = Carbon::now($tz)->toDateString();
            $end = $start;
        } elseif ($period === 'custom') {
            $start = $request->input('start_date') ?: Carbon::now($tz)->toDateString();
            $end = $request->input('end_date') ?: $start;
        } elseif ($period === 'week') {
            $anchor = $request->filled('week_of')
                ? Carbon::parse($request->input('week_of'), $tz)
                : Carbon::now($tz);
            $start = $anchor->copy()->startOfWeek()->toDateString();
            $end = $anchor->copy()->endOfWeek()->toDateString();
        } else {
            $anchor = $request->filled('month')
                ? Carbon::parse($request->input('month') . '-01', $tz)
                : Carbon::now($tz);
            $start = $anchor->copy()->startOfMonth()->toDateString();
            $end = $anchor->copy()->endOfMonth()->toDateString();
        }

        [$fromUtc, $toUtc] = TimezoneAwareDateRange::toUtcBounds($start, $end, $tz);

        return [$fromUtc, $toUtc, $start, $end];
    }
}
