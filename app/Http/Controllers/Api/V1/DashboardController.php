<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Redis;

class DashboardController extends Controller
{
    // DASH-01: Dashboard data
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $orgId = $user->organization_id;

        // Get users in the org
        $users = User::withoutGlobalScopes()
            ->where('organization_id', $orgId)
            ->where('is_active', true)
            ->get(['id', 'name', 'email', 'role', 'last_active_at', 'avatar_url']);

        // Check who is online (has active timer in Redis)
        $onlineUsers = [];
        foreach ($users as $u) {
            $timerData = Redis::get("timer:{$u->id}");
            if ($timerData) {
                $data = json_decode($timerData, true);
                $onlineUsers[] = [
                    'user' => $u,
                    'timer' => $data,
                    'elapsed_seconds' => (int) abs(now()->diffInSeconds(\Carbon\Carbon::parse($data['started_at']))),
                ];
            }
        }

        // Today's hours per user
        $todayEntries = TimeEntry::withoutGlobalScopes()
            ->where('organization_id', $orgId)
            ->whereDate('started_at', today())
            ->whereNotNull('ended_at')
            ->selectRaw('user_id, SUM(duration_seconds) as total_seconds, AVG(activity_score) as avg_activity')
            ->groupBy('user_id')
            ->get()
            ->keyBy('user_id');

        $teamSummary = $users->map(function ($u) use ($todayEntries) {
            $entry = $todayEntries->get($u->id);
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
        ]);
    }
}
