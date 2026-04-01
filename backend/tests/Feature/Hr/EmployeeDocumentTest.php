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

    // ── Upload Validation ───────────────────────────────

    public function test_upload_rejects_invalid_mime_type(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'admin');
        $employee = $this->createUser($org, 'employee');

        $this->actingAs($admin, 'sanctum');

        $file = UploadedFile::fake()->create('malware.exe', 1024, 'application/x-msdownload');

        $response = $this->postJson("/api/v1/hr/employees/{$employee->id}/documents", [
            'title' => 'Suspicious File',
            'category' => 'other',
            'file' => $file,
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['file']);
    }

    public function test_upload_rejects_oversized_file(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'admin');
        $employee = $this->createUser($org, 'employee');

        $this->actingAs($admin, 'sanctum');

        // 11 MB file — max is 10240 KB (10 MB)
        $file = UploadedFile::fake()->create('large.pdf', 11264, 'application/pdf');

        $response = $this->postJson("/api/v1/hr/employees/{$employee->id}/documents", [
            'title' => 'Large File',
            'category' => 'contract',
            'file' => $file,
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['file']);
    }

    // ── Category Filter ─────────────────────────────────

    public function test_document_category_filter_works(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'admin');
        $employee = $this->createUser($org, 'employee');

        EmployeeDocument::factory()->count(2)->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'category' => 'id_proof',
        ]);
        EmployeeDocument::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'category' => 'education',
        ]);

        $this->actingAs($admin, 'sanctum');

        $response = $this->getJson("/api/v1/hr/employees/{$employee->id}/documents?category=id_proof");

        $response->assertOk();
        $this->assertEquals(2, $response->json('total'));

        $categories = collect($response->json('data'))->pluck('category')->unique()->toArray();
        $this->assertEquals(['id_proof'], $categories);
    }

    // ── Cross-Org Isolation ─────────────────────────────

    public function test_cross_org_document_isolation(): void
    {
        $orgA = $this->createOrganization();
        $orgB = $this->createOrganization();

        $adminA = $this->createUser($orgA, 'admin');
        $employeeB = $this->createUser($orgB, 'employee');

        EmployeeDocument::factory()->create([
            'organization_id' => $orgB->id,
            'user_id' => $employeeB->id,
        ]);

        $this->actingAs($adminA, 'sanctum');

        // Trying to list documents for an employee in another org should 404
        $response = $this->getJson("/api/v1/hr/employees/{$employeeB->id}/documents");

        $response->assertStatus(404);
    }

    // ── Verify Endpoint Sets Fields Correctly ───────────

    public function test_verify_sets_verified_at_timestamp(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'admin');
        $employee = $this->createUser($org, 'employee');

        $doc = EmployeeDocument::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'is_verified' => false,
            'verified_by' => null,
            'verified_at' => null,
        ]);

        $this->actingAs($admin, 'sanctum');

        $response = $this->putJson("/api/v1/hr/employees/{$employee->id}/documents/{$doc->id}/verify");

        $response->assertOk()
            ->assertJsonPath('data.is_verified', true)
            ->assertJsonPath('data.verified_by', $admin->id);

        $this->assertDatabaseHas('employee_documents', [
            'id' => $doc->id,
            'is_verified' => true,
            'verified_by' => $admin->id,
        ]);

        // Confirm verified_at was set (not null)
        $doc->refresh();
        $this->assertNotNull($doc->verified_at);
    }
}
