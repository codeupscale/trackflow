<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Audit Logs
        Schema::create('audit_logs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('action', 100)->index();
            $table->string('resource_type', 100)->nullable();
            $table->uuid('resource_id')->nullable();
            $table->json('metadata')->nullable();
            $table->ipAddress('ip_address')->nullable();
            $table->string('user_agent', 500)->nullable();
            $table->timestamp('created_at')->useCurrent()->index();
        });

        // Permissions
        Schema::create('permissions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('name', 100)->unique();
            $table->string('group', 50)->index();
            $table->string('description', 255)->nullable();
        });

        // Role-Permission pivot
        Schema::create('role_permissions', function (Blueprint $table) {
            $table->string('role', 20);
            $table->foreignUuid('permission_id')->constrained()->cascadeOnDelete();
            $table->primary(['role', 'permission_id']);
        });

        // Per-user permission overrides
        Schema::create('user_permission_overrides', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('permission_id')->constrained()->cascadeOnDelete();
            $table->boolean('granted')->default(true);
            $table->unique(['user_id', 'permission_id']);
        });

        // SSO fields on organizations
        Schema::table('organizations', function (Blueprint $table) {
            $table->json('sso_config')->nullable()->after('settings');
            $table->boolean('enforce_sso')->default(false)->after('sso_config');
            $table->json('data_retention_config')->nullable()->after('enforce_sso');
        });

        // SSO fields on users
        Schema::table('users', function (Blueprint $table) {
            $table->string('sso_provider', 50)->nullable()->after('settings');
            $table->string('sso_provider_id', 255)->nullable()->after('sso_provider');
            $table->timestamp('consent_given_at')->nullable()->after('sso_provider_id');
            $table->string('privacy_policy_version', 20)->nullable()->after('consent_given_at');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['sso_provider', 'sso_provider_id', 'consent_given_at', 'privacy_policy_version']);
        });

        Schema::table('organizations', function (Blueprint $table) {
            $table->dropColumn(['sso_config', 'enforce_sso', 'data_retention_config']);
        });

        Schema::dropIfExists('user_permission_overrides');
        Schema::dropIfExists('role_permissions');
        Schema::dropIfExists('permissions');
        Schema::dropIfExists('audit_logs');
    }
};
