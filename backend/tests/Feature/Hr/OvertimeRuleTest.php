<?php

namespace Tests\Feature\Hr;

use App\Models\OvertimeRule;
use Tests\TestCase;

class OvertimeRuleTest extends TestCase
{
    // ── Show (Get or Create Defaults) ───────────────────

    public function test_get_overtime_rules_creates_defaults_when_none_exist(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        // No OvertimeRule exists yet
        $this->assertDatabaseMissing('overtime_rules', [
            'organization_id' => $org->id,
        ]);

        $response = $this->getJson('/api/v1/hr/overtime-rules');

        $response->assertOk()
            ->assertJsonStructure([
                'data' => [
                    'daily_threshold_hours',
                    'weekly_threshold_hours',
                    'overtime_multiplier',
                    'weekend_multiplier',
                ],
            ]);

        // Defaults should have been created
        $this->assertDatabaseHas('overtime_rules', [
            'organization_id' => $org->id,
        ]);
    }

    public function test_get_overtime_rules_returns_existing_rules(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');

        OvertimeRule::factory()->create([
            'organization_id' => $org->id,
            'daily_threshold_hours' => 9.00,
            'overtime_multiplier' => 2.50,
        ]);

        $this->actingAs($user, 'sanctum');

        $response = $this->getJson('/api/v1/hr/overtime-rules');

        $response->assertOk()
            ->assertJsonPath('data.daily_threshold_hours', '9.00')
            ->assertJsonPath('data.overtime_multiplier', '2.50');
    }

    // ── Update Validation ───────────────────────────────

    public function test_update_validates_multiplier_max_range(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'admin');
        $this->actingAs($admin, 'sanctum');

        OvertimeRule::factory()->create(['organization_id' => $org->id]);

        $response = $this->putJson('/api/v1/hr/overtime-rules', [
            'overtime_multiplier' => 6.0, // max is 5
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['overtime_multiplier']);
    }

    public function test_update_validates_multiplier_min_range(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'admin');
        $this->actingAs($admin, 'sanctum');

        OvertimeRule::factory()->create(['organization_id' => $org->id]);

        $response = $this->putJson('/api/v1/hr/overtime-rules', [
            'overtime_multiplier' => 0.5, // min is 1
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['overtime_multiplier']);
    }

    public function test_update_validates_daily_threshold_range(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'admin');
        $this->actingAs($admin, 'sanctum');

        OvertimeRule::factory()->create(['organization_id' => $org->id]);

        $response = $this->putJson('/api/v1/hr/overtime-rules', [
            'daily_threshold_hours' => 25, // max is 24
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['daily_threshold_hours']);
    }

    // ── Authorization ───────────────────────────────────

    public function test_employee_cannot_update_overtime_rules(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $this->actingAs($employee, 'sanctum');

        $response = $this->putJson('/api/v1/hr/overtime-rules', [
            'daily_threshold_hours' => 9,
        ]);

        $response->assertStatus(403);
    }

    public function test_admin_can_update_overtime_rules(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'admin');
        $this->actingAs($admin, 'sanctum');

        OvertimeRule::factory()->create(['organization_id' => $org->id]);

        $response = $this->putJson('/api/v1/hr/overtime-rules', [
            'daily_threshold_hours' => 10,
            'weekly_threshold_hours' => 45,
            'overtime_multiplier' => 1.75,
            'weekend_multiplier' => 2.50,
        ]);

        $response->assertOk()
            ->assertJsonPath('data.daily_threshold_hours', '10.00')
            ->assertJsonPath('data.weekly_threshold_hours', '45.00')
            ->assertJsonPath('data.overtime_multiplier', '1.75')
            ->assertJsonPath('data.weekend_multiplier', '2.50');
    }

    // ── Cross-Org Isolation ─────────────────────────────

    public function test_cross_org_overtime_rule_isolation(): void
    {
        $orgA = $this->createOrganization();
        $orgB = $this->createOrganization();

        $adminA = $this->createUser($orgA, 'admin');

        OvertimeRule::factory()->create([
            'organization_id' => $orgA->id,
            'daily_threshold_hours' => 8,
        ]);
        OvertimeRule::factory()->create([
            'organization_id' => $orgB->id,
            'daily_threshold_hours' => 10,
        ]);

        $this->actingAs($adminA, 'sanctum');

        $response = $this->getJson('/api/v1/hr/overtime-rules');

        $response->assertOk()
            ->assertJsonPath('data.daily_threshold_hours', '8.00');
    }
}
