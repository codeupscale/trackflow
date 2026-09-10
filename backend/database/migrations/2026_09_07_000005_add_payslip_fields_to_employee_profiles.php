<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employee_profiles', function (Blueprint $table) {
            // How this employee is paid — "Mode of Payment" on a payslip.
            // A property of the person, not of a run: it is the same every
            // month, so asking for it once here beats re-entering it on every
            // payslip.
            $table->string('payment_mode')->nullable();

            // The name the bank account is held in. Usually the employee's own
            // name, which is why the payslip falls back to it — but not always
            // (a joint account, a legal name that differs from the display
            // name), so it is storable.
            //
            // Encrypted like the other bank columns: it is a financial
            // identifier and belongs under the same protection as the account
            // number it sits beside.
            $table->text('bank_account_title')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('employee_profiles', function (Blueprint $table) {
            $table->dropColumn(['payment_mode', 'bank_account_title']);
        });
    }
};
