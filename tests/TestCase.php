<?php

namespace Tests;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    use RefreshDatabase;

    protected function createOrganization(array $attributes = []): Organization
    {
        return Organization::factory()->create($attributes);
    }

    protected function createUser(Organization $org, string $role = 'employee', array $attributes = []): User
    {
        return User::factory()->create(array_merge([
            'organization_id' => $org->id,
            'role' => $role,
        ], $attributes));
    }

    protected function actingAsUser(string $role = 'owner', ?Organization $org = null): User
    {
        $org = $org ?? $this->createOrganization();
        $user = $this->createUser($org, $role);
        $this->actingAs($user, 'sanctum');
        return $user;
    }
}
