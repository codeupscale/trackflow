<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\TimerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TimerController extends Controller
{
    public function __construct(private TimerService $timerService) {}

    // TIME-01: Start timer (with idempotency key + offline started_at support for sync)
    public function start(Request $request): JsonResponse
    {
        $request->validate([
            'project_id' => 'nullable|uuid',
            'task_id' => 'nullable|uuid',
            'notes' => 'nullable|string|max:1000',
            'idempotency_key' => 'nullable|string|max:255',
            // Offline-started timers send the REAL local start time so the server
            // honors it instead of stamping now() at reconcile time (BUG 1).
            // Skew bounds (future / far-past) are enforced in TimerService.
            'started_at' => 'nullable|date',
            // A start carrying ended_at is a completed offline session replayed as a
            // single call — the server creates a CLOSED entry WITHOUT auto-stopping the
            // user's live timer (see TimerService::createClosedHistoricalEntry).
            'ended_at' => 'nullable|date',
        ]);

        try {
            $result = $this->timerService->startWithMeta(
                $request->only('project_id', 'task_id', 'notes', 'idempotency_key', 'started_at', 'ended_at')
            );

            $entry = $result['entry'];
            $isExisting = $result['is_existing'];
            $todayTotal = $this->timerService->todayTotal($entry->project_id);

            return response()->json(
                ['entry' => $entry, 'today_total' => $todayTotal],
                $isExisting ? 200 : 201
            );
        } catch (\InvalidArgumentException $e) {
            // Bad offline timestamp (future / too far in the past).
            return response()->json(['message' => $e->getMessage()], 422);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 409);
        }
    }

    // TIME-02: Stop timer (with offline timestamp + specific-entry targeting support)
    public function stop(Request $request): JsonResponse
    {
        $request->validate([
            // Bind the stop to a SPECIFIC entry so an old/replayed offline stop can never
            // close a freshly-started session (BUG 3). Optional for online stops.
            'time_entry_id' => 'nullable|uuid',
            // Allow a small clock-skew tolerance — the hard skew window is enforced in
            // TimerService (so "now + 5min" is accepted but "now + 1h" is rejected 422).
            'started_at' => 'nullable|date',
            'ended_at' => 'nullable|date',
            // Informational dedupe key the desktop may pass on reconcile.
            'idempotency_key' => 'nullable|string|max:255',
        ]);

        try {
            $result = $this->timerService->stopWithMeta(
                $request->only('time_entry_id', 'started_at', 'ended_at', 'idempotency_key')
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
            'idempotency_key' => 'nullable|string|max:255',
        ]);

        try {
            $result = $this->timerService->switchProject($request->only('project_id', 'task_id', 'idempotency_key'));
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

    // TIME-03: Pause timer (freeze elapsed; entry stays open)
    public function pause(Request $request): JsonResponse
    {
        $request->validate([
            'paused_at' => 'nullable|date',
            'pause_reason' => 'nullable|string|in:idle,manual',
            'reason' => 'nullable|string|in:idle,manual',
        ]);

        try {
            $entry = $this->timerService->pause(
                $request->only('paused_at', 'pause_reason', 'reason')
            );
            $todayTotal = $this->timerService->todayTotal($entry->project_id);

            return response()->json(['entry' => $entry, 'today_total' => $todayTotal]);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 404);
        }
    }

    // TIME-03b: Resume a paused timer
    public function resume(): JsonResponse
    {
        try {
            $entry = $this->timerService->resume();
            $todayTotal = $this->timerService->todayTotal($entry->project_id);

            return response()->json(['entry' => $entry, 'today_total' => $todayTotal]);
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
            'idle_started_at' => 'required|date|before_or_equal:now',
            'idle_ended_at' => 'required|date|before_or_equal:now|after:idle_started_at',
            'idle_seconds' => 'required|integer|min:1|max:43200',
            // 'keep' and 'reassign' are still ACCEPTED by the validator so that
            // older desktop builds get a purposeful 403 below rather than a
            // confusing validation error. The route is deliberately kept alive.
            'action' => 'required|in:discard,keep,reassign',
        ];
        if ($request->action === 'reassign') {
            $rules['project_id'] = 'required|uuid|exists:projects,id';
        }
        $request->validate($rules);

        // Idle time may no longer be credited as work (owner policy, 2026-07-16).
        //
        // 'reassign' minted brand-new type='tracked' time on another project — the
        // strongest way to get paid for time away — so it is refused here, at the
        // server, not merely hidden in the desktop UI. An older build that still
        // renders the button, or a hand-crafted request with a valid token, hits
        // this same wall. Genuinely-worked time goes through Manual Time Entry,
        // which lands in the manager approval queue.
        //
        // 'keep' never had a server-side effect (the desktop simply let the entry
        // keep running), so refusing it changes no data — it exists to give old
        // clients an explicit, honest answer instead of a silent success.
        if (in_array($request->action, ['keep', 'reassign'], true)) {
            return response()->json([
                'message' => 'Idle time can no longer be kept or reassigned. Discard it, and log any time you actually worked as a manual entry for manager approval.',
                'code' => 'IDLE_CREDIT_DISABLED',
            ], 403);
        }

        try {
            $result = $this->timerService->reportIdle($request->all());
        } catch (\Illuminate\Auth\Access\AuthorizationException $e) {
            return response()->json(['message' => $e->getMessage()], 403);
        } catch (\InvalidArgumentException $e) {
            // Out-of-skew idle timestamp (future / too far in the past) — FIX B3.
            return response()->json(['message' => $e->getMessage()], 422);
        } catch (\RuntimeException $e) {
            // 409 is terminal for the desktop on Redis-mismatch (it drops the report).
            return response()->json(['message' => $e->getMessage()], 409);
        }

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
