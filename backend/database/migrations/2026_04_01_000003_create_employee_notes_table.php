<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('employee_notes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('author_id')->constrained('users')->cascadeOnDelete();
            $table->text('content');
            $table->boolean('is_confidential')->default(false);
            $table->timestamps();
            $table->softDeletes();

            // Query-pattern index
            $table->index(['organization_id', 'user_id'], 'idx_en_org_user');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('employee_notes');
    }
};
