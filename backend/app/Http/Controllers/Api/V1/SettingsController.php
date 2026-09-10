<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\CurrencyConversionService;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

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
                // MERGED with the defaults, not `?:`. A saved settings blob is
                // only the keys that have ever been written, so any newly
                // introduced default — currency among them — was invisible to
                // the client until someone happened to save the form.
                'settings' => array_merge($org->getDefaultSettings(), $org->settings ?? []),
            ],
        ]);
    }

    /**
     * Change the organization's currency, converting every stored amount.
     *
     * Separate from `update()` because it is not a setting change — it is a
     * data migration that happens to be triggered by one. Sending `currency`
     * through the ordinary settings save would restate every salary in the
     * product at the new symbol without repricing it.
     *
     * `preview` answers "what would this do" without doing it, so the operator
     * confirms against real numbers rather than a promise.
     */
    public function convertCurrency(Request $request, CurrencyConversionService $conversion): JsonResponse
    {
        if (! $request->user()->hasRole('owner', 'org_manager')) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $valid = $request->validate([
            'currency' => ['required', 'string', Rule::in(array_keys(config('money.currencies')))],
            // An upper bound as well as a lower one: a fat-fingered rate is the
            // one input here that can quietly multiply an entire payroll.
            'rate' => ['required', 'numeric', 'gt:0', 'lte:100000'],
            'preview' => ['sometimes', 'boolean'],
        ]);

        $org = $request->user()->organization;

        if ($valid['currency'] === Money::currencyFor($org->id)) {
            return response()->json([
                'message' => 'The organization already uses that currency.',
            ], 422);
        }

        if ($request->boolean('preview')) {
            return response()->json([
                'data' => $conversion->preview($org, $valid['currency'], (float) $valid['rate']),
            ]);
        }

        $touched = $conversion->convert($org, $valid['currency'], (float) $valid['rate']);

        return response()->json([
            'message' => "Currency changed to {$valid['currency']} and existing amounts converted.",
            'data' => $touched,
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        if (!$request->user()->hasRole('owner', 'org_manager')) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        $request->validate([
            'name' => 'sometimes|string|max:255',
            'settings' => 'sometimes|array',
            'settings.screenshot_interval' => 'sometimes|integer|in:5,10,15',
            // Screenshots per interval window (Hubstaff-style multi-capture); agent clamps to [1,10].
            'settings.screenshots_per_interval' => 'sometimes|integer|min:1|max:10',
            'settings.blur_screenshots' => 'sometimes|boolean',
            // Idle detection is always on; minimum 1 minute (no disable).
            'settings.idle_timeout' => 'sometimes|integer|min:1|max:30',
            'settings.idle_alert_email_enabled' => 'sometimes|boolean',
            // Clamp via validation; job also defensively clamps.
            'settings.idle_alert_email_cooldown_min' => 'sometimes|integer|min:5|max:1440',
            // `always` ("always keep idle time") is RETIRED — idle time is never credited
            // as work (owner policy, 2026-07-16). It is still ACCEPTED so an org holding
            // the old value, or an older client that echoes settings back, is not 422'd
            // mid-migration; AgentController::idlePolicy() folds it into `never` on read,
            // and the settings page no longer offers it.
            'settings.keep_idle_time' => 'sometimes|string|in:prompt,always,never',
            // 0 = disabled (idle popup never auto-stops); max 240 min (4 hours) when enabled
            'settings.idle_alert_auto_stop_min' => 'sometimes|integer|min:0|max:240',
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
            'settings.weekly_hours_target' => 'sometimes|integer|min:0|max:80',
        ]);

        $org = $request->user()->organization;

        if ($request->has('name')) {
            $org->name = $request->name;
        }

        if ($request->has('settings')) {
            $currentSettings = $org->settings ?? $org->getDefaultSettings();
            $allowedKeys = array_flip([
                'screenshot_interval',
                'screenshots_per_interval',
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
                // NOT 'currency'. It goes through convertCurrency(), which
                // reprices the stored amounts as it changes the code. Letting
                // it ride along here would leave every salary at its old
                // NUMBER under a new symbol — a silent 280-fold error going
                // PKR to USD. Sent here, it is dropped.
                'can_add_manual_time',
                'require_project',
                'weekly_limit_hours',
                'employees_see_all_projects',
                'weekly_hours_target',
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
