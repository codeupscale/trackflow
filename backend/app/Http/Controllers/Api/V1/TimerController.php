<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\TimerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TimerController extends Controller
{
    public function __construct(private TimerService $timerService) {}

    // TIME-01: Start timer
    public function start(Request $request): JsonResponse
    {
        $request->validate([
            'project_id' => 'nullable|uuid',
            'task_id' => 'nullable|uuid',
            'notes' => 'nullable|string|max:1000',
        ]);

        try {
            $entry = $this->timerService->start($request->only('project_id', 'task_id', 'notes'));

            // Return today's total for this project so header shows correct total (resumes from where it stopped)
            $todayTotal = $this->timerService->todayTotal($entry->project_id);

            return response()->json(['entry' => $entry, 'today_total' => $todayTotal], 201);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 409);
        }
    }

    // TIME-02: Stop timer
    public function stop(): JsonResponse
    {
        try {
            $entry = $this->timerService->stop();

            // Return today's total for this project so header shows correct total
            $todayTotal = $this->timerService->todayTotal($entry->project_id);

            return response()->json(['entry' => $entry, 'today_total' => $todayTotal]);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 404);
        }
    }

    // TIME-03: Pause timer
    public function pause(): JsonResponse
    {
        try {
            $entry = $this->timerService->pause();
            return response()->json(['entry' => $entry]);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 404);
        }
    }

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

    // TIME-05: Report idle time (from desktop agent)
    public function idle(Request $request): JsonResponse
    {
        $request->validate([
            'time_entry_id' => 'required|uuid',
            'idle_started_at' => 'required|date',
            'idle_ended_at' => 'required|date',
            'idle_seconds' => 'required|integer|min:1',
            'action' => 'required|in:discard,keep',
        ]);

        if ($request->action === 'keep') {
            return response()->json(['message' => 'Idle time kept.']);
        }

        $entry = $this->timerService->reportIdle($request->all());

        return response()->json([
            'message' => 'Idle time recorded and discarded.',
            'idle_entry' => $entry,
        ]);
    }

    // Heartbeat
    public function heartbeat(Request $request): JsonResponse
    {
        $request->validate([
            'keyboard_events' => 'required|integer|min:0',
            'mouse_events' => 'required|integer|min:0',
            'active_app' => 'nullable|string|max:255',
            'active_window_title' => 'nullable|string|max:512',
            'active_url' => 'nullable|string|max:1024',
        ]);

        try {
            $log = $this->timerService->processHeartbeat($request->all());
            return response()->json(['activity_log' => $log]);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 404);
        }
    }
}
