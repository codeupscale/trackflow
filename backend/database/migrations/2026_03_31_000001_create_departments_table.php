<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('departments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name', 255);
            $table->string('code', 50);
            $table->text('description')->nullable();
            $table->uuid('parent_department_id')->nullable();
            $table->foreignUuid('manager_id')->nullable()->constrained('users')->nullOnDelete();
            $table->integer('head_count')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['organization_id', 'code']);
            $table->index(['organization_id', 'parent_department_id']);
            $table->index(['organization_id', 'is_active']);
        });

        // Self-referential FK must be added after table exists
        Schema::table('departments', function (Blueprint $table) {
            $table->foreign('parent_department_id')->references('id')->on('departments')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('departments');
    }
};
