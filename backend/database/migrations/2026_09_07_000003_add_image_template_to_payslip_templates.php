<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payslip_templates', function (Blueprint $table) {
            // The company's own payslip artwork (JPEG/PNG), used as the full
            // page background under positioned values. Stored inline for the
            // same reason as the logo: dompdf must not depend on the network
            // to render a financial document.
            $table->text('background_image_data_uri')->nullable();
            $table->string('background_image_name')->nullable();

            // Where each value is printed on that artwork:
            // [{ key, x, y, size, align, bold, color }] with x/y as PERCENTAGES
            // of the page, never pixels — the same placement then holds whatever
            // resolution the uploaded image happens to be, and survives someone
            // re-exporting their design at a different size.
            $table->json('field_positions')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('payslip_templates', function (Blueprint $table) {
            $table->dropColumn([
                'background_image_data_uri',
                'background_image_name',
                'field_positions',
            ]);
        });
    }
};
