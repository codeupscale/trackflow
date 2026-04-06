<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payslip_line_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('payslip_id');
            $table->uuid('pay_component_id')->nullable();
            $table->string('label');
            $table->string('type'); // earning, deduction
            $table->decimal('amount', 12, 2);
            $table->boolean('is_taxable')->default(false);
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();

            $table->foreign('payslip_id')
                ->references('id')->on('payslips')
                ->cascadeOnDelete();

            $table->foreign('pay_component_id')
                ->references('id')->on('pay_components')
                ->nullOnDelete();

            $table->index('payslip_id');
            $table->index(['payslip_id', 'type']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payslip_line_items');
    }
};
