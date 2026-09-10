<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payslip_templates', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('organization_id');

            // Presentation. `layout` picks one of the shipped Blade partials;
            // everything else is data the partials read, so adding a layout
            // never means adding columns.
            $table->string('layout')->default('classic'); // classic, modern, compact
            $table->string('accent_color', 7)->default('#2563EB');

            // Letterhead. All nullable — an org that configures nothing still
            // gets a correct payslip, falling back to organizations.name.
            $table->string('company_name')->nullable();
            $table->text('company_address')->nullable();
            $table->string('company_registration_no')->nullable();
            $table->text('footer_note')->nullable();

            // The logo is stored inline as a data: URI rather than on S3.
            // dompdf renders it without a network fetch, so a slow or
            // unreachable bucket can never turn a payslip into a broken image,
            // and there is no signed URL to expire mid-render. Capped in
            // validation (see UpdatePayslipTemplateRequest).
            $table->text('logo_data_uri')->nullable();

            // Section toggles.
            $table->boolean('show_payment_details')->default(true);
            $table->boolean('show_employer_contributions')->default(false);
            $table->boolean('show_attendance_summary')->default(false);
            $table->boolean('show_leave_balance')->default(false);
            $table->boolean('show_ytd_totals')->default(false);
            $table->boolean('show_signature_block')->default(false);

            $table->timestamps();

            $table->foreign('organization_id')
                ->references('id')->on('organizations')
                ->cascadeOnDelete();

            // One template per organization. Not soft-deleted: "reset to
            // defaults" restores the column defaults on the existing row, so a
            // deleted-but-present row would only ever be a way to reserve the
            // unique slot and lock the org out of its own settings.
            $table->unique('organization_id', 'uniq_payslip_templates_org');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payslip_templates');
    }
};
