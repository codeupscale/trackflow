<?php

namespace App\Support;

use App\Models\ActivityLog;
use App\Models\Screenshot;

/**
 * Resolves the activity metrics shown next to a screenshot so that the
 * displayed percentage and the displayed keyboard/mouse counts always come
 * from the SAME sampling window.
 *
 * QA bug (activity-percentage-mismatch): the old display path fell back to the
 * time-entry's aggregate activity_score (unrelated to this screenshot's window)
 * and joined the nearest ActivityLog within a ±10-minute window (a different
 * sampling window than the score). Both produced score/events mismatches such
 * as "0 mouse + 0 keyboard showing 14%".
 *
 * Fix: match the ActivityLog whose window actually contains the capture using a
 * tight window aligned to the 30s heartbeat interval, and derive the percentage
 * from that same window (never the entry aggregate).
 */
class ScreenshotActivity
{
    /**
     * How close an ActivityLog's logged_at must be to captured_at to count as
     * the screenshot's sampling window. One 30s heartbeat interval + skew.
     */
    public const MATCH_WINDOW_SECONDS = 60;

    /** Heartbeat interval used to convert active_seconds into a percentage. */
    private const HEARTBEAT_INTERVAL_SECONDS = 30;

    /** Legacy event-count normaliser (keyboard+mouse events per interval → 100%). */
    private const MAX_EVENTS_PER_INTERVAL = 300;

    /**
     * Instant activity percentage (0-100) for a single ActivityLog.
     * Mirrors TimerService heartbeat scoring so display matches ground truth.
     */
    public static function scoreForLog(ActivityLog $log): int
    {
        if ($log->active_seconds !== null) {
            $active = min((int) $log->active_seconds, self::HEARTBEAT_INTERVAL_SECONDS);

            return max(0, min(100, (int) round(($active / self::HEARTBEAT_INTERVAL_SECONDS) * 100)));
        }

        $total = (int) $log->keyboard_events + (int) $log->mouse_events;

        return max(0, min(100, (int) round(($total / self::MAX_EVENTS_PER_INTERVAL) * 100)));
    }

    /**
     * Resolve activity_score + keyboard/mouse events for one screenshot from the
     * single ActivityLog whose window contains the capture. Non-batched — safe
     * for single-item paths (e.g. the broadcast event). List endpoints should
     * batch-load to avoid N+1.
     *
     * @return array{activity_score:int, keyboard_events:?int, mouse_events:?int}
     */
    public static function resolveForScreenshot(Screenshot $screenshot): array
    {
        $log = null;

        if ($screenshot->time_entry_id && $screenshot->captured_at) {
            $log = ActivityLog::where('organization_id', $screenshot->organization_id)
                ->where('time_entry_id', $screenshot->time_entry_id)
                ->whereBetween('logged_at', [
                    $screenshot->captured_at->copy()->subSeconds(self::MATCH_WINDOW_SECONDS),
                    $screenshot->captured_at->copy()->addSeconds(self::MATCH_WINDOW_SECONDS),
                ])
                ->get()
                ->sortBy(fn ($l) => abs($l->logged_at->diffInSeconds($screenshot->captured_at)))
                ->first();
        }

        return [
            'activity_score'  => self::resolveScore($screenshot, $log),
            'keyboard_events' => $log?->keyboard_events,
            'mouse_events'    => $log?->mouse_events,
        ];
    }

    /**
     * Screenshot activity percentage: the desktop-computed capture score
     * (aligned to the screenshot's own sampling window) is authoritative.
     * When absent, derive from the matched window's log — NEVER the entry
     * aggregate, which is what caused the reported mismatch.
     */
    public static function resolveScore(Screenshot $screenshot, ?ActivityLog $matchedLog): int
    {
        if ($screenshot->activity_score_at_capture !== null) {
            return (int) $screenshot->activity_score_at_capture;
        }

        return $matchedLog ? self::scoreForLog($matchedLog) : 0;
    }
}
