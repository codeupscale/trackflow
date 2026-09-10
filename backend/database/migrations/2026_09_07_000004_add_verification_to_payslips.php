<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payslips', function (Blueprint $table) {
            // Per-employee verification. A payroll run produces figures; a
            // human confirms them one payslip at a time, and ONLY a verified
            // payslip is visible to the employee it belongs to.
            //
            // This is deliberately separate from the period-level approval:
            // approving a period is a bulk act on the run, while verification
            // is the check that a specific person's pay is right. Releasing
            // pay figures to staff on a bulk action means nobody ever had to
            // look at an individual payslip before it reached them.
            $table->timestamp('verified_at')->nullable();
            $table->uuid('verified_by')->nullable();

            $table->foreign('verified_by')
                ->references('id')->on('users')
                ->nullOnDelete();

            // Backs the employee-visibility filter (org + user + verified).
            $table->index(['organization_id', 'user_id', 'verified_at'], 'idx_payslips_org_user_verified');
        });

        // Existing payslips that were already approved or paid are treated as
        // verified: they predate this check and are visible to employees
        // today, so leaving them unverified would retroactively hide payslips
        // people have already been shown.
        DB::table('payslips')
            ->whereIn('status', ['approved', 'paid'])
            ->whereNull('verified_at')
            ->update(['verified_at' => DB::raw('COALESCE(updated_at, created_at)')]);
    }

    public function down(): void
    {
        Schema::table('payslips', function (Blueprint $table) {
            $table->dropForeign(['verified_by']);
            $table->dropIndex('idx_payslips_org_user_verified');
            $table->dropColumn(['verified_at', 'verified_by']);
        });
    }
};
