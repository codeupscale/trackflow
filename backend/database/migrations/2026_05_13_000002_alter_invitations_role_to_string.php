<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $driver = Schema::getConnection()->getDriverName();

        if ($driver === 'pgsql') {
            DB::statement('ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_role_check');
            DB::statement("ALTER TABLE invitations ALTER COLUMN role DROP DEFAULT");
            DB::statement("ALTER TABLE invitations ALTER COLUMN role TYPE varchar(50) USING role::text");
            DB::statement("ALTER TABLE invitations ALTER COLUMN role SET DEFAULT 'employee'");
        } elseif ($driver === 'mysql') {
            DB::statement("ALTER TABLE invitations MODIFY role VARCHAR(50) NOT NULL DEFAULT 'employee'");
        } else {
            Schema::table('invitations', function (Blueprint $table) {
                $table->string('role', 50)->default('employee');
            });
        }
    }

    public function down(): void
    {
        // Reverting this migration is not supported because custom role values
        // may already be present in the invitations table.
    }
};
