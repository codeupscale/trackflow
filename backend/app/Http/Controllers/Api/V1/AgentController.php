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
        $user = $request->user();
        $org = $user->organization;
        $idleTimeout = max(1, min(30, (int) ($org->getSetting('idle_timeout', 5) ?? 5)));

        return response()->json([
            // Day-boundary zone for the agent's midnight session split.
            //
            // MUST be the same zone TimezoneAwareDateRange uses server-side, because
            // that is what every daily rollup keys off — reports, attendance and
            // payroll. Splitting on the machine's local zone instead would mis-attribute
            // hours for anyone travelling or working outside the org's zone.
            'timezone' => $user->getTimezoneForDates(),
            'screenshot_interval' => $org->getSetting('screenshot_interval', 5),
            // Number of screenshots the agent takes at random moments within each
            // interval window (Hubstaff-style). Default 3; the agent clamps to [1,10].
            'screenshots_per_interval' => (int) $org->getSetting('screenshots_per_interval', 3),
            'idle_timeout' => $idleTimeout,
            'idle_detection' => true,
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
            'idle_check_interval_sec' => (int) $org->getSetting('idle_check_interval_sec', 2),
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
        // FIX B5: time_entry_id is now OPTIONAL. Offline-captured heartbeats are
        // frequently flushed with a missing or stale time_entry_id (e.g. the entry was
        // closed/renumbered before reconnect). Dropping the whole batch with a 422 loses
        // legitimate activity. Instead we attribute each heartbeat to the user's entry
        // that was open at the heartbeat's logged_at, and skip (never 403/422-drop) any
        // log we cannot safely attribute.
        $request->validate([
            'logs' => 'required|array',
            'logs.*.keyboard_events' => 'required|integer|min:0',
            'logs.*.mouse_events' => 'required|integer|min:0',
            'logs.*.logged_at' => 'required|date',
            'logs.*.active_app' => 'nullable|string',
            'logs.*.active_window_title' => 'nullable|string',
            'logs.*.active_url' => 'nullable|string',
            'logs.*.time_entry_id' => 'nullable|uuid',
        ]);

        $user = $request->user();

        // Org-scoped set of this user's entry ids — used to reject cross-user/cross-org ids.
        $validEntryIds = $user->timeEntries()->pluck('id')->all();
        $validEntryIdSet = array_flip($validEntryIds);

        $inserted = 0;
        $skipped = 0;

        foreach ($request->logs as $log) {
            $loggedAt = $log['logged_at'];
            $entryId = $log['time_entry_id'] ?? null;

            // Reject an explicit id that is not the user's own (strict org scoping).
            if ($entryId !== null && ! isset($validEntryIdSet[$entryId])) {
                $entryId = null;
            }

            // Missing/unknown id: attribute to the user's entry that was OPEN at logged_at
            // (covers in-flight live sessions and historical entries that have since closed).
            if ($entryId === null) {
                $entryId = $this->resolveEntryIdForHeartbeat($user, $loggedAt);
            }

            // Could not safely attribute — skip this log rather than dropping the batch.
            if ($entryId === null) {
                $skipped++;
                continue;
            }

            \App\Models\ActivityLog::create([
                'organization_id' => $user->organization_id,
                'user_id' => $user->id,
                'time_entry_id' => $entryId,
                'logged_at' => $loggedAt,
                'keyboard_events' => $log['keyboard_events'],
                'mouse_events' => $log['mouse_events'],
                'active_app' => $log['active_app'] ?? null,
                'active_window_title' => $log['active_window_title'] ?? null,
                'active_url' => $log['active_url'] ?? null,
            ]);
            $inserted++;
        }

        return response()->json(['inserted' => $inserted, 'skipped' => $skipped]);
    }

    /**
     * Resolve which of the user's time entries a flushed heartbeat belongs to, based on
     * the heartbeat's capture time. Strictly org-scoped to the authenticated user.
     *
     * Matches the entry whose [started_at, ended_at] window contains $loggedAt (still-open
     * entries match when started_at <= logged_at). Returns null when nothing matches.
     */
    private function resolveEntryIdForHeartbeat($user, string $loggedAt): ?string
    {
        try {
            $ts = \Carbon\Carbon::parse($loggedAt);
        } catch (\Throwable $e) {
            return null;
        }

        return \App\Models\TimeEntry::where('organization_id', $user->organization_id)
            ->where('user_id', $user->id)
            ->where('started_at', '<=', $ts)
            ->where(function ($q) use ($ts) {
                $q->whereNull('ended_at')
                    ->orWhere('ended_at', '>=', $ts);
            })
            ->orderByDesc('started_at')
            ->value('id');
    }
}
