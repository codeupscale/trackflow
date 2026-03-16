<?php

namespace Tests\Feature\Enterprise;

use App\Models\AuditLog;
use App\Models\Organization;
use App\Models\User;
use App\Services\AuditService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AuditLogTest extends TestCase
{
    use RefreshDatabase;

    public function test_login_creates_audit_log(): void
    {
        $org = Organization::factory()->create();
        $user = User::factory()->create([
            'organization_id' => $org->id,
            'password' => Hash::make('password123'),
        ]);

        $this->postJson('/api/v1/auth/login', [
            'email' => $user->email,
            'password' => 'password123',
        ]);

        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $user->id,
            'action' => 'auth.login',
        ]);
    }

    public function test_failed_login_creates_audit_log(): void
    {
        $org = Organization::factory()->create();
        $user = User::factory()->create([
            'organization_id' => $org->id,
        ]);

        $this->postJson('/api/v1/auth/login', [
            'email' => $user->email,
            'password' => 'wrong-password',
        ]);

        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $user->id,
            'action' => 'auth.login_failed',
        ]);
    }

    public function test_audit_log_api_requires_admin(): void
    {
        $org = Organization::factory()->create();
        $employee = User::factory()->create([
            'organization_id' => $org->id,
            'role' => 'employee',
        ]);

        $response = $this->actingAs($employee)->getJson('/api/v1/audit-logs');
        $response->assertStatus(403);
    }

    public function test_admin_can_view_audit_logs(): void
    {
        $org = Organization::factory()->create();
        $admin = User::factory()->create([
            'organization_id' => $org->id,
            'role' => 'admin',
        ]);

        AuditService::log('test.action', $admin, ['key' => 'value'], $admin);

        $response = $this->actingAs($admin)->getJson('/api/v1/audit-logs');
        $response->assertStatus(200);
    }

    public function test_audit_logs_scoped_to_organization(): void
    {
        $orgA = Organization::factory()->create();
        $orgB = Organization::factory()->create();
        $adminA = User::factory()->create(['organization_id' => $orgA->id, 'role' => 'admin']);
        $adminB = User::factory()->create(['organization_id' => $orgB->id, 'role' => 'admin']);

        AuditService::log('action.a', $adminA, [], $adminA);
        AuditService::log('action.b', $adminB, [], $adminB);

        $response = $this->actingAs($adminA)->getJson('/api/v1/audit-logs');
        $response->assertStatus(200);

        $actions = collect($response->json('data'))->pluck('action');
        $this->assertContains('action.a', $actions->toArray());
        $this->assertNotContains('action.b', $actions->toArray());
    }
}
