<?php

namespace Tests\Feature\Hr;

use App\Models\EmployeeNote;
use Tests\TestCase;

class EmployeeNoteTest extends TestCase
{
    public function test_admin_can_list_notes(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'admin');
        $employee = $this->createUser($org, 'employee');

        EmployeeNote::factory()->count(3)->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'author_id' => $admin->id,
        ]);

        $this->actingAs($admin, 'sanctum');

        $response = $this->getJson("/api/v1/hr/employees/{$employee->id}/notes");

        $response->assertOk()
            ->assertJsonStructure([
                'data' => [['id', 'content', 'is_confidential', 'author']],
                'current_page',
                'total',
            ]);

        $this->assertEquals(3, $response->json('total'));
    }

    public function test_employee_cannot_list_notes(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');

        $this->actingAs($employee, 'sanctum');

        $response = $this->getJson("/api/v1/hr/employees/{$employee->id}/notes");

        $response->assertStatus(403);
    }

    public function test_admin_can_create_note(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'admin');
        $employee = $this->createUser($org, 'employee');

        $this->actingAs($admin, 'sanctum');

        $response = $this->postJson("/api/v1/hr/employees/{$employee->id}/notes", [
            'content' => 'Great performance this quarter.',
            'is_confidential' => false,
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('data.content', 'Great performance this quarter.')
            ->assertJsonPath('data.is_confidential', false)
            ->assertJsonPath('data.author.id', $admin->id);

        $this->assertDatabaseHas('employee_notes', [
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'author_id' => $admin->id,
            'content' => 'Great performance this quarter.',
        ]);
    }

    public function test_employee_cannot_create_note(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');

        $this->actingAs($employee, 'sanctum');

        $response = $this->postJson("/api/v1/hr/employees/{$employee->id}/notes", [
            'content' => 'I want to note something.',
        ]);

        $response->assertStatus(403);
    }
}
