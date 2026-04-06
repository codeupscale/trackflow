<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\TimerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TimerController extends Controller
{
    public function __construct(private TimerService $timerService) {}

    // TIME-01: Start timer (with idempotency key support for offline sync)
    public function start(Request $request): JsonResponse
    {
        $request->validate([
            'project_id' => 'nullable|uuid',
            'task_id' => 'nullable|uuid',
            'notes' => 'nullable|string|max:1000',
            'idempotency_key' => 'nullable|string|max:255',
        ]);

        try {
            $result = $this->timerService->startWithMeta(
                $request->only('project_id', 'task_id', 'notes', 'idempotency_key')
            );

            $entry = $result['entry'];
            $isExisting = $result['is_existing'];
            $todayTotal = $this->timerService->todayTotal($entry->project_id);

            return response()->json(
                ['entry' => $entry, 'today_total' => $todayTotal],
                $isExisting ? 200 : 201
            );
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 409);
        }
    }

    // TIME-02: Stop timer (with offline timestamp support)
    public function stop(Request $request): JsonResponse
    {
        $request->validate([
            'started_at' => 'nullable|date|before_or_equal:now',
            'ended_at' => 'nullable|date|before_or_equal:now',
        ]);

        // Additional cross-field validation: ended_at must be after started_at
        if ($request->filled('started_at') && $request->filled('ended_at')) {
            $request->validate([
                'ended_at' => 'after:started_at',
            ]);
        }

        try {
            $result = $this->timerService->stopWithMeta(
                $request->only('started_at', 'ended_at')
            );

            $entry = $result['entry'];
            $todayTotal = $this->timerService->todayTotal($entry->project_id);

            return response()->json(['entry' => $entry, 'today_total' => $todayTotal]);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 404);
        }
    }

    // TIME-02b: Switch project atomically (stop current + start new in one transaction)
    public function switch(Request $request): JsonResponse
    {
        $request->validate([
            'project_id' => 'required|uuid',
            'task_id' => 'nullable|uuid',
        ]);

        try {
            $result = $this->timerService->switchProject($request->only('project_id', 'task_id'));
            $todayTotal = $this->timerService->todayTotal($result['started']->project_id);

            return response()->json([
                'stopped_entry' => $result['stopped'],
                'entry' => $result['started'],
                'today_total' => $todayTotal,
            ]);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 409);
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
        $rules = [
            'time_entry_id' => 'required|uuid',
            'idle_started_at' => 'required|date',
            'idle_ended_at' => 'required|date',
            'idle_seconds' => 'required|integer|min:1',
            'action' => 'required|in:discard,keep,reassign',
        ];
        if ($request->action === 'reassign') {
            $rules['project_id'] = 'required|uuid|exists:projects,id';
        }
        $request->validate($rules);

        if ($request->action === 'reassign') {
            $request->user()->organization->projects()->findOrFail($request->project_id);
        }

        if ($request->action === 'keep') {
            return response()->json(['message' => 'Idle time kept.']);
        }

        $result = $this->timerService->reportIdle($request->all());

        return response()->json([
            'message' => $request->action === 'reassign'
                ? 'Idle time reassigned to project.'
                : 'Idle time recorded and discarded.',
            'idle_entry' => $result['idle_entry'],
            'new_entry' => $result['new_entry'],
        ]);
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
        ]);

        try {
            $log = $this->timerService->processHeartbeat($request->all());
            return response()->json(['activity_log' => $log]);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 404);
        }
    }
}
