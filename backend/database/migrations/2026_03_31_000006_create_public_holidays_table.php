<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('public_holidays', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name', 255);
            $table->date('date');
            $table->boolean('is_recurring')->default(false);
            $table->timestamps();

            $table->unique(['organization_id', 'date', 'name'], 'public_holidays_org_date_name_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('public_holidays');
    }
};
