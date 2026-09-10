<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * When the payroll was actually paid out.
 *
 * The 'paid' status existed but was unreachable — nothing ever set it — so an
 * approved period stayed approved forever and "have we paid this?" had no
 * answer. `processed_at` records the run and `approved_by` the sign-off; this
 * completes the trail.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payroll_periods', function (Blueprint $table) {
            $table->timestamp('paid_at')->nullable()->after('processed_at');
        });
    }

    public function down(): void
    {
        Schema::table('payroll_periods', function (Blueprint $table) {
            $table->dropColumn('paid_at');
        });
    }
};
