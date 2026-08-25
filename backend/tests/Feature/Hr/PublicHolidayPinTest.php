<?php

namespace Tests\Feature\Hr;

use App\Models\PublicHoliday;
use Tests\TestCase;

class PublicHolidayPinTest extends TestCase
{
    public function test_pinning_a_holiday_unpins_any_other(): void
    {
        $org = $this->createOrganization();
        $hr = $this->createUser($org, 'hr_manager');

        $a = PublicHoliday::factory()->create(['organization_id' => $org->id, 'is_pinned' => true]);
        $b = PublicHoliday::factory()->create(['organization_id' => $org->id]);

        $this->actingAs($hr, 'sanctum');

        $this->putJson("/api/v1/hr/public-holidays/{$b->id}/pin")
            ->assertOk()
            ->assertJsonPath('data.is_pinned', true);

        // Single-headline invariant: pinning B unpinned A.
        $this->assertFalse($a->fresh()->is_pinned);
        $this->assertTrue($b->fresh()->is_pinned);
    }

    public function test_pinning_an_already_pinned_holiday_unpins_it(): void
    {
        $org = $this->createOrganization();
        $hr = $this->createUser($org, 'hr_manager');
        $a = PublicHoliday::factory()->create(['organization_id' => $org->id, 'is_pinned' => true]);

        $this->actingAs($hr, 'sanctum');

        // Toggle off — the banner falls back to its automatic pick.
        $this->putJson("/api/v1/hr/public-holidays/{$a->id}/pin")
            ->assertOk()
            ->assertJsonPath('data.is_pinned', false);
    }

    public function test_employee_cannot_pin(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $a = PublicHoliday::factory()->create(['organization_id' => $org->id]);

        $this->actingAs($employee, 'sanctum');

        $this->putJson("/api/v1/hr/public-holidays/{$a->id}/pin")->assertStatus(403);
    }

    public function test_cannot_pin_another_orgs_holiday(): void
    {
        $org = $this->createOrganization();
        $hr = $this->createUser($org, 'hr_manager');
        $otherOrg = $this->createOrganization();
        $foreign = PublicHoliday::factory()->create(['organization_id' => $otherOrg->id]);

        $this->actingAs($hr, 'sanctum');

        $this->putJson("/api/v1/hr/public-holidays/{$foreign->id}/pin")->assertStatus(404);
    }
}
