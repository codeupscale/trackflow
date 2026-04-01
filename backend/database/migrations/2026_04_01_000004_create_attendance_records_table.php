<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('attendance_records', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();
            $table->date('date');
            $table->foreignUuid('shift_id')->nullable()->constrained('shifts')->nullOnDelete();
            $table->time('expected_start')->nullable();
            $table->time('expected_end')->nullable();
            $table->time('first_seen')->nullable();
            $table->time('last_seen')->nullable();
            $table->decimal('total_hours', 5, 2)->default(0);
            $table->string('status', 20)->default('absent');
            $table->integer('late_minutes')->default(0);
            $table->integer('early_departure_minutes')->default(0);
            $table->integer('overtime_minutes')->default(0);
            $table->boolean('is_regularized')->default(false);
            $table->text('regularization_note')->nullable();
            $table->timestamps();
            $table->softDeletes();

            // One record per user per day per org — the fundamental constraint
            $table->unique(['organization_id', 'user_id', 'date'], 'idx_ar_org_user_date_unique');

            // Team/manager views: "show me everyone's attendance for this week"
            $table->index(['organization_id', 'date'], 'idx_ar_org_date');

            // Status reporting: "how many absences does this user have?"
            $table->index(['organization_id', 'user_id', 'status'], 'idx_ar_org_user_status');

            // Attendance summary: "how many people were absent on Monday?"
            $table->index(['organization_id', 'status', 'date'], 'idx_ar_org_status_date');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('attendance_records');
    }
};
