<?php

namespace Tests\Feature\Hr;

use App\Models\PublicHoliday;
use Tests\TestCase;

class PublicHolidayTest extends TestCase
{
    // ── Index ────────────────────────────────────────────

    public function test_can_list_public_holidays(): void
    {
        $user = $this->actingAsUser('owner');

        PublicHoliday::factory()->count(3)->create([
            'organization_id' => $user->organization_id,
        ]);

        $response = $this->getJson('/api/v1/hr/public-holidays');

        $response->assertOk()
            ->assertJsonStructure([
                'data' => [['id', 'name', 'date', 'is_recurring']],
                'current_page',
                'last_page',
                'total',
            ]);

        $this->assertCount(3, $response->json('data'));
    }

    public function test_can_filter_holidays_by_year(): void
    {
        $user = $this->actingAsUser('owner');

        PublicHoliday::factory()->create([
            'organization_id' => $user->organization_id,
            'date' => '2026-01-01',
        ]);
        PublicHoliday::factory()->create([
            'organization_id' => $user->organization_id,
            'date' => '2026-12-25',
        ]);
        PublicHoliday::factory()->create([
            'organization_id' => $user->organization_id,
            'date' => '2025-07-04',
        ]);

        $response = $this->getJson('/api/v1/hr/public-holidays?year=2026');

        $response->assertOk();
        $this->assertCount(2, $response->json('data'));
    }

    // ── Store ────────────────────────────────────────────

    public function test_admin_can_create_public_holiday(): void
    {
        $user = $this->actingAsUser('admin');

        $response = $this->postJson('/api/v1/hr/public-holidays', [
            'name' => 'Australia Day',
            'date' => '2026-01-26',
            'is_recurring' => true,
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('data.name', 'Australia Day')
            ->assertJsonPath('data.date', fn ($date) => str_starts_with($date, '2026-01-26'));

        $this->assertDatabaseHas('public_holidays', [
            'organization_id' => $user->organization_id,
            'name' => 'Australia Day',
            'date' => '2026-01-26 00:00:00',
        ]);
    }

    // ── Authorization ────────────────────────────────────

    public function test_employee_cannot_create_public_holiday(): void
    {
        $this->actingAsUser('employee');

        $response = $this->postJson('/api/v1/hr/public-holidays', [
            'name' => 'New Year',
            'date' => '2026-01-01',
        ]);

        $response->assertStatus(403);
    }

    // ── Cross-Org Isolation ──────────────────────────────

    public function test_cross_org_isolation(): void
    {
        $orgA = $this->createOrganization();
        $orgB = $this->createOrganization();

        $userA = $this->createUser($orgA, 'owner');
        $this->createUser($orgB, 'owner');

        PublicHoliday::factory()->create([
            'organization_id' => $orgA->id,
            'name' => 'Org A Holiday',
        ]);

        $holidayB = PublicHoliday::factory()->create([
            'organization_id' => $orgB->id,
            'name' => 'Org B Holiday',
        ]);

        $this->actingAs($userA, 'sanctum');

        $response = $this->getJson('/api/v1/hr/public-holidays');
        $response->assertOk();

        $ids = collect($response->json('data'))->pluck('id')->toArray();
        $this->assertNotContains($holidayB->id, $ids);

        // Should only see the one belonging to orgA
        $this->assertCount(1, $response->json('data'));
    }

    // ── Validation ───────────────────────────────────────

    public function test_store_validates_required_fields(): void
    {
        $this->actingAsUser('admin');

        $response = $this->postJson('/api/v1/hr/public-holidays', []);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['name', 'date']);
    }
}
