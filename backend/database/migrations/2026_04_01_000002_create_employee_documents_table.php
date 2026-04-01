<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('employee_documents', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->string('title', 255);
            $table->string('category', 30);
            $table->string('file_path', 500);
            $table->string('file_name', 255);
            $table->integer('file_size');
            $table->string('mime_type', 100);
            $table->date('expiry_date')->nullable();
            $table->boolean('is_verified')->default(false);
            $table->foreignUuid('verified_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('verified_at')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();
            $table->softDeletes();

            // Query-pattern indexes
            $table->index(['organization_id', 'user_id'], 'idx_ed_org_user');
            $table->index(['organization_id', 'category'], 'idx_ed_org_category');
            $table->index('expiry_date', 'idx_ed_expiry_date');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('employee_documents');
    }
};
