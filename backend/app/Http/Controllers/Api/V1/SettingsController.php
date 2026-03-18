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
            'settings.keep_idle_time' => 'sometimes|string|in:prompt,always,never',
            'settings.timezone' => 'sometimes|string',
            'settings.can_add_manual_time' => 'sometimes|boolean',
        ]);

        $org = $request->user()->organization;

        if ($request->has('name')) {
            $org->name = $request->name;
        }

        if ($request->has('settings')) {
            $currentSettings = $org->settings ?? $org->getDefaultSettings();
            $org->settings = array_merge($currentSettings, $request->settings);
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
