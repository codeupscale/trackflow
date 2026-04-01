<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        DB::transaction(function () {
            // ---------------------------------------------------------------
            // Step 1: Drop old tables that used the string-based role system
            // ---------------------------------------------------------------
            Schema::dropIfExists('user_permission_overrides');
            Schema::dropIfExists('role_permissions');

            // ---------------------------------------------------------------
            // Step 2: Alter permissions table — rename columns, add new ones
            // ---------------------------------------------------------------
            Schema::table('permissions', function (Blueprint $table) {
                $table->renameColumn('name', 'key');
            });

            Schema::table('permissions', function (Blueprint $table) {
                $table->renameColumn('group', 'module');
            });

            // Add new columns after renames are committed
            Schema::table('permissions', function (Blueprint $table) {
                $table->string('action', 30)->default('')->after('module');
                $table->boolean('has_scope')->default(false)->after('description');
            });

            // Make description NOT NULL with default
            DB::statement("ALTER TABLE permissions ALTER COLUMN description SET NOT NULL");
            DB::statement("ALTER TABLE permissions ALTER COLUMN description SET DEFAULT ''");

            // ---------------------------------------------------------------
            // Step 3: Create roles table
            // ---------------------------------------------------------------
            Schema::create('roles', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
                $table->string('name', 50);
                $table->string('display_name', 100);
                $table->string('description', 255)->nullable();
                $table->boolean('is_system')->default(false);
                $table->boolean('is_default')->default(false);
                $table->smallInteger('priority')->default(0);
                $table->timestampsTz();

                $table->unique(['organization_id', 'name'], 'uq_roles_org_name');
                $table->index(['organization_id'], 'idx_roles_org');
            });

            // ---------------------------------------------------------------
            // Step 4: Create role_permissions table (new schema with scope)
            // ---------------------------------------------------------------
            Schema::create('role_permissions', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->foreignUuid('role_id')->constrained()->cascadeOnDelete();
                $table->foreignUuid('permission_id')->constrained()->cascadeOnDelete();
                $table->string('scope', 15)->default('own');
                $table->timestampTz('created_at')->useCurrent();

                $table->unique(['role_id', 'permission_id'], 'uq_role_perm');
                $table->index(['role_id'], 'idx_role_permissions_role');
                $table->index(['permission_id'], 'idx_role_permissions_perm');
            });

            // Add check constraint for scope values
            DB::statement("ALTER TABLE role_permissions ADD CONSTRAINT chk_scope CHECK (scope IN ('own', 'team', 'organization', 'none'))");

            // ---------------------------------------------------------------
            // Step 5: Create user_roles table
            // ---------------------------------------------------------------
            Schema::create('user_roles', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
                $table->foreignUuid('role_id')->constrained()->cascadeOnDelete();
                $table->foreignUuid('assigned_by')->nullable()->constrained('users');
                $table->timestampTz('assigned_at')->useCurrent();

                $table->unique(['user_id', 'role_id'], 'uq_user_role');
                $table->index(['user_id'], 'idx_user_roles_user');
                $table->index(['role_id'], 'idx_user_roles_role');
            });

            // ---------------------------------------------------------------
            // Step 6: Data migration — create system roles per org,
            //         assign users to roles based on users.role column
            // ---------------------------------------------------------------
            $systemRoles = [
                ['name' => 'owner',    'display_name' => 'Owner',    'priority' => 100],
                ['name' => 'admin',    'display_name' => 'Admin',    'priority' => 75],
                ['name' => 'manager',  'display_name' => 'Manager',  'priority' => 50],
                ['name' => 'employee', 'display_name' => 'Employee', 'priority' => 10],
            ];

            $now = now();

            // Get all organizations
            $organizations = DB::table('organizations')->select('id')->get();

            foreach ($organizations as $org) {
                // Create 4 system roles for each organization
                foreach ($systemRoles as $roleDef) {
                    DB::table('roles')->insert([
                        'id' => DB::raw('gen_random_uuid()'),
                        'organization_id' => $org->id,
                        'name' => $roleDef['name'],
                        'display_name' => $roleDef['display_name'],
                        'is_system' => true,
                        'is_default' => $roleDef['name'] === 'employee',
                        'priority' => $roleDef['priority'],
                        'created_at' => $now,
                        'updated_at' => $now,
                    ]);
                }

                // Assign each user to their matching system role
                $users = DB::table('users')
                    ->where('organization_id', $org->id)
                    ->whereNull('deleted_at')
                    ->select('id', 'role')
                    ->get();

                foreach ($users as $user) {
                    $roleName = $user->role ?? 'employee';

                    $role = DB::table('roles')
                        ->where('organization_id', $org->id)
                        ->where('name', $roleName)
                        ->first();

                    if ($role) {
                        DB::table('user_roles')->insert([
                            'id' => DB::raw('gen_random_uuid()'),
                            'user_id' => $user->id,
                            'role_id' => $role->id,
                            'assigned_by' => null,
                            'assigned_at' => $now,
                        ]);
                    }
                }
            }
        });
    }

    public function down(): void
    {
        DB::transaction(function () {
            // Drop new tables in reverse dependency order
            Schema::dropIfExists('user_roles');
            Schema::dropIfExists('role_permissions');
            Schema::dropIfExists('roles');

            // Revert permissions table alterations
            Schema::table('permissions', function (Blueprint $table) {
                $table->dropColumn(['action', 'has_scope']);
            });

            DB::statement("ALTER TABLE permissions ALTER COLUMN description DROP NOT NULL");
            DB::statement("ALTER TABLE permissions ALTER COLUMN description DROP DEFAULT");

            Schema::table('permissions', function (Blueprint $table) {
                $table->renameColumn('key', 'name');
            });

            Schema::table('permissions', function (Blueprint $table) {
                $table->renameColumn('module', 'group');
            });

            // Recreate old role_permissions table (string-based role)
            Schema::create('role_permissions', function (Blueprint $table) {
                $table->string('role', 20);
                $table->foreignUuid('permission_id')->constrained()->cascadeOnDelete();
                $table->primary(['role', 'permission_id']);
            });

            // Recreate old user_permission_overrides table
            Schema::create('user_permission_overrides', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
                $table->foreignUuid('permission_id')->constrained()->cascadeOnDelete();
                $table->boolean('granted')->default(true);
                $table->unique(['user_id', 'permission_id']);
            });
        });
    }
};
