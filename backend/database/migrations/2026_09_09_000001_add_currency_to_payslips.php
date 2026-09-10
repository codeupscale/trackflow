<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Stamp each payslip with the currency it was produced in.
 *
 * A payslip is a record of money that actually moved. When an organization
 * switches currency the stored amounts are converted forward, but a payslip
 * already approved or paid must keep reading as what was paid — so it carries
 * its own code rather than inheriting whatever the org is set to today.
 *
 * NULLABLE on purpose: every existing row predates the switch and belongs to
 * the org's current currency, which is exactly what a null falls back to. A
 * backfill would write today's answer onto history and claim it was always so.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payslips', function (Blueprint $table) {
            $table->string('currency', 3)->nullable()->after('net_salary');
        });
    }

    public function down(): void
    {
        Schema::table('payslips', function (Blueprint $table) {
            $table->dropColumn('currency');
        });
    }
};
