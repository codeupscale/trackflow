<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('employee_profiles', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->string('employee_id', 50)->nullable();
            $table->foreignUuid('department_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('position_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('reporting_manager_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('employment_status', 20)->default('active');
            $table->string('employment_type', 20)->default('full_time');
            $table->date('date_of_joining')->nullable();
            $table->date('date_of_confirmation')->nullable();
            $table->date('date_of_exit')->nullable();
            $table->date('probation_end_date')->nullable();
            $table->string('blood_group', 5)->nullable();
            $table->string('marital_status', 20)->nullable();
            $table->string('nationality', 100)->nullable();
            $table->string('gender', 20)->nullable();
            $table->string('emergency_contact_name', 255)->nullable();
            $table->string('emergency_contact_phone', 50)->nullable();
            $table->string('emergency_contact_relation', 100)->nullable();
            $table->text('bank_name')->nullable();
            $table->text('bank_account_number')->nullable();
            $table->text('bank_routing_number')->nullable();
            $table->text('tax_id')->nullable();
            $table->text('current_address')->nullable();
            $table->text('permanent_address')->nullable();
            $table->timestamps();

            // Unique constraints
            $table->unique(['organization_id', 'user_id'], 'idx_ep_org_user_unique');
            $table->unique(['organization_id', 'employee_id'], 'idx_ep_org_employee_id_unique');

            // Query-pattern indexes
            $table->index(['organization_id', 'department_id'], 'idx_ep_org_department');
            $table->index(['organization_id', 'employment_status'], 'idx_ep_org_status');
            $table->index(['organization_id', 'reporting_manager_id'], 'idx_ep_org_manager');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('employee_profiles');
    }
};
