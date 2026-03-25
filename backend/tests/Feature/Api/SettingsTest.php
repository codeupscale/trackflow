<?php

namespace Tests\Feature\Api;

use App\Models\Organization;
use App\Models\User;
use Tests\TestCase;

class SettingsTest extends TestCase
{
    private Organization $org;
    private User $owner;
    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();
        $this->org = Organization::factory()->create();
        $this->owner = User::factory()->create(['organization_id' => $this->org->id, 'role' => 'owner']);
        $this->employee = User::factory()->create(['organization_id' => $this->org->id, 'role' => 'employee']);
    }

    public function test_can_get_settings(): void
    {
        $this->actingAs($this->owner, 'sanctum');

        $response = $this->getJson('/api/v1/settings');
        $response->assertOk()
            ->assertJsonStructure([
                'organization' => ['id', 'name', 'slug', 'plan', 'settings'],
            ]);
    }

    public function test_owner_can_update_settings(): void
    {
        $this->actingAs($this->owner, 'sanctum');

        $response = $this->putJson('/api/v1/settings', [
            'name' => 'Updated Org Name',
            'settings' => [
                'screenshot_interval' => 10,
                'blur_screenshots' => true,
                'idle_alert_email_enabled' => true,
                'idle_alert_email_cooldown_min' => 60,
            ],
        ]);

        $response->assertOk();
        $this->assertEquals('Updated Org Name', $response->json('organization.name'));
        $this->assertEquals(10, $response->json('organization.settings.screenshot_interval'));
        $this->assertTrue($response->json('organization.settings.blur_screenshots'));
        $this->assertTrue($response->json('organization.settings.idle_alert_email_enabled'));
        $this->assertEquals(60, $response->json('organization.settings.idle_alert_email_cooldown_min'));
    }

    public function test_employee_cannot_update_settings(): void
    {
        $this->actingAs($this->employee, 'sanctum');

        $response = $this->putJson('/api/v1/settings', [
            'name' => 'Hacked',
        ]);

        $response->assertStatus(403);
    }

    public function test_settings_validates_screenshot_interval(): void
    {
        $this->actingAs($this->owner, 'sanctum');

        $response = $this->putJson('/api/v1/settings', [
            'settings' => ['screenshot_interval' => 3],
        ]);

        $response->assertStatus(422);
    }
}
