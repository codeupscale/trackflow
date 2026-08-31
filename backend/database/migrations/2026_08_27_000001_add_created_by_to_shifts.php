<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Shift ownership, for team-scoped shift management.
 *
 * A team manager may create shifts and edit/delete ONLY the ones they created;
 * org-scoped roles (owner / org_manager / hr_manager) still manage every shift.
 * Nullable because every pre-existing shift was created org-side and has no
 * owner — those stay editable by org-scoped roles only, which is the safe default.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('shifts', function (Blueprint $table) {
            $table->foreignUuid('created_by')
                ->nullable()
                ->after('organization_id')
                ->constrained('users')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('shifts', function (Blueprint $table) {
            $table->dropConstrainedForeignId('created_by');
        });
    }
};
