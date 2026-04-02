<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payroll_periods', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('organization_id');
            $table->string('name');
            $table->string('period_type'); // monthly, bi-weekly, weekly
            $table->date('start_date');
            $table->date('end_date');
            $table->string('status')->default('draft'); // draft, processing, approved, paid
            $table->timestamp('processed_at')->nullable();
            $table->uuid('approved_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->foreign('organization_id')
                ->references('id')->on('organizations')
                ->cascadeOnDelete();

            $table->foreign('approved_by')
                ->references('id')->on('users')
                ->nullOnDelete();

            $table->index('organization_id');
            $table->index(['organization_id', 'status']);
            $table->index(['organization_id', 'start_date', 'end_date'], 'pp_org_dates_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payroll_periods');
    }
};
