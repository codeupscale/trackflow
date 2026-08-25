<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('public_holidays', function (Blueprint $table) {
            // Who announced the holiday — shown on the org-wide banner and the
            // Holidays tab. Nullable: rows that predate this column, and rows
            // whose announcer account was later deleted, simply omit the credit.
            $table->foreignUuid('announced_by')
                ->nullable()
                ->constrained('users')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('public_holidays', function (Blueprint $table) {
            $table->dropForeign(['announced_by']);
            $table->dropColumn('announced_by');
        });
    }
};
