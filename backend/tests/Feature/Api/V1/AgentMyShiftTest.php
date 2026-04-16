<?php

namespace Tests\Feature\Api\V1;

use App\Models\Shift;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class AgentMyShiftTest extends TestCase
{
    public function test_returns_shift_when_user_has_active_shift(): void
    {
        $user = $this->actingAsUser('employee');

        $shift = Shift::factory()->create([
            'organization_id' => $user->organization_id,
            'name' => 'Day Shift',
            'start_time' => '09:00:00',
            'end_time' => '17:00:00',
            'break_minutes' => 30,
            'timezone' => 'UTC',
            'grace_period_minutes' => 10,
        ]);

        DB::table('user_shifts')->insert([
            'id' => (string) Str::uuid(),
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'shift_id' => $shift->id,
            'effective_from' => now()->subMonth()->toDateString(),
            'effective_to' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->getJson('/api/v1/agent/my-shift');

        $response->assertOk()
            ->assertJsonPath('shift.id', $shift->id)
            ->assertJsonPath('shift.name', 'Day Shift')
            ->assertJsonPath('shift.start_time', '09:00:00')
            ->assertJsonPath('shift.end_time', '17:00:00')
            ->assertJsonPath('shift.break_minutes', 30)
            ->assertJsonPath('shift.timezone', 'UTC')
            ->assertJsonPath('shift.grace_period_minutes', 10);
    }

    public function test_returns_null_shift_when_no_assignment(): void
    {
        $this->actingAsUser('employee');

        $response = $this->getJson('/api/v1/agent/my-shift');

        $response->assertOk()
            ->assertJsonPath('shift', null);
    }

    public function test_requires_authentication(): void
    {
        $response = $this->getJson('/api/v1/agent/my-shift');

        $response->assertUnauthorized();
    }

    public function test_returns_null_shift_when_assignment_expired(): void
    {
        $user = $this->actingAsUser('employee');

        $shift = Shift::factory()->create([
            'organization_id' => $user->organization_id,
        ]);

        DB::table('user_shifts')->insert([
            'id' => (string) Str::uuid(),
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'shift_id' => $shift->id,
            'effective_from' => now()->subMonths(2)->toDateString(),
            'effective_to' => now()->subDay()->toDateString(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->getJson('/api/v1/agent/my-shift');

        $response->assertOk()
            ->assertJsonPath('shift', null);
    }
}
