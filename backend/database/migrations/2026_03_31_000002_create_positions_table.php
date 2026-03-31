<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('positions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('department_id')->constrained()->cascadeOnDelete();
            $table->string('title', 255);
            $table->string('code', 50);
            $table->string('level', 20);           // junior, mid, senior, lead, manager, director, vp, c_level
            $table->string('employment_type', 20);  // full_time, part_time, contract, intern
            $table->text('min_salary')->nullable();  // encrypted cast in model
            $table->text('max_salary')->nullable();  // encrypted cast in model
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['organization_id', 'code']);
            $table->index(['organization_id', 'department_id']);
            $table->index(['organization_id', 'level']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('positions');
    }
};
