<?php

namespace Tests\Feature\Hr;

use App\Models\EmployeeProfile;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Archiving an ex-employee.
 *
 * `users.is_active = false` IS the archive flag — there is deliberately no
 * separate column, because the flag already blocked login and was already
 * filtered by most listing queries. These tests pin the two halves that were
 * missing: that archiving actually STOPS the person (tokens, open work), and
 * that they disappear from the lists rather than only from the directory.
 */
class EmployeeArchiveTest extends TestCase
{
    private Organization $org;
    private User $hr;
    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();
        $this->org = $this->createOrganization();
        $this->hr = $this->createUser($this->org, 'hr_manager');
        $this->employee = $this->createUser($this->org, 'employee');
        EmployeeProfile::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'employment_status' => 'active',
        ]);
    }

    private function archive(array $ids)
    {
        return $this->postJson('/api/v1/hr/employees/archive', ['user_ids' => $ids]);
    }

    public function test_archiving_hides_the_employee_and_marks_them_terminated(): void
    {
        $this->actingAs($this->hr, 'sanctum');

        $this->archive([$this->employee->id])
            ->assertOk()
            ->assertJsonPath('archived', 1);

        $this->assertDatabaseHas('users', ['id' => $this->employee->id, 'is_active' => false]);
        $this->assertDatabaseHas('employee_profiles', [
            'user_id' => $this->employee->id,
            'employment_status' => 'terminated',
        ]);
        $this->assertNotNull(
            EmployeeProfile::where('user_id', $this->employee->id)->value('date_of_exit')
        );

        // Gone from the default directory, present under the Archive tab.
        $ids = fn (array $params = []) => collect(
            $this->getJson('/api/v1/hr/employees?' . http_build_query($params))->json('data')
        )->pluck('id')->all();

        $this->assertNotContains($this->employee->id, $ids());
        $this->assertContains($this->employee->id, $ids(['archived' => 1]));
    }

    /**
     * The reason archiving is more than a flag: deactivation never touched
     * existing tokens, so the desktop agent kept tracking for up to 30 days.
     */
    public function test_archiving_revokes_every_token_so_the_agent_stops(): void
    {
        $this->employee->createToken('desktop-agent');
        $this->assertSame(1, $this->employee->tokens()->count());

        $this->actingAs($this->hr, 'sanctum');
        $this->archive([$this->employee->id])->assertOk();

        $this->assertSame(0, $this->employee->fresh()->tokens()->count());
    }

    /** An open entry closes at the last heartbeat, never at now(). */
    public function test_archiving_closes_an_open_time_entry_without_billing_the_dead_time(): void
    {
        $startedAt = Carbon::now()->subHours(6);

        $entry = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'started_at' => $startedAt,
            'ended_at' => null,
            'type' => 'tracked',
            'approval_status' => 'approved',
        ]);

        $lastBeat = $startedAt->copy()->addHours(2);
        DB::table('activity_logs')->insert([
            'id' => (string) \Illuminate\Support\Str::uuid(),
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'time_entry_id' => $entry->id,
            'logged_at' => $lastBeat,
            'keyboard_events' => 10,
            'mouse_events' => 10,
            'active_seconds' => 30,
        ]);

        $this->actingAs($this->hr, 'sanctum');
        $this->archive([$this->employee->id])->assertOk();

        $entry->refresh();
        $this->assertNotNull($entry->ended_at);
        // Closed at the heartbeat (2h), not at now() (6h) — the four idle hours
        // between leaving and being archived are not billed.
        $this->assertSame(2 * 3600, (int) $entry->duration_seconds);
    }

    public function test_archiving_cancels_pending_leave_but_leaves_decided_requests_alone(): void
    {
        $leaveTypeId = (string) \Illuminate\Support\Str::uuid();
        DB::table('leave_types')->insert([
            'id' => $leaveTypeId,
            'organization_id' => $this->org->id,
            'name' => 'Annual',
            'code' => 'ANN',
            'days_per_year' => 20,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $make = function (string $status) use ($leaveTypeId) {
            return DB::table('leave_requests')->insertGetId([
                'id' => (string) \Illuminate\Support\Str::uuid(),
                'organization_id' => $this->org->id,
                'user_id' => $this->employee->id,
                'leave_type_id' => $leaveTypeId,
                'start_date' => now()->addDays(3)->toDateString(),
                'end_date' => now()->addDays(4)->toDateString(),
                'days_count' => 2,
                'status' => $status,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        };

        $make('pending');
        $make('approved');

        $this->actingAs($this->hr, 'sanctum');
        $this->archive([$this->employee->id])->assertOk();

        $statuses = DB::table('leave_requests')
            ->where('user_id', $this->employee->id)->pluck('status')->sort()->values()->all();

        $this->assertSame(['approved', 'cancelled'], $statuses);
    }

    public function test_archived_employees_disappear_from_the_people_picker(): void
    {
        $this->actingAs($this->hr, 'sanctum');
        $this->archive([$this->employee->id])->assertOk();

        $ids = collect($this->getJson('/api/v1/users?per_page=100')->json('data'))
            ->pluck('id')->all();

        $this->assertNotContains($this->employee->id, $ids);
    }

    public function test_restore_brings_them_back(): void
    {
        $this->actingAs($this->hr, 'sanctum');
        $this->archive([$this->employee->id])->assertOk();

        $this->postJson('/api/v1/hr/employees/restore', ['user_ids' => [$this->employee->id]])
            ->assertOk()
            ->assertJsonPath('restored', 1);

        $this->assertDatabaseHas('users', ['id' => $this->employee->id, 'is_active' => true]);
        $this->assertDatabaseHas('employee_profiles', [
            'user_id' => $this->employee->id,
            'employment_status' => 'active',
            'date_of_exit' => null,
        ]);
    }

    public function test_bulk_archive_and_repeat_calls_are_safe(): void
    {
        $second = $this->createUser($this->org, 'employee');

        $this->actingAs($this->hr, 'sanctum');
        $this->archive([$this->employee->id, $second->id])->assertJsonPath('archived', 2);

        // Already archived — a repeat is a no-op, not an error.
        $this->archive([$this->employee->id, $second->id])->assertJsonPath('archived', 0);
    }

    /** Archiving yourself would revoke the token of the request in flight. */
    public function test_an_actor_cannot_archive_themselves(): void
    {
        $this->actingAs($this->hr, 'sanctum');

        $this->archive([$this->hr->id])->assertJsonPath('archived', 0);
        $this->assertDatabaseHas('users', ['id' => $this->hr->id, 'is_active' => true]);
    }

    public function test_only_owner_org_manager_and_hr_may_archive(): void
    {
        foreach (['owner', 'org_manager', 'hr_manager'] as $role) {
            $actor = $this->createUser($this->org, $role);
            $target = $this->createUser($this->org, 'employee');
            $this->actingAs($actor, 'sanctum');
            $this->archive([$target->id])->assertOk();
        }

        foreach (['finance_manager', 'employee'] as $role) {
            $actor = $this->createUser($this->org, $role);
            $this->actingAs($actor, 'sanctum');
            $this->archive([$this->employee->id])->assertStatus(403);
        }
    }

    public function test_an_employee_from_another_org_is_never_archived(): void
    {
        $otherOrg = $this->createOrganization();
        $outsider = $this->createUser($otherOrg, 'employee');

        $this->actingAs($this->hr, 'sanctum');
        $this->archive([$outsider->id])->assertJsonPath('archived', 0);

        $this->assertDatabaseHas('users', ['id' => $outsider->id, 'is_active' => true]);
    }
}
