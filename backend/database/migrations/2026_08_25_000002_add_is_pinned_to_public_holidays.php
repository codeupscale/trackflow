<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('public_holidays', function (Blueprint $table) {
            // Management can PIN one future holiday as the org-wide headline,
            // overriding the default nearest-upcoming pick. At most one row per
            // org is pinned (enforced in the controller inside a transaction).
            $table->boolean('is_pinned')->default(false);
        });
    }

    public function down(): void
    {
        Schema::table('public_holidays', function (Blueprint $table) {
            $table->dropColumn('is_pinned');
        });
    }
};
