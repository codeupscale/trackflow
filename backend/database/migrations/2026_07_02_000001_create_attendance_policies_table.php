<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('attendance_policies', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained('organizations')->cascadeOnDelete();

            // Check-in / checkout window definition
            $table->time('check_in_time')->default('11:30:00');
            $table->time('late_threshold')->default('11:45:00');
            $table->time('checkout_time')->default('20:30:00');
            $table->string('timezone', 64)->default('Asia/Karachi');
            $table->boolean('allow_early_check_in')->default(false);
            $table->boolean('is_active')->default(true);

            $table->timestamps();
            $table->softDeletes();

            // One active policy per organization — the fundamental constraint
            $table->unique('organization_id', 'idx_ap_org_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('attendance_policies');
    }
};
