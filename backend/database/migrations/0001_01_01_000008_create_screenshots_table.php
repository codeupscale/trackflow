<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('screenshots', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignUuid('time_entry_id')->constrained('time_entries')->cascadeOnDelete();
            $table->string('s3_key', 512);
            $table->timestamp('captured_at');
            $table->smallInteger('activity_score_at_capture')->nullable();
            $table->boolean('is_blurred')->default(false);
            $table->smallInteger('width');
            $table->smallInteger('height');
            $table->timestamps();
            $table->softDeletes();

            $table->index(['organization_id', 'user_id', 'captured_at']);
            $table->index('time_entry_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('screenshots');
    }
};
