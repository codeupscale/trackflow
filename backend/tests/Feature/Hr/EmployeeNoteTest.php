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

    // ── Delete Notes ────────────────────────────────────

    public function test_admin_can_delete_own_note(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'admin');
        $employee = $this->createUser($org, 'employee');

        $note = EmployeeNote::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'author_id' => $admin->id,
        ]);

        $this->actingAs($admin, 'sanctum');

        $response = $this->deleteJson("/api/v1/hr/employees/{$employee->id}/notes/{$note->id}");

        $response->assertStatus(204);
    }

    public function test_admin_can_delete_other_admins_note(): void
    {
        $org = $this->createOrganization();
        $admin1 = $this->createUser($org, 'admin');
        $admin2 = $this->createUser($org, 'admin');
        $employee = $this->createUser($org, 'employee');

        $note = EmployeeNote::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'author_id' => $admin2->id,
        ]);

        $this->actingAs($admin1, 'sanctum');

        $response = $this->deleteJson("/api/v1/hr/employees/{$employee->id}/notes/{$note->id}");

        $response->assertStatus(204);
    }

    public function test_employee_cannot_delete_note(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'admin');
        $employee = $this->createUser($org, 'employee');

        $note = EmployeeNote::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'author_id' => $admin->id,
        ]);

        $this->actingAs($employee, 'sanctum');

        $response = $this->deleteJson("/api/v1/hr/employees/{$employee->id}/notes/{$note->id}");

        $response->assertStatus(403);
    }

    // ── Confidential Notes Filtering ────────────────────

    public function test_confidential_notes_visible_to_admin(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'admin');
        $employee = $this->createUser($org, 'employee');

        EmployeeNote::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'author_id' => $admin->id,
            'is_confidential' => false,
        ]);
        EmployeeNote::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'author_id' => $admin->id,
            'is_confidential' => true,
        ]);

        $this->actingAs($admin, 'sanctum');

        $response = $this->getJson("/api/v1/hr/employees/{$employee->id}/notes");

        $response->assertOk();
        // Admin should see both confidential and non-confidential notes
        $this->assertEquals(2, $response->json('total'));
    }

    public function test_confidential_notes_hidden_from_manager(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'admin');
        $manager = $this->createUser($org, 'manager');
        $employee = $this->createUser($org, 'employee');

        EmployeeNote::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'author_id' => $admin->id,
            'is_confidential' => false,
        ]);
        EmployeeNote::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'author_id' => $admin->id,
            'is_confidential' => true,
        ]);

        $this->actingAs($manager, 'sanctum');

        // Manager cannot view notes (admin/owner only via policy)
        $response = $this->getJson("/api/v1/hr/employees/{$employee->id}/notes");

        $response->assertStatus(403);
    }

    // ── Cross-Org Isolation ─────────────────────────────

    public function test_cross_org_note_isolation(): void
    {
        $orgA = $this->createOrganization();
        $orgB = $this->createOrganization();

        $adminA = $this->createUser($orgA, 'admin');
        $adminB = $this->createUser($orgB, 'admin');
        $employeeB = $this->createUser($orgB, 'employee');

        EmployeeNote::factory()->create([
            'organization_id' => $orgB->id,
            'user_id' => $employeeB->id,
            'author_id' => $adminB->id,
        ]);

        $this->actingAs($adminA, 'sanctum');

        // Trying to list notes for an employee in another org should 404
        $response = $this->getJson("/api/v1/hr/employees/{$employeeB->id}/notes");

        $response->assertStatus(404);
    }
}
