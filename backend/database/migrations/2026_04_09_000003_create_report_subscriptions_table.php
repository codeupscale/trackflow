<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('report_subscriptions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('organization_id');
            $table->uuid('user_id');
            $table->string('report_type', 50);
            $table->boolean('is_active')->default(true);
            $table->tinyInteger('day_of_week')->nullable();
            $table->time('send_time')->default('08:00:00');
            $table->string('timezone', 100)->default('UTC');
            $table->timestamp('last_sent_at')->nullable();
            $table->timestamps();

            $table->foreign('organization_id')->references('id')->on('organizations')->cascadeOnDelete();
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();

            $table->index('organization_id');
            $table->index('user_id');
            $table->unique(['organization_id', 'user_id', 'report_type'], 'report_sub_org_user_type_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('report_subscriptions');
    }
};
