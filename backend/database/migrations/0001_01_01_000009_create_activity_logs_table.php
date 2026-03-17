<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('activity_logs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignUuid('time_entry_id')->constrained('time_entries')->cascadeOnDelete();
            $table->timestamp('logged_at');
            $table->integer('keyboard_events')->default(0);
            $table->integer('mouse_events')->default(0);
            $table->string('active_app', 255)->nullable();
            $table->string('active_window_title', 512)->nullable();
            $table->string('active_url', 1024)->nullable();

            $table->index(['organization_id', 'logged_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('activity_logs');
    }
};
