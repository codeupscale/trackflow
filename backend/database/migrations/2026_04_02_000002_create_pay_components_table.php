<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pay_components', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('organization_id');
            $table->string('name');
            $table->string('type'); // allowance, deduction, bonus, tax
            $table->string('calculation_type'); // fixed, percentage
            $table->decimal('value', 12, 4); // amount or percentage
            $table->boolean('is_taxable')->default(false);
            $table->boolean('is_mandatory')->default(false);
            $table->string('applies_to')->default('all'); // all, specific
            $table->timestamps();
            $table->softDeletes();

            $table->foreign('organization_id')
                ->references('id')->on('organizations')
                ->cascadeOnDelete();

            $table->index('organization_id');
            $table->index(['organization_id', 'type']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pay_components');
    }
};
