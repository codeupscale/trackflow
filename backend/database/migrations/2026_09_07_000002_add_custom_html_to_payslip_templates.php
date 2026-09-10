<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payslip_templates', function (Blueprint $table) {
            // A company-uploaded design, rendered by the sandboxed placeholder
            // engine in App\Support\PayslipTemplateRenderer — never by Blade.
            // Only used when `layout` is 'custom'; keeping it in its own column
            // means switching back to a built-in layout does not destroy the
            // upload, so an org can always retreat to a working payslip and
            // return to its own design afterwards.
            $table->text('custom_template_html')->nullable();
            $table->string('custom_template_name')->nullable();
            $table->timestamp('custom_template_uploaded_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('payslip_templates', function (Blueprint $table) {
            $table->dropColumn([
                'custom_template_html',
                'custom_template_name',
                'custom_template_uploaded_at',
            ]);
        });
    }
};
