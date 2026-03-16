<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('organizations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('name', 255);
            $table->string('slug', 100)->unique();
            $table->enum('plan', ['trial', 'starter', 'pro', 'enterprise'])->default('trial');
            $table->string('stripe_customer_id', 255)->nullable();
            $table->string('stripe_subscription_id', 255)->nullable();
            $table->timestamp('trial_ends_at')->nullable();
            $table->json('settings')->default('{}');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('organizations');
    }
};
