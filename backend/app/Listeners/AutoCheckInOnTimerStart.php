<?php

namespace App\Listeners;

use App\Events\TimerStarted;
use App\Services\CheckInService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Log;

/**
 * Auto-creates an attendance check-in the first time a user starts tracking on a
 * given day (owner request, 2026-07-16).
 *
 * Queued, so it stays off the latency-sensitive timer-start request path and a
 * slow/locked attendance write never delays the desktop's 201. Gated per-org by
 * the `auto_check_in_on_track` setting (checked inside the service) — the vast
 * majority of TimerStarted events short-circuit immediately.
 *
 * Idempotency is the service's job: autoCheckInFromTracking() no-ops when the
 * user already has a session that day, so retries, offline replays, and the
 * auto-stop-then-start burst (which fires TimerStarted more than once per sync)
 * are all safe. TimerStarted is only dispatched for genuinely NEW entries — the
 * is_existing idempotent-replay returns in TimerService happen before dispatch —
 * so a replayed start does not re-fire this.
 */
class AutoCheckInOnTimerStart implements ShouldQueue
{
    public int $tries = 3;

    public int $timeout = 30;

    public array $backoff = [10, 30, 60];

    public function __construct(
        private readonly CheckInService $checkInService,
    ) {}

    public function handle(TimerStarted $event): void
    {
        $entry = $event->entry;
        $user = $entry->user;

        // Defensive: a deleted user or a null start (shouldn't happen — started_at
        // is non-null on create) simply yields nothing to check in.
        if ($user === null || $entry->started_at === null) {
            return;
        }

        // Use the entry's real started_at — for an offline/backdated start this is
        // the true moment work began, not the sync time.
        $this->checkInService->autoCheckInFromTracking($user, $entry->started_at);
    }

    /**
     * A check-in failure must never surface as a timer failure — the timer already
     * started successfully. Log and move on.
     */
    public function failed(TimerStarted $event, \Throwable $e): void
    {
        Log::warning('[AutoCheckIn] failed for time entry '.$event->entry->id.': '.$e->getMessage());
    }
}
