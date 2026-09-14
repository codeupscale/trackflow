<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Laravel's standard notifications table, with two deliberate departures.
 *
 * uuidMorphs rather than morphs: every id in this schema is a uuid, and the
 * default bigint column silently fails to match a notifiable.
 *
 * organization_id, which the framework's table does not carry. Notifications
 * are addressed to a USER, so tenancy is implied — but every listing, count and
 * cleanup query in this product filters by org, and without the column those
 * queries have to join users to do it. It also means a stray row can never be
 * read across a tenant boundary even if a notifiable id were reused.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('notifications', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('type');
            $table->uuidMorphs('notifiable');
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
            $table->text('data');
            $table->timestamp('read_at')->nullable();
            $table->timestamps();

            // The bell's own query: this user's newest first. Partial on unread
            // because the badge count asks only that question, many times a
            // minute, and it is the one read that must stay cheap.
            $table->index(['notifiable_id', 'created_at'], 'idx_notifications_user_recent');
            $table->index(['organization_id', 'created_at'], 'idx_notifications_org_recent');
        });

        // Partial indexes are not expressible through the Blueprint API.
        DB::statement(
            'CREATE INDEX idx_notifications_unread ON notifications (notifiable_id, created_at DESC) WHERE read_at IS NULL'
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('notifications');
    }
};
