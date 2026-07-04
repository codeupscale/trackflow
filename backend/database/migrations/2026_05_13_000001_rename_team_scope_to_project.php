<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Drop the old check constraint, update data, add new constraint
        if (Schema::getConnection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE role_permissions DROP CONSTRAINT IF EXISTS chk_scope');
        }

        DB::table('role_permissions')
            ->where('scope', 'team')
            ->update(['scope' => 'project']);

        if (Schema::getConnection()->getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE role_permissions ADD CONSTRAINT chk_scope CHECK (scope IN ('own', 'project', 'organization', 'none'))");
        }
    }

    public function down(): void
    {
        if (Schema::getConnection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE role_permissions DROP CONSTRAINT IF EXISTS chk_scope');
        }

        DB::table('role_permissions')
            ->where('scope', 'project')
            ->update(['scope' => 'team']);

        if (Schema::getConnection()->getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE role_permissions ADD CONSTRAINT chk_scope CHECK (scope IN ('own', 'team', 'organization', 'none'))");
        }
    }
};
