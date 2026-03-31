<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('leave_types', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name', 100);
            $table->string('code', 20);
            $table->boolean('is_paid')->default(true);
            $table->decimal('days_per_year', 5, 1);
            $table->string('accrual_type', 20)->default('upfront'); // upfront, monthly, anniversary
            $table->decimal('carryover_days', 5, 1)->default(0);
            $table->integer('max_consecutive_days')->nullable();
            $table->boolean('requires_document')->default(false);
            $table->boolean('requires_approval')->default(true);
            $table->string('applicable_genders', 10)->default('all'); // all, male, female
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['organization_id', 'code']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('leave_types');
    }
};
