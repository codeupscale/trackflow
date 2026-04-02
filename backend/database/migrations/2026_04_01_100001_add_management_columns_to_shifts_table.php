<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('shifts', function (Blueprint $table) {
            $table->boolean('is_active')->default(true)->after('days_of_week');
            $table->smallInteger('break_minutes')->unsigned()->default(0)->after('is_active');
            $table->string('color', 7)->default('#3B82F6')->after('break_minutes');
            $table->string('timezone', 64)->default('UTC')->after('color');
            $table->smallInteger('grace_period_minutes')->unsigned()->default(0)->after('timezone');
            $table->text('description')->nullable()->after('grace_period_minutes');
            $table->softDeletes();

            // Composite index: org-scoped active shift lookups
            $table->index(['organization_id', 'is_active'], 'idx_shifts_org_active');
        });
    }

    public function down(): void
    {
        Schema::table('shifts', function (Blueprint $table) {
            $table->dropIndex('idx_shifts_org_active');
            $table->dropSoftDeletes();
            $table->dropColumn([
                'is_active',
                'break_minutes',
                'color',
                'timezone',
                'grace_period_minutes',
                'description',
            ]);
        });
    }
};
