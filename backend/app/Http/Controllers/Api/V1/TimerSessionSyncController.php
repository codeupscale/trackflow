<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\TimeEntrySyncService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;

/**
 * Receives the desktop agent's local session state.
 *
 * This is the ONLY write path for `type = 'tracked'` time entries. See
 * App\Services\TimeEntrySyncService for the upsert semantics.
 */
class TimerSessionSyncController extends Controller
{
    public function __construct(private TimeEntrySyncService $syncService) {}

    public function __invoke(Request $request): JsonResponse
    {
        $max = (int) config('timer.sync_batch_max', 100);

        $validated = $request->validate([
            'sessions' => "required|array|min:1|max:{$max}",
            'sessions.*.uuid' => 'required|uuid',
            'sessions.*.revision' => 'required|integer|min:1',
            'sessions.*.started_at' => 'required|date',
            'sessions.*.ended_at' => 'nullable|date',
            'sessions.*.project_id' => 'nullable|uuid',
            'sessions.*.task_id' => 'nullable|uuid',
            'sessions.*.notes' => 'nullable|string|max:2000',
        ]);

        $this->assertUniqueUuids($validated['sessions']);
        $this->assertAtMostOneOpenSession($validated['sessions']);

        $results = $this->syncService->sync($validated['sessions'], Auth::user());

        $accepted = count(array_filter(
            $results,
            fn ($r) => $r['status'] === TimeEntrySyncService::STATUS_OK
        ));

        return response()->json([
            'server_time' => now()->toISOString(),
            'results' => $results,
            'meta' => [
                'accepted' => $accepted,
                'rejected' => count($results) - $accepted,
            ],
        ])->header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    }

    /**
     * A duplicated uuid inside one batch would make the second copy silently lose to the
     * first via the stale-revision guard, which looks like data loss to the agent. Fail
     * loudly instead — it can only be an agent bug.
     */
    private function assertUniqueUuids(array $sessions): void
    {
        $uuids = array_column($sessions, 'uuid');

        if (count($uuids) !== count(array_unique($uuids))) {
            throw ValidationException::withMessages([
                'sessions' => ['Duplicate session uuid in batch.'],
            ]);
        }
    }

    /**
     * At most one session may be open. `idx_one_active_timer_per_user` permits a single
     * open entry per user, and the agent only ever runs one timer, so two open sessions
     * in a batch means the local state is corrupt — reject rather than let the service
     * pick an arbitrary winner.
     */
    private function assertAtMostOneOpenSession(array $sessions): void
    {
        $open = array_filter($sessions, fn ($s) => empty($s['ended_at']));

        if (count($open) > 1) {
            throw ValidationException::withMessages([
                'sessions' => ['Only one session may be open per sync.'],
            ]);
        }
    }
}
