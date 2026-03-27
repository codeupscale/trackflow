<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('screenshots', function (Blueprint $table) {
            $table->string('thumbnail_key', 512)->nullable()->after('s3_key');
            $table->string('display_key', 512)->nullable()->after('thumbnail_key');
        });
    }

    public function down(): void
    {
        Schema::table('screenshots', function (Blueprint $table) {
            $table->dropColumn(['thumbnail_key', 'display_key']);
        });
    }
};
