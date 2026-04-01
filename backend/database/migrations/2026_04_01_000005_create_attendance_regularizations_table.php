<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('attendance_regularizations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignUuid('attendance_record_id')->constrained('attendance_records')->cascadeOnDelete();
            $table->string('requested_status', 20);
            $table->text('reason');
            $table->string('status', 20)->default('pending');
            $table->foreignUuid('reviewed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('reviewed_at')->nullable();
            $table->text('review_note')->nullable();
            $table->timestamps();
            $table->softDeletes();

            // Employee's regularization history
            $table->index(['organization_id', 'user_id'], 'idx_areg_org_user');

            // Manager queue: "show me all pending regularizations"
            $table->index(['organization_id', 'status'], 'idx_areg_org_status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('attendance_regularizations');
    }
};
