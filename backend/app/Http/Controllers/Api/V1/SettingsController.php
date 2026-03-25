<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SettingsController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $org = $request->user()->organization;
        return response()->json([
            'organization' => [
                'id' => $org->id,
                'name' => $org->name,
                'slug' => $org->slug,
                'plan' => $org->plan,
                'trial_ends_at' => $org->trial_ends_at,
                'settings' => $org->settings ?? $org->getDefaultSettings(),
            ],
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        if (!$request->user()->hasRole('owner', 'admin')) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $request->validate([
            'name' => 'sometimes|string|max:255',
            'settings' => 'sometimes|array',
            'settings.screenshot_interval' => 'sometimes|integer|in:5,10,15',
            'settings.blur_screenshots' => 'sometimes|boolean',
            'settings.idle_timeout' => 'sometimes|nullable|integer|min:0|max:30',
            'settings.idle_alert_email_enabled' => 'sometimes|boolean',
            // Clamp via validation; job also defensively clamps.
            'settings.idle_alert_email_cooldown_min' => 'sometimes|integer|min:5|max:1440',
            'settings.keep_idle_time' => 'sometimes|string|in:prompt,always,never',
            'settings.idle_alert_auto_stop_min' => 'sometimes|integer|min:1|max:60',
            'settings.screenshot_capture_immediate_after_idle' => 'sometimes|boolean',
            'settings.screenshot_first_capture_delay_min' => 'sometimes|integer|min:0|max:60',
            'settings.idle_check_interval_sec' => 'sometimes|integer|min:1|max:60',
            'settings.capture_only_when_visible' => 'sometimes|boolean',
            'settings.capture_multi_monitor' => 'sometimes|boolean',
            'settings.track_urls' => 'sometimes|boolean',
            'settings.timezone' => 'sometimes|string',
            'settings.can_add_manual_time' => 'sometimes|boolean',
            'settings.require_project' => 'sometimes|boolean',
            'settings.weekly_limit_hours' => 'sometimes|nullable|integer|min:0|max:168',
            'settings.employees_see_all_projects' => 'sometimes|boolean',
        ]);

        $org = $request->user()->organization;

        if ($request->has('name')) {
            $org->name = $request->name;
        }

        if ($request->has('settings')) {
            $currentSettings = $org->settings ?? $org->getDefaultSettings();
            $allowedKeys = array_flip([
                'screenshot_interval',
                'blur_screenshots',
                'idle_timeout',
                'idle_alert_email_enabled',
                'idle_alert_email_cooldown_min',
                'keep_idle_time',
                'idle_alert_auto_stop_min',
                'screenshot_capture_immediate_after_idle',
                'screenshot_first_capture_delay_min',
                'idle_check_interval_sec',
                'capture_only_when_visible',
                'capture_multi_monitor',
                'track_urls',
                'timezone',
                'can_add_manual_time',
                'require_project',
                'weekly_limit_hours',
                'employees_see_all_projects',
            ]);
            $filteredSettings = array_intersect_key($request->settings, $allowedKeys);
            $org->settings = array_merge($currentSettings, $filteredSettings);
        }

        $org->save();

        return response()->json([
            'organization' => [
                'id' => $org->id,
                'name' => $org->name,
                'settings' => $org->settings,
            ],
        ]);
    }
}
