<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employee_profiles', function (Blueprint $table) {
            $table->unsignedSmallInteger('notice_period_days')->nullable()->after('probation_end_date');
            $table->string('work_location', 255)->nullable()->after('notice_period_days');
        });
    }

    public function down(): void
    {
        Schema::table('employee_profiles', function (Blueprint $table) {
            $table->dropColumn(['notice_period_days', 'work_location']);
        });
    }
};
