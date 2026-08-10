<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Salary belongs on a job posting, not on a position.
 *
 * A position is a role definition; a posting is a specific advert with its own
 * pay range at a point in time. Keeping a band on the position duplicated that
 * with no consumer — nothing read positions.min_salary/max_salary except the
 * Position CRUD that wrote them. Real compensation lives in the payroll tables
 * (salary_structures, employee_salary_assignments).
 *
 * IRREVERSIBLE DATA LOSS: both columns are `encrypted` casts. down() restores
 * the columns but cannot restore their contents.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('positions', function (Blueprint $table) {
            $table->dropColumn(['min_salary', 'max_salary']);
        });
    }

    public function down(): void
    {
        Schema::table('positions', function (Blueprint $table) {
            $table->text('min_salary')->nullable();
            $table->text('max_salary')->nullable();
        });
    }
};
