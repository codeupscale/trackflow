<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\TimerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * READ-ONLY timer surface, plus the heartbeat write.
 *
 * Tracked time entries are written exclusively by TimerSessionSyncController — the
 * desktop agent owns them. The start / stop / switch / pause / resume / idle endpoints
 * that used to live here were removed in the offline-first refactor: they were a second
 * writer to entries the agent also owned, and reconciling the two is what produced the
 * duplicate-entry and lost-time bug family.
 *
 * What remains:
 *   - status / todayTotal : read paths. `status` backs the WEB dashboard's live-tracking
 *                           indicator; `todayTotal` is how the desktop picks up MANUAL
 *                           entries, which it does not own and cannot compute locally.
 *   - heartbeat           : writes ActivityLog rows, not time entries. Still the source
 *                           of truth for activity scores.
 */
class TimerController extends Controller
{
    public function __construct(private TimerService $timerService) {}

    // TIME-04: Get status — current day = user's timezone (today_total is that day's total). Optional ?project_id= for project scope.
    // Response must never be cached so elapsed_seconds and today_total stay live.
    public function status(Request $request): JsonResponse
    {
        $projectId = $request->query('project_id');
        $projectId = is_string($projectId) ? trim($projectId) : $projectId;
        $projectId = $projectId === '' ? null : $projectId;
        $status = $this->timerService->status($projectId);
        return response()->json($status)
            ->header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
            ->header('Pragma', 'no-cache')
            ->header('Expires', '0');
    }

    // Today's total (optionally for a specific project) — never cached so value stays live.
    public function todayTotal(Request $request): JsonResponse
    {
        $projectId = $request->query('project_id');
        $projectId = is_string($projectId) ? trim($projectId) : $projectId;
        $projectId = $projectId === '' ? null : $projectId;
        $total = $this->timerService->todayTotal($projectId);
        return response()->json(['today_total' => $total])
            ->header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
            ->header('Pragma', 'no-cache')
            ->header('Expires', '0');
    }

    // Heartbeat
    public function heartbeat(Request $request): JsonResponse
    {
        $request->validate([
            'keyboard_events' => 'required|integer|min:0',
            'mouse_events' => 'required|integer|min:0',
            'active_seconds' => 'nullable|integer|min:0|max:30',
            'active_app' => 'nullable|string|max:255',
            'active_window_title' => 'nullable|string|max:512',
            'active_url' => 'nullable|string|max:1024',
            // Offline-flushed heartbeats carry their TRUE capture time so the activity
            // log lands at the right moment (FIX B2). Skew bounds enforced in the service.
            'logged_at' => 'nullable|date',
            'captured_at' => 'nullable|date',
        ]);

        try {
            $log = $this->timerService->processHeartbeat($request->all());
            return response()->json(['activity_log' => $log]);
        } catch (\InvalidArgumentException $e) {
            // Bad capture timestamp (future / too far in the past).
            return response()->json(['message' => $e->getMessage()], 422);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 404);
        }
    }
}
