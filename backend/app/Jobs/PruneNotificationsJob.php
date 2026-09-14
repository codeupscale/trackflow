<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Keep the notifications table from growing forever.
 *
 * Nothing else ever deletes a notification, and check-in plus check-out alone
 * write two rows per employee per day for every owner and HR manager — roughly
 * 8,800 rows a month at 100 staff, 44,000 at 500. The bell only ever shows the
 * newest page, so almost all of that is dead weight on the indexes the badge
 * count reads many times a minute.
 *
 * Two horizons, because read and unread are not the same promise:
 *
 *  - READ, after 90 days. Someone has seen it; the page of history at
 *    /notifications is for recent context, not an audit log.
 *  - ANYTHING, after 180 days. An unread notification that old is not going to
 *    be acted on, and keeping it would make "unread" mean "never cleared" —
 *    the badge would carry a number nobody can do anything about.
 *
 * Notifications are not the record of what happened: the leave request, the
 * payslip, the check-in session all still exist. Pruning loses nothing that is
 * not held elsewhere.
 *
 * NOTE: the scheduler is DISABLED on dev and only runs in prod — test
 * prune() directly rather than waiting for the schedule.
 */
class PruneNotificationsJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public const READ_RETENTION_DAYS = 90;

    public const ANY_RETENTION_DAYS = 180;

    /** Rows per DELETE. Small enough never to hold a long lock on a busy table. */
    private const BATCH = 1000;

    public int $tries = 3;

    public int $timeout = 300;

    public function __construct(
        public string $organizationId,
    ) {
        $this->onQueue('low');
    }

    public function handle(): void
    {
        $deleted = self::prune($this->organizationId);

        if ($deleted > 0) {
            Log::info('PruneNotificationsJob: completed', [
                'organization_id' => $this->organizationId,
                'deleted' => $deleted,
            ]);
        }
    }

    /**
     * Delete expired notifications for one organization. Returns the count.
     *
     * Static and free of queue state so a test can call it directly.
     */
    public static function prune(string $organizationId): int
    {
        $readCutoff = now()->subDays(self::READ_RETENTION_DAYS);
        $anyCutoff = now()->subDays(self::ANY_RETENTION_DAYS);
        $deleted = 0;

        do {
            // Ids first, then delete by id: Postgres has no DELETE ... LIMIT,
            // and selecting a bounded id list keeps each statement short.
            $ids = DB::table('notifications')
                ->where('organization_id', $organizationId)
                ->where(function ($q) use ($readCutoff, $anyCutoff) {
                    $q->where(fn ($r) => $r->whereNotNull('read_at')->where('created_at', '<', $readCutoff))
                        ->orWhere('created_at', '<', $anyCutoff);
                })
                ->limit(self::BATCH)
                ->pluck('id');

            if ($ids->isEmpty()) {
                break;
            }

            $deleted += DB::table('notifications')->whereIn('id', $ids)->delete();
        } while ($ids->count() === self::BATCH);

        return $deleted;
    }

    public function backoff(): array
    {
        return [60, 300, 900];
    }

    public function failed(\Throwable $exception): void
    {
        Log::error('PruneNotificationsJob: failed', [
            'organization_id' => $this->organizationId,
            'error' => $exception->getMessage(),
        ]);
    }
}
