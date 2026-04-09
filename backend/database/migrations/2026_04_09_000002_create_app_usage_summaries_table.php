<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('app_usage_summaries', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('organization_id');
            $table->uuid('user_id');
            $table->date('date');
            $table->string('app_name', 255);
            $table->string('window_title', 500)->nullable();
            $table->integer('duration_seconds')->default(0);
            $table->boolean('is_productive')->nullable();
            $table->timestamps();

            $table->foreign('organization_id')->references('id')->on('organizations')->cascadeOnDelete();
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();

            $table->index('organization_id');
            $table->index('user_id');
            $table->index('date');
            $table->unique(['organization_id', 'user_id', 'date', 'app_name'], 'app_usage_org_user_date_app_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('app_usage_summaries');
    }
};
