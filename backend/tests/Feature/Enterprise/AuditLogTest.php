<?php

namespace Tests\Feature\Enterprise;

use App\Models\AuditLog;
use App\Models\Organization;
use App\Models\User;
use App\Services\AuditService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

class AuditLogTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        // Bypass the auth rate limiter (10/min) so login-related tests in this
        // class are not affected by rate limit counts from earlier test classes.
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    public function test_login_creates_audit_log(): void
    {
        $org = Organization::factory()->create();
        $user = User::factory()->create([
            'organization_id' => $org->id,
            'password' => 'password123',
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
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'org_manager');

        AuditService::log('test.action', $admin, ['key' => 'value'], $admin);

        $response = $this->actingAs($admin)->getJson('/api/v1/audit-logs');
        $response->assertStatus(200);
    }

    public function test_audit_logs_scoped_to_organization(): void
    {
        $orgA = $this->createOrganization();
        $orgB = $this->createOrganization();
        $adminA = $this->createUser($orgA, 'org_manager');
        $adminB = $this->createUser($orgB, 'org_manager');

        AuditService::log('action.a', $adminA, [], $adminA);
        AuditService::log('action.b', $adminB, [], $adminB);

        $response = $this->actingAs($adminA)->getJson('/api/v1/audit-logs');
        $response->assertStatus(200);

        $actions = collect($response->json('data'))->pluck('action');
        $this->assertContains('action.a', $actions->toArray());
        $this->assertNotContains('action.b', $actions->toArray());
    }
}
