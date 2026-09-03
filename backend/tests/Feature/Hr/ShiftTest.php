<?php

namespace Tests\Feature\Hr;

use App\Models\Shift;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class ShiftTest extends TestCase
{
    // ── List ────────────────────────────────────────────

    public function test_admin_can_list_shifts(): void
    {
        $user = $this->actingAsUser('org_manager');

        Shift::factory()->count(3)->create([
            'organization_id' => $user->organization_id,
        ]);

        $response = $this->getJson('/api/v1/hr/shifts');

        $response->assertOk()
            ->assertJsonStructure([
                'data' => [['id', 'name', 'start_time', 'end_time', 'days_of_week', 'is_active']],
                'current_page',
                'last_page',
                'total',
            ]);

        $this->assertEquals(3, $response->json('total'));
    }

    // ── Store ───────────────────────────────────────────

    public function test_admin_can_create_shift(): void
    {
        $user = $this->actingAsUser('org_manager');

        $response = $this->postJson('/api/v1/hr/shifts', [
            'name' => 'Morning Shift',
            'start_time' => '06:00',
            'end_time' => '14:00',
            'days_of_week' => ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
            'break_minutes' => 30,
            'color' => '#FF5733',
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('data.name', 'Morning Shift')
            ->assertJsonPath('data.start_time', '06:00');

        $this->assertDatabaseHas('shifts', [
            'organization_id' => $user->organization_id,
            'name' => 'Morning Shift',
        ]);
    }

    public function test_create_shift_validates_required_fields(): void
    {
        $this->actingAsUser('org_manager');

        $response = $this->postJson('/api/v1/hr/shifts', []);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['name', 'start_time', 'end_time', 'days_of_week']);
    }

    public function test_create_shift_validates_unique_name_per_org(): void
    {
        $user = $this->actingAsUser('org_manager');

        Shift::factory()->create([
            'organization_id' => $user->organization_id,
            'name' => 'Morning Shift',
        ]);

        // Same name same org -> 422
        $response = $this->postJson('/api/v1/hr/shifts', [
            'name' => 'Morning Shift',
            'start_time' => '06:00',
            'end_time' => '14:00',
            'days_of_week' => ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['name']);

        // Same name different org -> OK
        $otherOrg = $this->createOrganization();
        $otherAdmin = $this->createUser($otherOrg, 'org_manager');
        $this->actingAs($otherAdmin, 'sanctum');

        $response = $this->postJson('/api/v1/hr/shifts', [
            'name' => 'Morning Shift',
            'start_time' => '06:00',
            'end_time' => '14:00',
            'days_of_week' => ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        ]);

        $response->assertStatus(201);
    }

    // ── Update ──────────────────────────────────────────

    public function test_admin_can_update_shift(): void
    {
        $user = $this->actingAsUser('org_manager');

        $shift = Shift::factory()->create([
            'organization_id' => $user->organization_id,
            'name' => 'Old Shift',
        ]);

        $response = $this->putJson("/api/v1/hr/shifts/{$shift->id}", [
            'name' => 'Updated Shift',
            'break_minutes' => 45,
        ]);

        $response->assertOk()
            ->assertJsonPath('data.name', 'Updated Shift')
            ->assertJsonPath('data.break_minutes', 45);
    }

    // ── Delete ──────────────────────────────────────────

    public function test_admin_can_delete_shift(): void
    {
        $user = $this->actingAsUser('org_manager');

        $shift = Shift::factory()->create([
            'organization_id' => $user->organization_id,
        ]);

        $response = $this->deleteJson("/api/v1/hr/shifts/{$shift->id}");

        $response->assertStatus(204);
        $this->assertSoftDeleted('shifts', ['id' => $shift->id]);
    }

    // ── Authorization ───────────────────────────────────

    public function test_employee_cannot_create_shift(): void
    {
        $this->actingAsUser('employee');

        $response = $this->postJson('/api/v1/hr/shifts', [
            'name' => 'Forbidden Shift',
            'start_time' => '09:00',
            'end_time' => '17:00',
            'days_of_week' => ['monday'],
        ]);

        $response->assertStatus(403);
    }

    /**
     * An employee sees the shift they are ON — and nothing else. The org's
     * shift catalogue is not theirs to browse, so the narrowing is enforced by
     * the server rather than by the caller passing ?mine=1.
     */
    public function test_employee_sees_only_their_own_shift(): void
    {
        $user = $this->actingAsUser('employee');

        $mine = Shift::factory()->create([
            'organization_id' => $user->organization_id,
            'name' => 'Morning Shift',
        ]);
        Shift::factory()->create([
            'organization_id' => $user->organization_id,
            'name' => 'Night Shift',
        ]);

        app(\App\Services\ShiftService::class)->assignUser(
            $user->organization_id,
            $user->id,
            $mine->id,
            now()->toDateString(),
            null,
        );

        $response = $this->getJson('/api/v1/hr/shifts');

        $response->assertOk();
        $this->assertCount(1, $response->json('data'));
        $this->assertSame('Morning Shift', $response->json('data.0.name'));
        // Read-only: no management affordance is advertised to them.
        $this->assertFalse($response->json('data.0.can_edit'));
        $this->assertFalse($response->json('data.0.can_delete'));
    }

    public function test_unassigned_employee_sees_no_shifts(): void
    {
        $user = $this->actingAsUser('employee');

        Shift::factory()->create(['organization_id' => $user->organization_id]);

        $response = $this->getJson('/api/v1/hr/shifts');

        $response->assertOk();
        $this->assertCount(0, $response->json('data'));
    }

    public function test_manager_still_sees_the_whole_shift_catalogue(): void
    {
        $user = $this->actingAsUser('org_manager');

        Shift::factory()->count(3)->create(['organization_id' => $user->organization_id]);

        $response = $this->getJson('/api/v1/hr/shifts');

        $response->assertOk();
        $this->assertCount(3, $response->json('data'));
    }

    // ── Cross-Org Isolation ─────────────────────────────

    public function test_cross_org_shift_isolation(): void
    {
        $orgA = $this->createOrganization();
        $orgB = $this->createOrganization();

        $adminA = $this->createUser($orgA, 'org_manager');
        $this->createUser($orgB, 'org_manager');

        $shiftB = Shift::factory()->create([
            'organization_id' => $orgB->id,
            'name' => 'Org B Shift',
        ]);

        $this->actingAs($adminA, 'sanctum');

        // Listing should not include org B's shift
        $response = $this->getJson('/api/v1/hr/shifts');
        $response->assertOk();
        $ids = collect($response->json('data'))->pluck('id')->toArray();
        $this->assertNotContains($shiftB->id, $ids);

        // Direct access should 404
        $response = $this->getJson("/api/v1/hr/shifts/{$shiftB->id}");
        $response->assertStatus(404);
    }
}
