<?php

namespace Tests\Feature\Auth;

use App\Models\Invitation;
use App\Models\Organization;
use App\Models\Project;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Support\Str;
use Tests\TestCase;

class CrossTenantTest extends TestCase
{
    private Organization $orgA;
    private Organization $orgB;
    private User $userA;
    private User $userB;

    protected function setUp(): void
    {
        parent::setUp();

        $this->orgA = Organization::factory()->create(['name' => 'Org A']);
        $this->orgB = Organization::factory()->create(['name' => 'Org B']);
        $this->userA = User::factory()->create([
            'organization_id' => $this->orgA->id,
            'role' => 'owner',
        ]);
        $this->userB = User::factory()->create([
            'organization_id' => $this->orgB->id,
            'role' => 'owner',
        ]);
    }

    public function test_user_cannot_access_other_org_screenshots(): void
    {
        $screenshot = \App\Models\Screenshot::factory()->create([
            'organization_id' => $this->orgB->id,
            'user_id' => $this->userB->id,
        ]);

        $this->actingAs($this->userA, 'sanctum');

        $response = $this->deleteJson("/api/v1/screenshots/{$screenshot->id}");
        // 404 is correct: org-scoped query doesn't find cross-tenant resources
        $this->assertContains($response->status(), [403, 404]);
    }

    public function test_user_cannot_access_other_org_timesheets(): void
    {
        $timesheet = \App\Models\Timesheet::factory()->create([
            'organization_id' => $this->orgB->id,
            'user_id' => $this->userB->id,
        ]);

        $this->actingAs($this->userA, 'sanctum');

        $response = $this->postJson("/api/v1/timesheets/{$timesheet->id}/review", [
            'action' => 'approve',
        ]);

        // 404 is correct: org-scoped query doesn't find cross-tenant resources
        $this->assertContains($response->status(), [403, 404]);
    }

    public function test_user_cannot_see_other_org_projects(): void
    {
        $projectB = Project::factory()->create([
            'organization_id' => $this->orgB->id,
            'created_by' => $this->userB->id,
        ]);

        $this->actingAs($this->userA, 'sanctum');

        // GlobalOrganizationScope should filter out orgB's projects
        $projects = Project::all();
        $this->assertTrue($projects->where('id', $projectB->id)->isEmpty());
    }

    public function test_global_organization_scope_filters_queries(): void
    {
        // Create time entries in both orgs
        TimeEntry::factory()->create([
            'organization_id' => $this->orgA->id,
            'user_id' => $this->userA->id,
        ]);
        TimeEntry::factory()->create([
            'organization_id' => $this->orgB->id,
            'user_id' => $this->userB->id,
        ]);

        $this->actingAs($this->userA, 'sanctum');

        $entries = TimeEntry::all();
        foreach ($entries as $entry) {
            $this->assertEquals($this->orgA->id, $entry->organization_id);
        }
    }

    public function test_can_bypass_scope_with_withoutGlobalScopes(): void
    {
        TimeEntry::factory()->create([
            'organization_id' => $this->orgA->id,
            'user_id' => $this->userA->id,
        ]);
        TimeEntry::factory()->create([
            'organization_id' => $this->orgB->id,
            'user_id' => $this->userB->id,
        ]);

        $this->actingAs($this->userA, 'sanctum');

        $allEntries = TimeEntry::withoutGlobalScopes()->get();
        $this->assertEquals(2, $allEntries->count());
    }
}
