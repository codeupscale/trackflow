<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Prevent duplicate open timers at the database level.
 *
 * Root cause: Redis::del() inside DB::transaction() fires immediately (Redis is not
 * transactional). If the DB transaction rolls back, the Redis key is gone but ended_at
 * is still NULL — an orphaned open entry with no Redis key. A subsequent startTimer()
 * sees no Redis key, skips the auto-stop guard, and creates a second open entry.
 *
 * The code fixes (stopWithMeta + startWithMeta DB fallback) prevent new occurrences.
 * This partial unique index is a belt-and-suspenders backstop: it makes it impossible
 * at the DB level to ever have two open entries for the same user in the same org,
 * regardless of what the application layer does.
 *
 * PostgreSQL partial unique indexes only apply to rows matching the WHERE clause,
 * so closed entries (ended_at IS NOT NULL) and soft-deleted entries are unaffected.
 */
return new class extends Migration
{
    public function up(): void
    {
        // First, resolve any existing duplicate open entries before adding the constraint.
        // Keep the most recent open entry per user; close all older ones.
        DB::statement("
            UPDATE time_entries
            SET
                ended_at         = started_at,
                duration_seconds = 0,
                updated_at       = NOW()
            WHERE id IN (
                SELECT te.id
                FROM time_entries te
                INNER JOIN (
                    SELECT user_id, organization_id, MAX(started_at) AS latest_start
                    FROM time_entries
                    WHERE ended_at IS NULL
                      AND deleted_at IS NULL
                    GROUP BY user_id, organization_id
                    HAVING COUNT(*) > 1
                ) dupes ON te.user_id = dupes.user_id
                       AND te.organization_id = dupes.organization_id
                WHERE te.ended_at IS NULL
                  AND te.deleted_at IS NULL
                  AND te.started_at < dupes.latest_start
            )
        ");

        // Add partial unique index: only one open (ended_at IS NULL) non-deleted entry
        // per user per organisation is allowed.
        DB::statement("
            CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
                idx_one_active_timer_per_user
            ON time_entries (user_id, organization_id)
            WHERE ended_at IS NULL
              AND deleted_at IS NULL
        ");
    }

    public function down(): void
    {
        DB::statement('DROP INDEX CONCURRENTLY IF EXISTS idx_one_active_timer_per_user');
    }
};
