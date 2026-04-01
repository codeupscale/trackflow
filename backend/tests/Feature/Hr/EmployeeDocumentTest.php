<?php

namespace Tests\Feature\Hr;

use App\Models\EmployeeDocument;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class EmployeeDocumentTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('s3');
    }

    public function test_can_list_employee_documents(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'admin');
        $employee = $this->createUser($org, 'employee');

        EmployeeDocument::factory()->count(3)->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
        ]);

        $this->actingAs($admin, 'sanctum');

        $response = $this->getJson("/api/v1/hr/employees/{$employee->id}/documents");

        $response->assertOk()
            ->assertJsonStructure([
                'data' => [['id', 'title', 'category', 'file_name', 'is_verified']],
                'current_page',
                'total',
            ]);

        $this->assertEquals(3, $response->json('total'));
    }

    public function test_can_upload_document(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'admin');
        $employee = $this->createUser($org, 'employee');

        $this->actingAs($admin, 'sanctum');

        $file = UploadedFile::fake()->create('passport.pdf', 1024, 'application/pdf');

        $response = $this->postJson("/api/v1/hr/employees/{$employee->id}/documents", [
            'title' => 'Passport',
            'category' => 'id_proof',
            'file' => $file,
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('data.title', 'Passport')
            ->assertJsonPath('data.category', 'id_proof');

        $this->assertDatabaseHas('employee_documents', [
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'title' => 'Passport',
        ]);
    }

    public function test_admin_can_verify_document(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'admin');
        $employee = $this->createUser($org, 'employee');

        $doc = EmployeeDocument::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'is_verified' => false,
        ]);

        $this->actingAs($admin, 'sanctum');

        $response = $this->putJson("/api/v1/hr/employees/{$employee->id}/documents/{$doc->id}/verify");

        $response->assertOk()
            ->assertJsonPath('data.is_verified', true)
            ->assertJsonPath('data.verified_by', $admin->id);
    }

    public function test_employee_cannot_verify_document(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');

        $doc = EmployeeDocument::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'is_verified' => false,
        ]);

        $this->actingAs($employee, 'sanctum');

        $response = $this->putJson("/api/v1/hr/employees/{$employee->id}/documents/{$doc->id}/verify");

        $response->assertStatus(403);
    }

    public function test_admin_can_delete_document(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'admin');
        $employee = $this->createUser($org, 'employee');

        $doc = EmployeeDocument::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
        ]);

        $this->actingAs($admin, 'sanctum');

        $response = $this->deleteJson("/api/v1/hr/employees/{$employee->id}/documents/{$doc->id}");

        $response->assertOk()
            ->assertJsonPath('message', 'Document deleted.');

        // Soft deleted — still in DB but with deleted_at
        $this->assertSoftDeleted('employee_documents', ['id' => $doc->id]);
    }
}
