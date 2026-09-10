<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payslip_line_items', function (Blueprint $table) {
            // `type` only says earning or deduction, which cannot answer "how
            // much tax?" or "how much bonus?" — a tax line and a loan
            // repayment are both just deductions. The category names what the
            // line IS, so the payroll listing can total a column per kind.
            $table->string('category')->nullable()->after('type');
            $table->index(['payslip_id', 'category'], 'idx_pli_payslip_category');
        });

        // Backfill from the pay component where one is linked; otherwise fall
        // back to the broad type, so every existing row lands somewhere sane
        // rather than counting as nothing.
        DB::statement("
            UPDATE payslip_line_items AS pli
            SET category = COALESCE(pc.type, CASE WHEN pli.type = 'earning' THEN 'allowance' ELSE 'deduction' END)
            FROM pay_components AS pc
            WHERE pli.pay_component_id = pc.id AND pli.category IS NULL
        ");

        DB::statement("
            UPDATE payslip_line_items
            SET category = CASE WHEN type = 'earning' THEN 'allowance' ELSE 'deduction' END
            WHERE category IS NULL
        ");

        // The base salary line is written by runPayroll with no component, and
        // is not an allowance — name it for what it is.
        DB::statement("
            UPDATE payslip_line_items
            SET category = 'basic'
            WHERE pay_component_id IS NULL AND lower(label) = 'base salary'
        ");
    }

    public function down(): void
    {
        Schema::table('payslip_line_items', function (Blueprint $table) {
            $table->dropIndex('idx_pli_payslip_category');
            $table->dropColumn('category');
        });
    }
};
