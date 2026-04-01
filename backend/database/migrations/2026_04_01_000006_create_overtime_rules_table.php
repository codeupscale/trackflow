<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('overtime_rules', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->decimal('daily_threshold_hours', 4, 2)->default(8.00);
            $table->decimal('weekly_threshold_hours', 5, 2)->default(40.00);
            $table->decimal('overtime_multiplier', 4, 2)->default(1.50);
            $table->decimal('weekend_multiplier', 4, 2)->default(2.00);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->softDeletes();

            // One overtime rule set per org
            $table->unique('organization_id', 'idx_or_org_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('overtime_rules');
    }
};
