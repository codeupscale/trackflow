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
            return response()->json(['entry' => $entry]);
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
