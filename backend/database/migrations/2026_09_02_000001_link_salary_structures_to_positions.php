<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Salary grades belong to a position, and carry a band.
 *
 * A POSITION is the job ("Software Engineer"); a GRADE is a level within it
 * ("Engineer L1"). Modelling levels as separate positions would make a
 * promotion look like a job change and multiply the position list.
 *
 * position_id is NULLABLE on purpose. Organizations migrate employees before
 * they finish configuring positions, so an unlinked grade must remain usable —
 * the UI degrades to "all grades" rather than blocking assignment.
 *
 * min_salary / max_salary are the approved band. They WARN, they do not block:
 * real exceptions exist (retention, market, negotiation) and a hard block only
 * pushes HR into editing the band instead, which destroys the signal.
 *
 * base_salary keeps its meaning as the amount actually paid; with a band
 * present it is the suggested midpoint.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('salary_structures', function (Blueprint $table) {
            $table->foreignUuid('position_id')
                ->nullable()
                ->after('organization_id')
                ->constrained('positions')
                // A deleted position must not take its grades — and the salary
                // assignments pointing at them — with it.
                ->nullOnDelete();

            $table->decimal('min_salary', 12, 2)->nullable()->after('base_salary');
            $table->decimal('max_salary', 12, 2)->nullable()->after('min_salary');

            $table->index(['organization_id', 'position_id'], 'idx_salary_structures_org_position');
        });
    }

    public function down(): void
    {
        Schema::table('salary_structures', function (Blueprint $table) {
            $table->dropIndex('idx_salary_structures_org_position');
            $table->dropConstrainedForeignId('position_id');
            $table->dropColumn(['min_salary', 'max_salary']);
        });
    }
};
