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
            DB::statement('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check');
            DB::statement("ALTER TABLE users ALTER COLUMN role DROP DEFAULT");
            DB::statement("ALTER TABLE users ALTER COLUMN role TYPE varchar(50) USING role::text");
            DB::statement("ALTER TABLE users ALTER COLUMN role SET DEFAULT 'employee'");
        } elseif ($driver === 'mysql') {
            DB::statement("ALTER TABLE users MODIFY role VARCHAR(50) NOT NULL DEFAULT 'employee'");
        } else {
            Schema::table('users', function (Blueprint $table) {
                $table->string('role', 50)->default('employee')->change();
            });
        }
    }

    public function down(): void
    {
        // Reverting this migration is not supported because custom role values
        // may already be present in the users table.
    }
};
