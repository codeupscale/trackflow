<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Add idempotency_key to time_entries for deduplicating timer start requests.
 *
 * The desktop agent sends a UUID idempotency key with each timer start call.
 * If the network is flaky and the same request is retried, the server uses
 * this key to return the existing entry instead of creating a duplicate.
 *
 * The unique index is compound (organization_id, idempotency_key) so keys
 * are scoped per org. PostgreSQL unique indexes allow multiple NULLs, so
 * existing rows without a key are unaffected.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('time_entries', function (Blueprint $table) {
            $table->string('idempotency_key', 64)->nullable()->after('notes');
            $table->unique(['organization_id', 'idempotency_key'], 'te_org_idempotency_unique');
        });
    }

    public function down(): void
    {
        Schema::table('time_entries', function (Blueprint $table) {
            $table->dropUnique('te_org_idempotency_unique');
            $table->dropColumn('idempotency_key');
        });
    }
};
