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
        $user = $this->actingAsUser('admin');

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
        $user = $this->actingAsUser('admin');

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
        $this->actingAsUser('admin');

        $response = $this->postJson('/api/v1/hr/shifts', []);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['name', 'start_time', 'end_time', 'days_of_week']);
    }

    public function test_create_shift_validates_unique_name_per_org(): void
    {
        $user = $this->actingAsUser('admin');

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
        $otherAdmin = $this->createUser($otherOrg, 'admin');
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
        $user = $this->actingAsUser('admin');

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
        $user = $this->actingAsUser('admin');

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

    public function test_employee_can_view_shifts(): void
    {
        $user = $this->actingAsUser('employee');

        Shift::factory()->create([
            'organization_id' => $user->organization_id,
        ]);

        $response = $this->getJson('/api/v1/hr/shifts');

        $response->assertOk();
        $this->assertCount(1, $response->json('data'));
    }

    // ── Roster ──────────────────────────────────────────

    public function test_get_shift_roster(): void
    {
        $user = $this->actingAsUser('admin');
        $employee = $this->createUser(
            \App\Models\Organization::find($user->organization_id),
            'employee',
        );

        $shift = Shift::factory()->create([
            'organization_id' => $user->organization_id,
            'name' => 'Day Shift',
            'start_time' => '09:00:00',
            'end_time' => '17:00:00',
            'days_of_week' => ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        ]);

        DB::table('user_shifts')->insert([
            'id' => (string) Str::uuid(),
            'organization_id' => $user->organization_id,
            'user_id' => $employee->id,
            'shift_id' => $shift->id,
            'effective_from' => '2026-01-01',
            'effective_to' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // 2026-04-06 is a Monday
        $response = $this->getJson('/api/v1/hr/shifts/roster?week_start=2026-04-06');

        $response->assertOk()
            ->assertJsonStructure(['data']);

        $data = $response->json('data');
        $this->assertCount(7, $data);
        $this->assertArrayHasKey('2026-04-06', $data);
        $this->assertArrayHasKey('2026-04-12', $data);
    }

    // ── Cross-Org Isolation ─────────────────────────────

    public function test_cross_org_shift_isolation(): void
    {
        $orgA = $this->createOrganization();
        $orgB = $this->createOrganization();

        $adminA = $this->createUser($orgA, 'admin');
        $this->createUser($orgB, 'admin');

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
