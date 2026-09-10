<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Who ran this payroll.
 *
 * `processed_at` recorded WHEN a run happened and `approved_by` recorded who
 * signed it off, but nothing recorded who started it — so a period showed a
 * timestamp with no name against it, and a second payroll-capable person could
 * re-run someone else's work without either of them knowing.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payroll_periods', function (Blueprint $table) {
            $table->foreignUuid('processed_by')->nullable()->after('processed_at')
                ->constrained('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('payroll_periods', function (Blueprint $table) {
            $table->dropConstrainedForeignId('processed_by');
        });
    }
};
