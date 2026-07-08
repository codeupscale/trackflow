<?php

namespace Tests\Feature\Api;

use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Tests\TestCase;

class UserProjectFilterTest extends TestCase
{
    private Organization $org;
    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->org = $this->createOrganization();
        $this->owner = $this->createUser($this->org, 'owner');
    }

    public function test_filters_users_to_members_of_the_given_project(): void
    {
        $memberA = $this->createUser($this->org, 'employee');
        $memberB = $this->createUser($this->org, 'employee');
        $this->createUser($this->org, 'employee'); // unassigned

        $project = Project::factory()->create([
            'organization_id' => $this->org->id,
            'created_by' => $this->owner->id,
        ]);
        $project->members()->attach([$memberA->id, $memberB->id]);

        $this->actingAs($this->owner, 'sanctum');

        $response = $this->getJson('/api/v1/users?project_id[]=' . $project->id);
        $response->assertOk();

        $ids = collect($response->json('data'))->pluck('id')->all();
        sort($ids);
        $expected = [$memberA->id, $memberB->id];
        sort($expected);

        $this->assertEquals($expected, $ids);
    }

    public function test_accepts_single_project_id_and_dedupes_across_multiple_projects(): void
    {
        $member = $this->createUser($this->org, 'employee');

        $projectOne = Project::factory()->create([
            'organization_id' => $this->org->id,
            'created_by' => $this->owner->id,
        ]);
        $projectTwo = Project::factory()->create([
            'organization_id' => $this->org->id,
            'created_by' => $this->owner->id,
        ]);
        $projectOne->members()->attach($member->id);
        $projectTwo->members()->attach($member->id);

        $this->actingAs($this->owner, 'sanctum');

        // Single scalar project_id
        $single = $this->getJson('/api/v1/users?project_id=' . $projectOne->id);
        $single->assertOk();
        $this->assertEquals([$member->id], collect($single->json('data'))->pluck('id')->all());

        // Member on both projects appears exactly once (DISTINCT via EXISTS)
        $both = $this->getJson('/api/v1/users?project_id[]=' . $projectOne->id . '&project_id[]=' . $projectTwo->id);
        $both->assertOk();
        $memberRows = collect($both->json('data'))->where('id', $member->id);
        $this->assertCount(1, $memberRows);
    }

    public function test_cross_org_project_id_returns_empty_and_never_leaks(): void
    {
        $otherOrg = $this->createOrganization();
        $otherOwner = $this->createUser($otherOrg, 'owner');
        $otherMember = $this->createUser($otherOrg, 'employee');

        $otherProject = Project::factory()->create([
            'organization_id' => $otherOrg->id,
            'created_by' => $otherOwner->id,
        ]);
        $otherProject->members()->attach($otherMember->id);

        $this->actingAs($this->owner, 'sanctum');

        $response = $this->getJson('/api/v1/users?project_id[]=' . $otherProject->id);
        $response->assertOk();

        // Another org's project id resolves to no in-org projects -> empty result,
        // and never surfaces the other org's members.
        $this->assertCount(0, $response->json('data'));
    }

    public function test_missing_project_id_returns_unfiltered_org_scoped_list(): void
    {
        $memberA = $this->createUser($this->org, 'employee');
        $memberB = $this->createUser($this->org, 'employee');

        $project = Project::factory()->create([
            'organization_id' => $this->org->id,
            'created_by' => $this->owner->id,
        ]);
        $project->members()->attach($memberA->id);

        $this->actingAs($this->owner, 'sanctum');

        $response = $this->getJson('/api/v1/users');
        $response->assertOk();

        $ids = collect($response->json('data'))->pluck('id')->all();
        // owner + memberA + memberB, all org members regardless of project assignment
        $this->assertContains($this->owner->id, $ids);
        $this->assertContains($memberA->id, $ids);
        $this->assertContains($memberB->id, $ids);
        $this->assertCount(3, $ids);
    }

    public function test_invalid_project_id_is_rejected(): void
    {
        $this->actingAs($this->owner, 'sanctum');

        $response = $this->getJson('/api/v1/users?project_id[]=not-a-uuid');
        $response->assertStatus(422)
            ->assertJsonValidationErrors('project_id.0');
    }
}
