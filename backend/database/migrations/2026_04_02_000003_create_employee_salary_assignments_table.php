<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('employee_salary_assignments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('organization_id');
            $table->uuid('user_id');
            $table->uuid('salary_structure_id');
            $table->text('custom_base_salary')->nullable(); // AES-256-GCM encrypted
            $table->date('effective_from');
            $table->date('effective_to')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->foreign('organization_id')
                ->references('id')->on('organizations')
                ->cascadeOnDelete();

            $table->foreign('user_id')
                ->references('id')->on('users')
                ->cascadeOnDelete();

            $table->foreign('salary_structure_id')
                ->references('id')->on('salary_structures')
                ->cascadeOnDelete();

            $table->index('organization_id');
            $table->index(['organization_id', 'user_id']);
            $table->index(['user_id', 'effective_from', 'effective_to'], 'esa_user_effective_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('employee_salary_assignments');
    }
};
