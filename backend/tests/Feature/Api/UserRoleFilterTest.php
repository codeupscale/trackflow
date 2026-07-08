<?php

namespace Tests\Feature\Api;

use App\Models\Organization;
use App\Models\User;
use Tests\TestCase;

class UserRoleFilterTest extends TestCase
{
    private Organization $org;
    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->org = $this->createOrganization();
        $this->owner = $this->createUser($this->org, 'owner');
    }

    public function test_filters_users_to_a_single_role(): void
    {
        $manager = $this->createUser($this->org, 'org_manager');
        $this->createUser($this->org, 'employee');

        $this->actingAs($this->owner, 'sanctum');

        $response = $this->getJson('/api/v1/users?role=org_manager');
        $response->assertOk();

        $ids = collect($response->json('data'))->pluck('id')->all();
        $this->assertSame([$manager->id], $ids);
    }

    public function test_filters_users_to_multiple_manager_roles(): void
    {
        $mgr = $this->createUser($this->org, 'org_manager');
        $hr = $this->createUser($this->org, 'hr_manager');
        $this->createUser($this->org, 'employee');

        $this->actingAs($this->owner, 'sanctum');

        $response = $this->getJson(
            '/api/v1/users?role[]=owner&role[]=org_manager&role[]=hr_manager&role[]=finance_manager'
        );
        $response->assertOk();

        $ids = collect($response->json('data'))->pluck('id')->sort()->values()->all();
        $expected = collect([$this->owner->id, $mgr->id, $hr->id])->sort()->values()->all();

        $this->assertSame($expected, $ids);
    }

    public function test_role_all_returns_unfiltered_org_list(): void
    {
        $employee = $this->createUser($this->org, 'employee');

        $this->actingAs($this->owner, 'sanctum');

        $response = $this->getJson('/api/v1/users?role=all');
        $response->assertOk();

        $ids = collect($response->json('data'))->pluck('id')->all();
        $this->assertContains($this->owner->id, $ids);
        $this->assertContains($employee->id, $ids);
    }
}
