<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('job_postings', function (Blueprint $table) {
            // Rich text authored in trackflow and rendered on the careers page.
            // Stored as sanitised HTML (see JobDescriptionSanitizer) — `text`
            // rather than a bounded string, because a full job ad with markup
            // runs well past varchar territory.
            $table->text('long_description')->nullable()->after('short_description');
        });
    }

    public function down(): void
    {
        Schema::table('job_postings', function (Blueprint $table) {
            $table->dropColumn('long_description');
        });
    }
};
