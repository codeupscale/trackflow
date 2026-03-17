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
            return response()->json(['entry' => $entry], 201);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 409);
        }
    }

    // TIME-02: Stop timer
    public function stop(): JsonResponse
    {
        try {
            $entry = $this->timerService->stop();

            // Return today's total so UI can show accumulated time after stop
            $todayTotal = (int) \App\Models\TimeEntry::withoutGlobalScopes()
                ->where('user_id', $entry->user_id)
                ->whereDate('started_at', now()->toDateString())
                ->whereNotNull('ended_at')
                ->where('type', 'tracked')
                ->sum('duration_seconds');

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

    // TIME-04: Get status
    public function status(): JsonResponse
    {
        $status = $this->timerService->status();
        return response()->json($status);
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
