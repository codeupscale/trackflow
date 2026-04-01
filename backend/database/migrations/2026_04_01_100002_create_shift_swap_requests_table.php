<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('shift_swap_requests', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->foreignUuid('requester_id')->constrained('users')->cascadeOnDelete();
            $table->foreignUuid('target_user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignUuid('requester_shift_id')->constrained('shifts')->cascadeOnDelete();
            $table->foreignUuid('target_shift_id')->constrained('shifts')->cascadeOnDelete();
            $table->date('swap_date');
            $table->text('reason')->nullable();
            $table->string('status', 20)->default('pending');
            $table->foreignUuid('reviewed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('reviewed_at')->nullable();
            $table->text('reviewer_note')->nullable();
            $table->timestamps();
            $table->softDeletes();

            // Manager approval queue: pending swaps for the org
            $table->index(['organization_id', 'status'], 'idx_ssr_org_status');

            // Requester history: "show me my swap requests"
            $table->index(['requester_id', 'status'], 'idx_ssr_requester_status');

            // Target user: "someone wants to swap with me"
            $table->index(['target_user_id', 'status'], 'idx_ssr_target_status');

            // Date lookups: swaps scheduled for a specific date
            $table->index(['swap_date'], 'idx_ssr_swap_date');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shift_swap_requests');
    }
};
