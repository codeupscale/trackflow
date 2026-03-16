<?php

namespace Tests\Feature\Enterprise;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DataPrivacyTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_request_data_export(): void
    {
        $org = Organization::factory()->create();
        $user = User::factory()->create(['organization_id' => $org->id]);

        $response = $this->actingAs($user)->getJson('/api/v1/privacy/export');

        $response->assertStatus(200)
            ->assertJsonFragment(['message' => 'Data export initiated. You will receive a download link via email within 24 hours.']);
    }

    public function test_data_processing_info_endpoint(): void
    {
        $org = Organization::factory()->create();
        $user = User::factory()->create(['organization_id' => $org->id]);

        $response = $this->actingAs($user)->getJson('/api/v1/privacy/data-processing');

        $response->assertStatus(200)
            ->assertJsonStructure([
                'data_collected',
                'data_retention',
                'data_processing_purposes',
                'third_parties',
                'rights',
            ]);
    }

    public function test_account_deletion_requires_password(): void
    {
        $org = Organization::factory()->create();
        $user = User::factory()->create([
            'organization_id' => $org->id,
            'role' => 'employee',
        ]);

        $response = $this->actingAs($user)->deleteJson('/api/v1/privacy/account', [
            'password' => 'wrong-password',
            'confirmation' => 'DELETE',
        ]);

        $response->assertStatus(403);
    }

    public function test_sole_owner_cannot_delete_account(): void
    {
        $org = Organization::factory()->create();
        $owner = User::factory()->create([
            'organization_id' => $org->id,
            'role' => 'owner',
            'password' => 'password123',
        ]);

        $response = $this->actingAs($owner)->deleteJson('/api/v1/privacy/account', [
            'password' => 'password123',
            'confirmation' => 'DELETE',
        ]);

        $response->assertStatus(422)
            ->assertJsonFragment(['message' => 'Cannot delete the only owner. Transfer ownership first.']);
    }

    public function test_user_can_record_consent(): void
    {
        $org = Organization::factory()->create();
        $user = User::factory()->create(['organization_id' => $org->id]);

        $response = $this->actingAs($user)->postJson('/api/v1/privacy/consent', [
            'privacy_policy_version' => '1.0',
        ]);

        $response->assertStatus(200);
        $this->assertNotNull($user->fresh()->consent_given_at);
        $this->assertEquals('1.0', $user->fresh()->privacy_policy_version);
    }
}
