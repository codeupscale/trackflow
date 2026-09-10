<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Record a withdrawal instead of erasing the verification.
 *
 * Withdrawing used to null out `verified_at` and `verified_by`, which left no
 * trace that a payslip had ever been checked, by whom, or that anyone had since
 * taken it back. On a financial document that is the wrong direction: the
 * history is the point.
 *
 * Visibility to the employee is now "verified AND not withdrawn", so both facts
 * survive and the sequence can be read.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payslips', function (Blueprint $table) {
            $table->timestamp('withdrawn_at')->nullable()->after('verified_by');
            $table->foreignUuid('withdrawn_by')->nullable()->after('withdrawn_at')
                ->constrained('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('payslips', function (Blueprint $table) {
            $table->dropConstrainedForeignId('withdrawn_by');
            $table->dropColumn('withdrawn_at');
        });
    }
};
