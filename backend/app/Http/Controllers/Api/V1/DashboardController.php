<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\TimeEntry;
use App\Models\User;
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

        // Date range: default to current day (00:00–23:59) so after midnight we show new day's data
        $dateFrom = $request->has('date_from')
            ? Carbon::parse($request->date_from)->startOfDay()->toDateString()
            : today()->toDateString();
        $dateTo = $request->has('date_to')
            ? Carbon::parse($request->date_to)->endOfDay()->format('Y-m-d H:i:s')
            : today()->endOfDay()->format('Y-m-d H:i:s');

        // Managers/admins/owners see the full team dashboard
        $users = User::withoutGlobalScopes()
            ->where('organization_id', $orgId)
            ->where('is_active', true)
            ->get(['id', 'name', 'email', 'role', 'last_active_at', 'avatar_url']);

        $onlineUsers = [];
        foreach ($users as $u) {
            $timerData = Redis::get("timer:{$u->id}");
            if ($timerData) {
                $data = json_decode($timerData, true);
                $onlineUsers[] = [
                    'user' => $u,
                    'timer' => $data,
                    'elapsed_seconds' => (int) abs(now()->diffInSeconds(Carbon::parse($data['started_at']))),
                ];
            }
        }

        // Time entries in the selected date range (current day by default; resets after 12:00 AM)
        $rangeEntries = TimeEntry::withoutGlobalScopes()
            ->where('organization_id', $orgId)
            ->where('started_at', '>=', $dateFrom)
            ->where('started_at', '<=', $dateTo)
            ->whereNotNull('ended_at')
            ->where('type', 'tracked')
            ->selectRaw('user_id, SUM(duration_seconds) as total_seconds, AVG(activity_score) as avg_activity')
            ->groupBy('user_id')
            ->get()
            ->keyBy('user_id');

        $teamSummary = $users->map(function ($u) use ($rangeEntries) {
            $entry = $rangeEntries->get($u->id);
            return [
                'user' => $u,
                'today_seconds' => $entry ? (int) $entry->total_seconds : 0,
                'activity_score' => $entry ? (int) $entry->avg_activity : 0,
            ];
        });

        return response()->json([
            'online_users' => $onlineUsers,
            'team_summary' => $teamSummary,
            'total_online' => count($onlineUsers),
            'date_from' => $dateFrom,
            'date_to' => substr($dateTo, 0, 10),
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

        $dateFrom = $request->has('date_from')
            ? Carbon::parse($request->date_from)->startOfDay()->toDateString()
            : today()->toDateString();
        $dateTo = $request->has('date_to')
            ? Carbon::parse($request->date_to)->endOfDay()->format('Y-m-d H:i:s')
            : today()->endOfDay()->format('Y-m-d H:i:s');

        $rangeSeconds = TimeEntry::withoutGlobalScopes()
            ->where('user_id', $user->id)
            ->where('started_at', '>=', $dateFrom)
            ->where('started_at', '<=', $dateTo)
            ->whereNotNull('ended_at')
            ->where('type', 'tracked')
            ->sum('duration_seconds');

        $weekSeconds = TimeEntry::withoutGlobalScopes()
            ->where('user_id', $user->id)
            ->where('started_at', '>=', now()->startOfWeek())
            ->whereNotNull('ended_at')
            ->sum('duration_seconds');

        return response()->json([
            'timer' => $timer,
            'today_seconds' => (int) $rangeSeconds,
            'week_seconds' => (int) $weekSeconds,
            'date_from' => $dateFrom,
            'date_to' => substr($dateTo, 0, 10),
        ]);
    }
}
