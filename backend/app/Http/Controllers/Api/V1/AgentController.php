<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\ShiftService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AgentController extends Controller
{
    public function config(Request $request): JsonResponse
    {
        $org = $request->user()->organization;
        $idleTimeout = $org->getSetting('idle_timeout', 5);
        $idleTimeout = $idleTimeout === null ? 0 : (int) $idleTimeout;

        return response()->json([
            'screenshot_interval' => $org->getSetting('screenshot_interval', 5),
            'idle_timeout' => $idleTimeout,
            'idle_detection' => $idleTimeout > 0,
            'keep_idle_time' => $org->getSetting('keep_idle_time', 'prompt'),
            'blur_screenshots' => $org->getSetting('blur_screenshots', false),
            // Idle alert auto-stop (minutes) for prompt mode
            'idle_alert_auto_stop_min' => (int) ($org->getSetting('idle_alert_auto_stop_min', 10) ?? 10),
            // After idle alert is resolved (or auto-discard), capture one screenshot immediately
            'screenshot_capture_immediate_after_idle' => (bool) $org->getSetting(
                'screenshot_capture_immediate_after_idle',
                true
            ),
            'track_urls' => $org->getSetting('track_urls', true),
            'can_add_manual_time' => $org->getSetting('can_add_manual_time', true),
            'screenshot_first_capture_delay_min' => (int) $org->getSetting('screenshot_first_capture_delay_min', 1),
            'idle_check_interval_sec' => (int) $org->getSetting('idle_check_interval_sec', 10),
            'capture_only_when_visible' => (bool) $org->getSetting('capture_only_when_visible', false),
            'capture_multi_monitor' => (bool) $org->getSetting('capture_multi_monitor', false),
        ]);
    }

    public function myShift(Request $request): JsonResponse
    {
        $user = $request->user();
        $shift = app(ShiftService::class)->getUserCurrentShift($user->organization_id, $user->id);

        if (!$shift) {
            return response()->json(['shift' => null]);
        }

        return response()->json([
            'shift' => [
                'id' => $shift->id,
                'name' => $shift->name,
                'start_time' => $shift->start_time,
                'end_time' => $shift->end_time,
                'break_minutes' => $shift->break_minutes,
                'timezone' => $shift->timezone,
                'grace_period_minutes' => $shift->grace_period_minutes,
            ],
        ]);
    }

    public function bulkLogs(Request $request): JsonResponse
    {
        $request->validate([
            'logs' => 'required|array',
            'logs.*.keyboard_events' => 'required|integer|min:0',
            'logs.*.mouse_events' => 'required|integer|min:0',
            'logs.*.logged_at' => 'required|date',
            'logs.*.active_app' => 'nullable|string',
            'logs.*.active_window_title' => 'nullable|string',
            'logs.*.active_url' => 'nullable|string',
            'logs.*.time_entry_id' => 'required|uuid',
        ]);

        $user = $request->user();

        // Validate all time_entry_ids belong to the authenticated user
        $validEntryIds = $user->timeEntries()->pluck('id')->toArray();
        foreach ($request->logs as $log) {
            if (!in_array($log['time_entry_id'], $validEntryIds)) {
                return response()->json(['message' => 'Invalid time entry ID.'], 403);
            }
        }

        $inserted = 0;
        foreach ($request->logs as $log) {
            \App\Models\ActivityLog::create([
                'organization_id' => $user->organization_id,
                'user_id' => $user->id,
                'time_entry_id' => $log['time_entry_id'],
                'logged_at' => $log['logged_at'],
                'keyboard_events' => $log['keyboard_events'],
                'mouse_events' => $log['mouse_events'],
                'active_app' => $log['active_app'] ?? null,
                'active_window_title' => $log['active_window_title'] ?? null,
                'active_url' => $log['active_url'] ?? null,
            ]);
            $inserted++;
        }

        return response()->json(['inserted' => $inserted]);
    }
}
