<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AgentController extends Controller
{
    public function config(Request $request): JsonResponse
    {
        $org = $request->user()->organization;
        return response()->json([
            'screenshot_interval' => $org->getSetting('screenshot_interval', 5),
            'idle_timeout' => $org->getSetting('idle_timeout', 5),
            'blur_screenshots' => $org->getSetting('blur_screenshots', false),
            'track_urls' => $org->getSetting('track_urls', true),
            'can_add_manual_time' => $org->getSetting('can_add_manual_time', true),
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
