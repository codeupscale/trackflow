<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Promotes check-in/checkout sessions to a child table so a single day's
 * attendance_records row can carry multiple check-in/checkout pairs
 * (multi-session redesign, Module 3.1).
 *
 * v1 stored a single pair directly on attendance_records; those columns remain
 * as the current/latest-session snapshot, and every historical single pair is
 * backfilled here as seq=1. This keeps the migration reversible: dropping the
 * table loses only multi-session history that never existed pre-migration.
 *
 * Indexes:
 *  - idx_cis_org_user_checkin: org-scoped per-user timeline lookups.
 *  - idx_cis_open (partial): "find this user's open session" probe used by
 *    checkout + the stale-session backstop.
 *  - idx_cis_record (partial): fetch all live sessions for a day's record.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('check_in_sessions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('attendance_record_id')->constrained()->cascadeOnDelete();
            $table->smallInteger('seq'); // 1-based per-day sequence
            $table->timestamp('check_in_at'); // UTC, authoritative
            $table->timestamp('check_out_at')->nullable(); // NULL while open
            $table->timestamps();
            $table->softDeletes();

            $table->index(['organization_id', 'user_id', 'check_in_at'], 'idx_cis_org_user_checkin');
        });

        // Partial indexes: Laravel's schema builder cannot express a WHERE clause
        // portably, so these are raw statements.
        DB::statement(
            'CREATE INDEX idx_cis_open ON check_in_sessions '
            .'(organization_id, user_id, check_in_at) '
            .'WHERE check_out_at IS NULL AND deleted_at IS NULL'
        );

        DB::statement(
            'CREATE INDEX idx_cis_record ON check_in_sessions '
            .'(attendance_record_id) '
            .'WHERE deleted_at IS NULL'
        );

        // Backfill existing single-pair check-ins as seq=1 sessions, then set the
        // denormalized sessions_count on the parent rows. gen_random_uuid() is
        // built into PostgreSQL 13+ (Postgres 18 here), no pgcrypto needed.
        DB::statement(<<<'SQL'
            INSERT INTO check_in_sessions (id, organization_id, user_id, attendance_record_id, seq, check_in_at, check_out_at, created_at, updated_at)
            SELECT gen_random_uuid(), organization_id, user_id, id, 1, check_in_at, check_out_at, now(), now()
            FROM attendance_records
            WHERE check_in_at IS NOT NULL AND deleted_at IS NULL
        SQL);

        DB::statement(<<<'SQL'
            UPDATE attendance_records SET sessions_count = 1
            WHERE check_in_at IS NOT NULL AND deleted_at IS NULL
        SQL);
    }

    public function down(): void
    {
        // Drop the raw partial indexes first so the table drop is clean on Postgres.
        DB::statement('DROP INDEX IF EXISTS idx_cis_open');
        DB::statement('DROP INDEX IF EXISTS idx_cis_record');

        Schema::dropIfExists('check_in_sessions');
    }
};
