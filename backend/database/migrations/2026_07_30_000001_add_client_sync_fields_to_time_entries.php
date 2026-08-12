<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Bookkeeping for the one-way desktop -> server session sync.
 *
 * The desktop agent is the sole writer of `type = 'tracked'` entries. It holds every
 * session in local SQLite and pushes them up as an UPSERT keyed on the client-generated
 * UUID, which is stored in the pre-existing `idempotency_key` column (already unique per
 * org via `te_org_idempotency_unique` from 2026_04_06_000001 — no new index needed).
 *
 *  - client_revision  : the local revision number last applied to this row. Every local
 *                       mutation bumps it, so the server can reject an out-of-order or
 *                       replayed push (`revision <= client_revision` is a no-op) without
 *                       needing timestamps it cannot trust.
 *  - client_synced_at : when the agent last pushed this row. This is a far better
 *                       liveness signal than the last ActivityLog heartbeat, because
 *                       offline heartbeats arrive in bursts long after the fact. Both
 *                       CleanupStaleEntries and the login-time stale-timer close key
 *                       off it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('time_entries', function (Blueprint $table) {
            $table->unsignedInteger('client_revision')->nullable()->after('idempotency_key');
            $table->timestamp('client_synced_at')->nullable()->after('client_revision');
        });

        // Backs the "is this agent still alive?" scan in CleanupStaleEntries, which looks
        // only at OPEN tracked entries. Partial so it stays tiny — closed entries are the
        // overwhelming majority and are never scanned.
        DB::statement(
            'CREATE INDEX IF NOT EXISTS idx_te_open_client_synced
             ON time_entries (client_synced_at)
             WHERE ended_at IS NULL AND deleted_at IS NULL'
        );
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS idx_te_open_client_synced');

        Schema::table('time_entries', function (Blueprint $table) {
            $table->dropColumn(['client_revision', 'client_synced_at']);
        });
    }
};
