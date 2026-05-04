<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('screenshots', function (Blueprint $table) {
            $table->string('idempotency_key', 64)->nullable()->unique()->after('display_key');
            $table->foreignUuid('project_id')->nullable()->constrained('projects')->nullOnDelete()->after('time_entry_id');
            $table->string('status', 20)->default('confirmed')->after('project_id');
            $table->smallInteger('display_index')->nullable()->after('window_title');
            $table->smallInteger('display_count')->nullable()->after('display_index');
        });

        // Partial index for queue workers to efficiently find unprocessed screenshots.
        // PostgreSQL only — SQLite (used in CI) doesn't support partial indexes.
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement(
                "CREATE INDEX idx_screenshots_pending_processing ON screenshots (id) " .
                "WHERE processed_at IS NULL AND deleted_at IS NULL AND status = 'confirmed'"
            );
        }
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP INDEX IF EXISTS idx_screenshots_pending_processing');
        }

        Schema::table('screenshots', function (Blueprint $table) {
            $table->dropForeign(['project_id']);
            $table->dropIndex(['idempotency_key']);
            $table->dropColumn(['idempotency_key', 'project_id', 'status', 'display_index', 'display_count']);
        });
    }
};
