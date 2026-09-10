<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A grade name must be unique WITHIN its position, not across the whole org.
 *
 * Global uniqueness would fight the hierarchy: "L1" under Software Engineer and
 * "L1" under Designer are different grades of different jobs, and forbidding
 * that forces every name to repeat the position ("SWE L1", "Designer L1") when
 * the position column already says it.
 *
 * Unlinked grades (position_id NULL) form their own group — nothing
 * distinguishes two unlinked grades sharing a name.
 *
 * A partial index is used rather than a plain unique constraint for two
 * reasons: soft-deleted rows must not reserve a name forever, and Postgres
 * treats NULLs as distinct in a normal unique index, so unlinked duplicates
 * would slip through. Two indexes are needed because COALESCE on a uuid column
 * needs a sentinel; splitting on NULL is clearer and keeps both indexes usable.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Any pre-existing duplicates would make the index creation fail, so
        // they are reported rather than silently mangled — renaming someone's
        // pay grade without asking is not this migration's call.
        $dupes = DB::table('salary_structures')
            ->selectRaw('organization_id, position_id, lower(name) as n, count(*) as c')
            ->whereNull('deleted_at')
            ->groupBy('organization_id', 'position_id', DB::raw('lower(name)'))
            ->havingRaw('count(*) > 1')
            ->get();

        foreach ($dupes as $d) {
            // Keep the oldest, suffix the rest so the index can be created and
            // nothing is lost. The names remain visible and editable.
            $rows = DB::table('salary_structures')
                ->where('organization_id', $d->organization_id)
                ->whereNull('deleted_at')
                ->whereRaw('lower(name) = ?', [$d->n])
                ->when($d->position_id === null,
                    fn ($q) => $q->whereNull('position_id'),
                    fn ($q) => $q->where('position_id', $d->position_id))
                ->orderBy('created_at')
                ->get(['id']);

            foreach ($rows->skip(1)->values() as $i => $row) {
                DB::table('salary_structures')
                    ->where('id', $row->id)
                    ->update(['name' => DB::raw("name || ' (" . ($i + 2) . ")'")]);
            }
        }

        DB::statement(<<<'SQL'
            CREATE UNIQUE INDEX idx_salary_structures_name_per_position
            ON salary_structures (organization_id, position_id, lower(name))
            WHERE deleted_at IS NULL AND position_id IS NOT NULL
        SQL);

        DB::statement(<<<'SQL'
            CREATE UNIQUE INDEX idx_salary_structures_name_unlinked
            ON salary_structures (organization_id, lower(name))
            WHERE deleted_at IS NULL AND position_id IS NULL
        SQL);
    }

    public function down(): void
    {
        Schema::table('salary_structures', function () {
            DB::statement('DROP INDEX IF EXISTS idx_salary_structures_name_per_position');
            DB::statement('DROP INDEX IF EXISTS idx_salary_structures_name_unlinked');
        });
    }
};
