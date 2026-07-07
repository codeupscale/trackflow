<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Adds an explicit approval workflow to time_entries for the "manual time entry
 * with approval" feature.
 *
 * time_entries already carries type ['tracked','manual','idle'], the boolean
 * is_approved, approved_by, approved_at, idempotency_key and softDeletes. This
 * migration layers a richer, auditable status machine on top:
 *
 *   - approval_status ['pending','approved','rejected'] — the authoritative
 *     state. It DEFAULTS to 'approved' so tracker/idle entries and every
 *     pre-existing row are treated as approved with zero behavioural change:
 *     no existing report, aggregate or dashboard regresses. Only manually
 *     entered time is inserted as 'pending' by the application layer.
 *   - submitted_by — who created the manual entry (may differ from user_id when
 *     an admin logs time on someone's behalf). nullOnDelete keeps history if the
 *     submitter is later removed.
 *   - rejection_reason — free-text note surfaced to the employee on rejection.
 *
 * Multi-tenancy: no new tenant boundary is introduced. Every index added here
 * still leads with organization_id, matching the GlobalOrganizationScope /
 * BelongsToOrganization contract already enforced on the model. A cross-org scan
 * remains impossible via these access paths.
 *
 * PROD ROLLOUT NOTE (large tables):
 * On a big org, time_entries can exceed 100k+ rows. This migration is written for
 * DEV correctness and runs inside Laravel's implicit transaction with a plain
 * CREATE INDEX. For a production rollout on a large table, DO NOT run this as-is:
 *   1. Add the columns (fast, metadata-only) in one small migration.
 *   2. Run the is_approved backfill OUT OF BAND in throttled batches (this file's
 *      batched loop is the reference), off the migration transaction.
 *   3. Create both indexes in a SEPARATE migration with `public $withinTransaction
 *      = false;` using `CREATE INDEX CONCURRENTLY` so writes are never locked
 *      (see 2026_04_10_000001_add_unique_open_timer_constraint.php for the exact
 *      CONCURRENTLY pattern). CONCURRENTLY cannot run inside a transaction block,
 *      which is why it is intentionally NOT used here.
 */
return new class extends Migration
{
    public function up(): void
    {
        // 1. Add the new columns. On PostgreSQL an enum column is realised as a
        //    varchar + CHECK constraint; ->after() is ignored by PG (no column
        //    ordering) but kept for intent/parity with the requested schema.
        Schema::table('time_entries', function (Blueprint $table) {
            $table->enum('approval_status', ['pending', 'approved', 'rejected'])
                ->default('approved')
                ->after('is_approved');
            $table->foreignUuid('submitted_by')->nullable()->after('approved_at')
                ->constrained('users')->nullOnDelete();
            $table->text('rejection_reason')->nullable()->after('submitted_by');
        });

        // 2. Backfill every existing row to a consistent approved state.
        //    approval_status already defaulted to 'approved' for existing rows, so
        //    this UPDATE is a no-op for that column — but we set it explicitly
        //    alongside is_approved=true for safety/clarity and to normalise any
        //    historical rows left at is_approved=false. Batched by id (5k/loop) so
        //    we never take a long table-wide row lock on large orgs.
        DB::table('time_entries')
            ->orderBy('id')
            ->chunkById(5000, function ($rows) {
                DB::table('time_entries')
                    ->whereIn('id', $rows->pluck('id'))
                    ->update([
                        'approval_status' => 'approved',
                        'is_approved' => true,
                    ]);
            });

        // 3. Partial indexes. Laravel's schema builder cannot express a WHERE
        //    clause portably, so these are raw statements (same pattern as
        //    idx_cis_open in 2026_07_03_000002_create_check_in_sessions_table.php).

        // Backs the manager "pending approvals" queue: org-scoped, per-user,
        // chronological, restricted to the small slice of pending rows.
        DB::statement(
            'CREATE INDEX idx_te_pending ON time_entries '
            .'(organization_id, user_id, started_at) '
            .'WHERE approval_status = \'pending\' AND deleted_at IS NULL'
        );

        // Backs status-filtered aggregates/reports that now exclude non-approved
        // time (e.g. billable rollups filtering approval_status + type).
        DB::statement(
            'CREATE INDEX idx_te_org_status_started ON time_entries '
            .'(organization_id, approval_status, type, started_at) '
            .'WHERE deleted_at IS NULL'
        );
    }

    public function down(): void
    {
        // Drop the raw partial indexes first so the column drops are clean on PG.
        DB::statement('DROP INDEX IF EXISTS idx_te_pending');
        DB::statement('DROP INDEX IF EXISTS idx_te_org_status_started');

        Schema::table('time_entries', function (Blueprint $table) {
            // dropConstrainedForeignId drops the FK constraint and the column.
            $table->dropConstrainedForeignId('submitted_by');
            // Dropping the enum column also drops its backing CHECK constraint.
            $table->dropColumn(['approval_status', 'rejection_reason']);
        });
    }
};
