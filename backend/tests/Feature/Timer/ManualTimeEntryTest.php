<?php

namespace Tests\Feature\Timer;

use App\Models\Organization;
use App\Models\Project;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Feature A — Manual time entry with an approval workflow.
 *
 * Covers creation (self vs on-behalf, auto-approve vs queue), the role-scoped
 * pending queue, approve/reject with the self-approval guard + pending-only
 * precondition, validation, and multi-tenancy isolation.
 *
 * The self-approval guard is a safety invariant: even though the normal creation
 * flow never produces a pending entry whose submitter/owner holds approval
 * authority, we craft such rows directly to prove the guard still rejects them.
 */
class ManualTimeEntryTest extends TestCase
{
    private Organization $org;
    private User $owner;
    private User $manager;      // org_manager → time_entries.approve = organization
    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();
        $this->org = $this->createOrganization();
        $this->owner = $this->createUser($this->org, 'owner');
        $this->manager = $this->createUser($this->org, 'org_manager');
        $this->employee = $this->createUser($this->org, 'employee');
    }

    // ── Creation: self-service ────────────────────────────────────────────

    public function test_employee_self_entry_lands_in_pending_queue(): void
    {
        $this->actingAs($this->employee, 'sanctum');

        $response = $this->postJson('/api/v1/time-entries', [
            'started_at' => now()->subHours(2)->toISOString(),
            'ended_at' => now()->subHour()->toISOString(),
            'notes' => 'Forgot to start the timer',
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('entry.approval_status', 'pending')
            ->assertJsonPath('entry.is_approved', false)
            ->assertJsonPath('entry.submitted_by', $this->employee->id)
            ->assertJsonPath('entry.user_id', $this->employee->id)
            ->assertJsonPath('message', 'Time entry submitted for approval.');

        $this->assertDatabaseHas('time_entries', [
            'id' => $response->json('entry.id'),
            'approval_status' => 'pending',
            'approved_by' => null,
            'type' => 'manual',
        ]);
    }

    public function test_manager_self_entry_is_auto_approved(): void
    {
        $this->actingAs($this->manager, 'sanctum');

        $response = $this->postJson('/api/v1/time-entries', [
            'started_at' => now()->subHours(2)->toISOString(),
            'ended_at' => now()->subHour()->toISOString(),
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('entry.approval_status', 'approved')
            ->assertJsonPath('entry.is_approved', true)
            ->assertJsonPath('entry.user_id', $this->manager->id)
            ->assertJsonPath('entry.approved_by', $this->manager->id)
            ->assertJsonPath('message', 'Time entry created.');
    }

    // ── Creation: on-behalf ───────────────────────────────────────────────

    public function test_manager_on_behalf_entry_is_approved_with_approver_set(): void
    {
        $this->actingAs($this->manager, 'sanctum');

        $response = $this->postJson('/api/v1/time-entries', [
            'user_id' => $this->employee->id,
            'started_at' => now()->subHours(2)->toISOString(),
            'ended_at' => now()->subHour()->toISOString(),
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('entry.approval_status', 'approved')
            ->assertJsonPath('entry.is_approved', true)
            ->assertJsonPath('entry.user_id', $this->employee->id)
            ->assertJsonPath('entry.submitted_by', $this->manager->id)
            ->assertJsonPath('entry.approved_by', $this->manager->id);
    }

    public function test_project_scoped_manager_cannot_log_for_user_outside_scope(): void
    {
        // A project-scoped approver targeting a same-org user who is NOT in any of
        // their projects → 403 from the service scope check.
        $project = Project::factory()->create([
            'organization_id' => $this->org->id,
            'created_by' => $this->owner->id,
        ]);
        $pm = $this->makeScopedApprover(['time_entries.approve' => 'project'], $project);

        $outsider = $this->createUser($this->org, 'employee'); // not on the project

        $this->actingAs($pm, 'sanctum');

        $response = $this->postJson('/api/v1/time-entries', [
            'user_id' => $outsider->id,
            'started_at' => now()->subHours(2)->toISOString(),
            'ended_at' => now()->subHour()->toISOString(),
        ]);

        $response->assertStatus(403);
    }

    public function test_on_behalf_for_cross_org_user_is_rejected(): void
    {
        // A user_id from another org fails the org-scoped exists() validation.
        $otherOrg = $this->createOrganization();
        $otherUser = $this->createUser($otherOrg, 'employee');

        $this->actingAs($this->manager, 'sanctum');

        $response = $this->postJson('/api/v1/time-entries', [
            'user_id' => $otherUser->id,
            'started_at' => now()->subHours(2)->toISOString(),
            'ended_at' => now()->subHour()->toISOString(),
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['user_id']);

        // The foreign user never got an entry.
        $this->assertDatabaseMissing('time_entries', ['user_id' => $otherUser->id]);
    }

    // ── Creation guards preserved from the previous controller ────────────

    public function test_manual_entry_blocked_when_org_setting_disabled(): void
    {
        $this->org->update(['settings' => ['can_add_manual_time' => false]]);

        $this->actingAs($this->employee, 'sanctum');

        $response = $this->postJson('/api/v1/time-entries', [
            'started_at' => now()->subHours(2)->toISOString(),
            'ended_at' => now()->subHour()->toISOString(),
        ]);

        $response->assertStatus(403);
    }

    public function test_manual_entry_blocked_when_user_not_assigned_to_project(): void
    {
        $project = Project::factory()->create([
            'organization_id' => $this->org->id,
            'created_by' => $this->owner->id,
        ]);

        $this->actingAs($this->employee, 'sanctum');

        $response = $this->postJson('/api/v1/time-entries', [
            'project_id' => $project->id,
            'started_at' => now()->subHours(2)->toISOString(),
            'ended_at' => now()->subHour()->toISOString(),
        ]);

        $response->assertStatus(403);
    }

    public function test_manual_entry_validation_rejects_future_start_and_bad_range(): void
    {
        $this->actingAs($this->employee, 'sanctum');

        // ended_at not after started_at
        $this->postJson('/api/v1/time-entries', [
            'started_at' => now()->subHour()->toISOString(),
            'ended_at' => now()->subHours(2)->toISOString(),
        ])->assertStatus(422)->assertJsonValidationErrors(['ended_at']);

        // started_at in the future
        $this->postJson('/api/v1/time-entries', [
            'started_at' => now()->addHour()->toISOString(),
            'ended_at' => now()->addHours(2)->toISOString(),
        ])->assertStatus(422)->assertJsonValidationErrors(['started_at']);
    }

    // ── Pending queue (role-scoped) ───────────────────────────────────────

    public function test_org_scoped_approver_sees_all_pending_in_org(): void
    {
        $other = $this->createUser($this->org, 'employee');
        $this->makePending($this->employee, $this->employee);
        $this->makePending($other, $other);
        // An approved entry must NOT appear in the pending queue.
        TimeEntry::factory()->manual()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'approval_status' => 'approved',
        ]);

        $this->actingAs($this->owner, 'sanctum');
        $response = $this->getJson('/api/v1/time-entries/pending');

        $response->assertOk()
            ->assertJsonStructure(['data', 'current_page', 'total']);
        $this->assertCount(2, $response->json('data'));
        foreach ($response->json('data') as $row) {
            $this->assertEquals('pending', $row['approval_status']);
        }
    }

    public function test_project_scoped_approver_sees_only_pending_for_project_users(): void
    {
        $project = Project::factory()->create([
            'organization_id' => $this->org->id,
            'created_by' => $this->owner->id,
        ]);
        $pm = $this->makeScopedApprover(['time_entries.approve' => 'project'], $project);

        $teamMember = $this->createUser($this->org, 'employee');
        $project->members()->attach($teamMember->id);

        $outsider = $this->createUser($this->org, 'employee'); // not on the PM's project

        $this->makePending($teamMember, $teamMember);
        $this->makePending($outsider, $outsider);

        $this->actingAs($pm, 'sanctum');
        $response = $this->getJson('/api/v1/time-entries/pending');

        $response->assertOk();
        $ids = collect($response->json('data'))->pluck('user_id')->all();
        $this->assertContains($teamMember->id, $ids);
        $this->assertNotContains($outsider->id, $ids);
    }

    public function test_employee_cannot_access_pending_queue(): void
    {
        $this->makePending($this->employee, $this->employee);

        $this->actingAs($this->employee, 'sanctum');
        $this->getJson('/api/v1/time-entries/pending')->assertStatus(403);
    }

    public function test_pending_queue_does_not_leak_across_tenants(): void
    {
        $otherOrg = $this->createOrganization();
        $otherEmployee = $this->createUser($otherOrg, 'employee');

        $this->makePending($this->employee, $this->employee);            // org A
        $this->makePending($otherEmployee, $otherEmployee, $otherOrg);   // org B

        $this->actingAs($this->owner, 'sanctum');
        $response = $this->getJson('/api/v1/time-entries/pending');

        $response->assertOk();
        $this->assertCount(1, $response->json('data'));
        $this->assertEquals($this->employee->id, $response->json('data.0.user_id'));
    }

    // ── Approve ───────────────────────────────────────────────────────────

    public function test_approve_pending_entry_marks_it_approved(): void
    {
        $entry = $this->makePending($this->employee, $this->employee);

        $this->actingAs($this->manager, 'sanctum');
        $response = $this->postJson("/api/v1/time-entries/{$entry->id}/approve");

        $response->assertOk()
            ->assertJsonPath('entry.approval_status', 'approved')
            ->assertJsonPath('message', 'Time entry approved.');

        $entry->refresh();
        $this->assertTrue($entry->is_approved);
        $this->assertEquals('approved', $entry->approval_status);
        $this->assertEquals($this->manager->id, $entry->approved_by);
        $this->assertNotNull($entry->approved_at);
    }

    public function test_cannot_approve_already_resolved_entry(): void
    {
        $entry = TimeEntry::factory()->manual()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'submitted_by' => $this->employee->id,
            'approval_status' => 'approved',
            'is_approved' => true,
        ]);

        $this->actingAs($this->manager, 'sanctum');
        $response = $this->postJson("/api/v1/time-entries/{$entry->id}/approve");

        $response->assertStatus(422)
            ->assertJsonPath('error.message', 'This entry has already been resolved.');
    }

    public function test_cannot_approve_own_submitted_entry(): void
    {
        // Guard: submitted_by === actor. Craft a pending row submitted by the manager.
        $entry = TimeEntry::factory()->manual()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'submitted_by' => $this->manager->id,
            'approval_status' => 'pending',
            'is_approved' => false,
        ]);

        $this->actingAs($this->manager, 'sanctum');
        $response = $this->postJson("/api/v1/time-entries/{$entry->id}/approve");

        $response->assertStatus(403)
            ->assertJsonPath('error.message', 'You cannot approve your own time entry.');
    }

    public function test_cannot_approve_own_owned_entry(): void
    {
        // Guard: user_id === actor.
        $entry = TimeEntry::factory()->manual()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->manager->id,
            'submitted_by' => $this->employee->id,
            'approval_status' => 'pending',
            'is_approved' => false,
        ]);

        $this->actingAs($this->manager, 'sanctum');
        $this->postJson("/api/v1/time-entries/{$entry->id}/approve")->assertStatus(403);
    }

    public function test_approve_cross_tenant_entry_returns_404(): void
    {
        $otherOrg = $this->createOrganization();
        $otherManager = $this->createUser($otherOrg, 'org_manager');
        $entry = $this->makePending($this->employee, $this->employee);

        $this->actingAs($otherManager, 'sanctum');
        $this->postJson("/api/v1/time-entries/{$entry->id}/approve")->assertStatus(404);
    }

    // ── Reject ────────────────────────────────────────────────────────────

    public function test_reject_requires_a_reason(): void
    {
        $entry = $this->makePending($this->employee, $this->employee);

        $this->actingAs($this->manager, 'sanctum');
        $this->postJson("/api/v1/time-entries/{$entry->id}/reject", [])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['rejection_reason']);
    }

    public function test_reject_pending_entry_stores_reason(): void
    {
        $entry = $this->makePending($this->employee, $this->employee);

        $this->actingAs($this->manager, 'sanctum');
        $response = $this->postJson("/api/v1/time-entries/{$entry->id}/reject", [
            'rejection_reason' => 'Overlaps an existing entry.',
        ]);

        $response->assertOk()
            ->assertJsonPath('entry.approval_status', 'rejected')
            ->assertJsonPath('message', 'Time entry rejected.');

        $entry->refresh();
        $this->assertFalse($entry->is_approved);
        $this->assertEquals('rejected', $entry->approval_status);
        $this->assertEquals('Overlaps an existing entry.', $entry->rejection_reason);
    }

    public function test_cannot_reject_own_submitted_entry(): void
    {
        $entry = TimeEntry::factory()->manual()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'submitted_by' => $this->manager->id,
            'approval_status' => 'pending',
            'is_approved' => false,
        ]);

        $this->actingAs($this->manager, 'sanctum');
        $this->postJson("/api/v1/time-entries/{$entry->id}/reject", [
            'rejection_reason' => 'nope',
        ])->assertStatus(403);
    }

    public function test_cannot_reject_already_resolved_entry(): void
    {
        $entry = TimeEntry::factory()->manual()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'submitted_by' => $this->employee->id,
            'approval_status' => 'rejected',
            'is_approved' => false,
            'rejection_reason' => 'already done',
        ]);

        $this->actingAs($this->manager, 'sanctum');
        $this->postJson("/api/v1/time-entries/{$entry->id}/reject", [
            'rejection_reason' => 'again',
        ])->assertStatus(422);
    }

    // ── Update: approval integrity (self-edit re-review) ──────────────────

    public function test_employee_editing_approved_manual_entry_resets_to_pending_and_leaves_aggregate(): void
    {
        // Employee submits a manual entry → pending.
        $this->actingAs($this->employee, 'sanctum');
        $created = $this->postJson('/api/v1/time-entries', [
            'started_at' => now()->subHours(2)->toISOString(),
            'ended_at' => now()->subHour()->toISOString(),
            'notes' => 'Forgot the timer',
        ])->assertStatus(201);
        $entryId = $created->json('entry.id');

        // Manager approves → it now counts toward the org aggregate.
        $this->actingAs($this->manager, 'sanctum');
        $this->postJson("/api/v1/time-entries/{$entryId}/approve")->assertOk();
        $this->assertEquals(3600, $this->orgSummarySeconds());

        // Employee widens the window on their now-approved entry.
        $this->actingAs($this->employee, 'sanctum');
        $this->putJson("/api/v1/time-entries/{$entryId}", [
            'started_at' => now()->subHours(5)->toISOString(),
            'ended_at' => now()->subHour()->toISOString(),
        ])->assertOk();

        // The self-edit forces it back into the pending queue — no stale approval.
        $entry = TimeEntry::findOrFail($entryId);
        $this->assertEquals('pending', $entry->approval_status);
        $this->assertFalse($entry->is_approved);
        $this->assertNull($entry->approved_by);
        $this->assertNull($entry->approved_at);
        // Duration recomputed (4h) but excluded from the aggregate until re-approval.
        $this->assertEquals(14400, $entry->duration_seconds);
        $this->assertEquals(0, $this->orgSummarySeconds());
    }

    public function test_authorized_approver_editing_approved_manual_entry_keeps_it_approved(): void
    {
        // Employee submits → manager approves.
        $this->actingAs($this->employee, 'sanctum');
        $entryId = $this->postJson('/api/v1/time-entries', [
            'started_at' => now()->subHours(2)->toISOString(),
            'ended_at' => now()->subHour()->toISOString(),
        ])->assertStatus(201)->json('entry.id');

        $this->actingAs($this->manager, 'sanctum');
        $this->postJson("/api/v1/time-entries/{$entryId}/approve")->assertOk();

        // The owner (org-scope approver, not the submitter/owner of this entry)
        // edits it — a legitimate approver, so it stays approved.
        $this->actingAs($this->owner, 'sanctum');
        $this->putJson("/api/v1/time-entries/{$entryId}", [
            'started_at' => now()->subHours(3)->toISOString(),
            'ended_at' => now()->subHour()->toISOString(),
        ])->assertOk();

        $entry = TimeEntry::findOrFail($entryId);
        $this->assertEquals('approved', $entry->approval_status);
        $this->assertTrue($entry->is_approved);
        // Still counts (3h now) — never left the aggregate.
        $this->assertEquals(7200, $entry->duration_seconds);
        $this->assertEquals(7200, $this->orgSummarySeconds());
    }

    public function test_approver_editing_their_own_auto_approved_entry_is_not_trapped_in_pending(): void
    {
        // W2 regression: an org/project-scope approver's OWN manual entry is
        // auto-approved on create; editing it must NOT reset to pending (nobody
        // could re-approve it in a single-approver org). Mirrors create().
        $this->actingAs($this->manager, 'sanctum');
        $entryId = $this->postJson('/api/v1/time-entries', [
            'started_at' => now()->subHours(2)->toISOString(),
            'ended_at' => now()->subHour()->toISOString(),
        ])->assertStatus(201)->assertJsonPath('entry.approval_status', 'approved')->json('entry.id');

        // The same manager widens their own entry — stays approved.
        $this->putJson("/api/v1/time-entries/{$entryId}", [
            'started_at' => now()->subHours(3)->toISOString(),
            'ended_at' => now()->subHour()->toISOString(),
        ])->assertOk();

        $entry = TimeEntry::findOrFail($entryId);
        $this->assertEquals('approved', $entry->approval_status);
        $this->assertTrue($entry->is_approved);
        $this->assertEquals(7200, $entry->duration_seconds);
    }

    public function test_editing_tracked_entry_does_not_touch_approval_status(): void
    {
        // Tracked entries are outside the approval workflow — an edit must not
        // flip approval_status (they default to 'approved').
        $entry = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'type' => 'tracked',
            'approval_status' => 'approved',
            'is_approved' => true,
            'started_at' => now()->subHours(2),
            'ended_at' => now()->subHour(),
            'duration_seconds' => 3600,
        ]);

        $this->actingAs($this->employee, 'sanctum');
        $this->putJson("/api/v1/time-entries/{$entry->id}", [
            'started_at' => now()->subHours(4)->toISOString(),
            'ended_at' => now()->subHour()->toISOString(),
        ])->assertOk();

        $entry->refresh();
        $this->assertEquals('approved', $entry->approval_status);
        $this->assertTrue($entry->is_approved);
        $this->assertEquals(10800, $entry->duration_seconds);
    }

    public function test_destroy_of_approved_manual_entry_succeeds_and_flushes_report_cache(): void
    {
        $entry = TimeEntry::factory()->manual()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'submitted_by' => $this->employee->id,
            'approval_status' => 'approved',
            'is_approved' => true,
            'started_at' => now()->subHours(2),
            'ended_at' => now()->subHour(),
            'duration_seconds' => 3600,
        ]);

        $verKey = "report_ver:{$this->org->id}";
        $verBefore = (int) \Illuminate\Support\Facades\Cache::get($verKey, 0);

        $this->actingAs($this->owner, 'sanctum');
        $this->deleteJson("/api/v1/time-entries/{$entry->id}")
            ->assertOk()
            ->assertJsonPath('message', 'Time entry deleted.');

        $this->assertSoftDeleted('time_entries', ['id' => $entry->id]);
        // destroy() of an approved entry must bust the org report cache (LOW 1).
        $this->assertGreaterThan($verBefore, (int) \Illuminate\Support\Facades\Cache::get($verKey, 0));
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    /**
     * Live org aggregate over an all-time window (uncached path via version bump).
     */
    private function orgSummarySeconds(): int
    {
        $summary = app(\App\Services\ReportService::class)->summary(
            $this->org->id,
            null,
            '2000-01-01 00:00:00',
            '2100-01-01 00:00:00'
        );

        return (int) $summary['total_seconds'];
    }


    /**
     * Create a pending manual entry for a user (submitted by $submitter).
     */
    private function makePending(User $user, User $submitter, ?Organization $org = null): TimeEntry
    {
        return TimeEntry::factory()->manual()->create([
            'organization_id' => ($org ?? $this->org)->id,
            'user_id' => $user->id,
            'submitted_by' => $submitter->id,
            'approval_status' => 'pending',
            'is_approved' => false,
            'started_at' => now()->subHours(3),
            'ended_at' => now()->subHours(2),
            'duration_seconds' => 3600,
        ]);
    }

    /**
     * Build a user holding a custom role with the given permission scopes, made
     * the manager of $project so its members fall inside their project scope.
     *
     * @param array<string,string> $scopes  permission key => scope
     */
    private function makeScopedApprover(array $scopes, Project $project): User
    {
        $user = $this->createUser($this->org, 'employee');

        $roleId = (string) Str::uuid();
        DB::table('roles')->insert([
            'id' => $roleId,
            'organization_id' => $this->org->id,
            'name' => 'project_lead_' . Str::random(6),
            'display_name' => 'Project Lead',
            'is_system' => false,
            'is_default' => false,
            'priority' => 50,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        foreach ($scopes as $key => $scope) {
            $permId = DB::table('permissions')->where('key', $key)->value('id');
            DB::table('role_permissions')->insert([
                'id' => (string) Str::uuid(),
                'role_id' => $roleId,
                'permission_id' => $permId,
                'scope' => $scope,
                'created_at' => now(),
            ]);
        }

        DB::table('user_roles')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $user->id,
            'role_id' => $roleId,
            'assigned_by' => null,
            'assigned_at' => now(),
        ]);

        DB::table('projects')->where('id', $project->id)->update(['manager_id' => $user->id]);

        return $user->fresh();
    }
}
