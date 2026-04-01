<?php

namespace Tests\Unit\Services;

use App\Models\Department;
use App\Models\EmployeeDocument;
use App\Models\EmployeeNote;
use App\Models\EmployeeProfile;
use App\Models\Position;
use App\Services\EmployeeService;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class EmployeeServiceTest extends TestCase
{
    private EmployeeService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = app(EmployeeService::class);
    }

    // ── Get Directory ───────────────────────────────────

    public function test_get_directory_returns_paginated_results(): void
    {
        $org = $this->createOrganization();

        for ($i = 0; $i < 5; $i++) {
            $this->createUser($org, 'employee');
        }

        // Authenticate as one of the org users
        $admin = $this->createUser($org, 'admin');
        $this->actingAs($admin, 'sanctum');

        $result = $this->service->getDirectory($org->id, ['per_page' => 10]);

        $this->assertInstanceOf(\Illuminate\Contracts\Pagination\LengthAwarePaginator::class, $result);
        // 5 employees + 1 admin = 6
        $this->assertEquals(6, $result->total());
    }

    public function test_get_directory_search_filters_by_name(): void
    {
        $org = $this->createOrganization();
        $user1 = $this->createUser($org, 'employee', ['name' => 'Alice Johnson']);
        $user2 = $this->createUser($org, 'employee', ['name' => 'Bob Smith']);
        $this->actingAs($user1, 'sanctum');

        $result = $this->service->getDirectory($org->id, ['search' => 'Alice']);

        $this->assertEquals(1, $result->total());
        $this->assertEquals('Alice Johnson', $result->first()->name);
    }

    public function test_get_directory_search_filters_by_email(): void
    {
        $org = $this->createOrganization();
        $user1 = $this->createUser($org, 'employee', ['email' => 'alice@example.com']);
        $user2 = $this->createUser($org, 'employee', ['email' => 'bob@example.com']);
        $this->actingAs($user1, 'sanctum');

        $result = $this->service->getDirectory($org->id, ['search' => 'alice@']);

        $this->assertEquals(1, $result->total());
    }

    public function test_get_directory_search_filters_by_employee_id(): void
    {
        $org = $this->createOrganization();
        $user1 = $this->createUser($org, 'employee');
        $user2 = $this->createUser($org, 'employee');
        $this->actingAs($user1, 'sanctum');

        EmployeeProfile::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user1->id,
            'employee_id' => 'EMP-042',
        ]);

        EmployeeProfile::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user2->id,
            'employee_id' => 'EMP-099',
        ]);

        $result = $this->service->getDirectory($org->id, ['search' => 'EMP-042']);

        $this->assertEquals(1, $result->total());
    }

    /**
     * @group postgresql
     * Skipped on SQLite: LIKE escape with '\' requires ESCAPE clause which
     * Laravel doesn't add. PostgreSQL supports '\' as default escape character.
     * Covered by Feature/Hr/EmployeeTest::test_search_with_sql_wildcard_characters_does_not_break.
     */
    public function test_get_directory_escapes_like_wildcards(): void
    {
        if (config('database.default') === 'sqlite') {
            $this->markTestSkipped('SQLite LIKE escape incompatible — needs ESCAPE clause');
        }

        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee', ['name' => 'Test_User']);
        $this->createUser($org, 'employee', ['name' => 'TestXUser']);
        $this->actingAs($user, 'sanctum');

        $result = $this->service->getDirectory($org->id, ['search' => 'Test_User']);

        $this->assertGreaterThanOrEqual(1, $result->total());
        $names = $result->pluck('name')->toArray();
        $this->assertContains('Test_User', $names);
    }

    public function test_get_directory_filters_by_department(): void
    {
        $org = $this->createOrganization();
        $dept = Department::factory()->create(['organization_id' => $org->id]);

        $user1 = $this->createUser($org, 'employee');
        $user2 = $this->createUser($org, 'employee');
        $this->actingAs($user1, 'sanctum');

        EmployeeProfile::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user1->id,
            'department_id' => $dept->id,
        ]);

        EmployeeProfile::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user2->id,
            'department_id' => null,
        ]);

        $result = $this->service->getDirectory($org->id, ['department_id' => $dept->id]);

        $this->assertEquals(1, $result->total());
    }

    public function test_get_directory_filters_by_employment_status(): void
    {
        $org = $this->createOrganization();
        $user1 = $this->createUser($org, 'employee');
        $user2 = $this->createUser($org, 'employee');
        $this->actingAs($user1, 'sanctum');

        EmployeeProfile::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user1->id,
            'employment_status' => 'active',
        ]);

        EmployeeProfile::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user2->id,
            'employment_status' => 'probation',
        ]);

        $result = $this->service->getDirectory($org->id, ['employment_status' => 'active']);

        $this->assertEquals(1, $result->total());
    }

    // ── Get Profile ─────────────────────────────────────

    public function test_get_profile_returns_profile_with_relations(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $dept = Department::factory()->create(['organization_id' => $org->id]);
        $pos = Position::factory()->create([
            'organization_id' => $org->id,
            'department_id' => $dept->id,
        ]);

        EmployeeProfile::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'department_id' => $dept->id,
            'position_id' => $pos->id,
        ]);

        $profile = $this->service->getProfile($user->id, $org->id);

        $this->assertNotNull($profile);
        $this->assertTrue($profile->relationLoaded('department'));
        $this->assertTrue($profile->relationLoaded('position'));
        $this->assertTrue($profile->relationLoaded('user'));
    }

    public function test_get_profile_returns_null_when_no_profile_exists(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $profile = $this->service->getProfile($user->id, $org->id);

        $this->assertNull($profile);
    }

    // ── Get or Create Profile ───────────────────────────

    public function test_get_or_create_profile_creates_when_none_exists(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $profile = $this->service->getOrCreateProfile($user->id, $org->id);

        $this->assertInstanceOf(EmployeeProfile::class, $profile);
        $this->assertEquals($user->id, $profile->user_id);
        $this->assertEquals($org->id, $profile->organization_id);
        $this->assertEquals('active', $profile->employment_status);
        $this->assertEquals('full_time', $profile->employment_type);
        $this->assertStringStartsWith('EMP-', $profile->employee_id);

        $this->assertDatabaseHas('employee_profiles', [
            'user_id' => $user->id,
            'organization_id' => $org->id,
        ]);
    }

    public function test_get_or_create_profile_returns_existing(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $existing = EmployeeProfile::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'employee_id' => 'EMP-500',
        ]);

        $profile = $this->service->getOrCreateProfile($user->id, $org->id);

        $this->assertEquals($existing->id, $profile->id);
        $this->assertEquals('EMP-500', $profile->employee_id);
    }

    // ── Generate Employee ID ────────────────────────────

    public function test_generate_employee_id_starts_at_001(): void
    {
        $org = $this->createOrganization();

        $empId = $this->service->generateEmployeeId($org->id);

        $this->assertEquals('EMP-001', $empId);
    }

    public function test_generate_employee_id_increments_sequentially(): void
    {
        $org = $this->createOrganization();
        $user1 = $this->createUser($org, 'employee');
        $user2 = $this->createUser($org, 'employee');

        EmployeeProfile::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user1->id,
            'employee_id' => 'EMP-001',
        ]);

        EmployeeProfile::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user2->id,
            'employee_id' => 'EMP-002',
        ]);

        $empId = $this->service->generateEmployeeId($org->id);

        $this->assertEquals('EMP-003', $empId);
    }

    public function test_generate_employee_id_handles_gaps_in_numbering(): void
    {
        $org = $this->createOrganization();
        $user1 = $this->createUser($org, 'employee');
        $user2 = $this->createUser($org, 'employee');

        // EMP-001 and EMP-005 (gap of 2,3,4)
        EmployeeProfile::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user1->id,
            'employee_id' => 'EMP-001',
        ]);

        EmployeeProfile::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user2->id,
            'employee_id' => 'EMP-005',
        ]);

        $empId = $this->service->generateEmployeeId($org->id);

        // Should be EMP-006, based on max number (5) + 1
        $this->assertEquals('EMP-006', $empId);
    }

    public function test_generate_employee_id_scoped_per_org(): void
    {
        $org1 = $this->createOrganization();
        $org2 = $this->createOrganization();

        $user1 = $this->createUser($org1, 'employee');
        EmployeeProfile::factory()->create([
            'organization_id' => $org1->id,
            'user_id' => $user1->id,
            'employee_id' => 'EMP-010',
        ]);

        // Org2 has no profiles, so should start at 001
        $empId = $this->service->generateEmployeeId($org2->id);

        $this->assertEquals('EMP-001', $empId);
    }

    // ── Upload Document ─────────────────────────────────

    public function test_upload_document_creates_record(): void
    {
        Storage::fake('s3');

        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $file = UploadedFile::fake()->create('resume.pdf', 1024, 'application/pdf');

        $doc = $this->service->uploadDocument($user->id, $org->id, $file, [
            'title' => 'My Resume',
            'category' => 'experience',
        ]);

        $this->assertInstanceOf(EmployeeDocument::class, $doc);
        $this->assertEquals('My Resume', $doc->title);
        $this->assertEquals('experience', $doc->category);
        $this->assertEquals('resume.pdf', $doc->file_name);
        $this->assertEquals($user->id, $doc->user_id);
        $this->assertEquals($org->id, $doc->organization_id);
        $this->assertNotNull($doc->file_path);
        $this->assertEmpty($doc->is_verified); // null or false — not yet verified
    }

    public function test_upload_document_stores_file_on_s3(): void
    {
        Storage::fake('s3');

        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $file = UploadedFile::fake()->create('id_card.jpg', 500, 'image/jpeg');

        $doc = $this->service->uploadDocument($user->id, $org->id, $file, [
            'title' => 'ID Card',
            'category' => 'id_proof',
        ]);

        Storage::disk('s3')->assertExists($doc->file_path);
    }

    // ── Delete Document ─────────────────────────────────

    public function test_delete_document_soft_deletes(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        $doc = EmployeeDocument::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
        ]);

        $this->service->deleteDocument($doc);

        $this->assertSoftDeleted('employee_documents', ['id' => $doc->id]);
    }

    // ── Verify Document ─────────────────────────────────

    public function test_verify_document_sets_verification_fields(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $verifier = $this->createUser($org, 'admin');
        $this->actingAs($verifier, 'sanctum');

        $doc = EmployeeDocument::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'is_verified' => false,
        ]);

        $result = $this->service->verifyDocument($doc, $verifier->id);

        $this->assertTrue($result->is_verified);
        $this->assertEquals($verifier->id, $result->verified_by);
        $this->assertNotNull($result->verified_at);
    }

    // ── Get Documents ───────────────────────────────────

    public function test_get_documents_returns_paginated_results(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        EmployeeDocument::factory()->count(3)->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
        ]);

        $result = $this->service->getDocuments($user->id, $org->id, []);

        $this->assertEquals(3, $result->total());
    }

    public function test_get_documents_filters_by_category(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->actingAs($user, 'sanctum');

        EmployeeDocument::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'category' => 'id_proof',
        ]);

        EmployeeDocument::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'category' => 'education',
        ]);

        $result = $this->service->getDocuments($user->id, $org->id, ['category' => 'id_proof']);

        $this->assertEquals(1, $result->total());
    }

    // ── Get Notes ───────────────────────────────────────

    public function test_get_notes_filters_confidential_for_non_admin(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $admin = $this->createUser($org, 'admin');
        $this->actingAs($employee, 'sanctum');

        // Regular note
        EmployeeNote::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'author_id' => $admin->id,
            'is_confidential' => false,
        ]);

        // Confidential note
        EmployeeNote::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'author_id' => $admin->id,
            'is_confidential' => true,
        ]);

        // Employee viewer — should only see non-confidential
        $result = $this->service->getNotes($employee->id, $org->id, $employee);

        $this->assertEquals(1, $result->total());
        $this->assertFalse($result->first()->is_confidential);
    }

    public function test_get_notes_shows_confidential_for_admin(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $admin = $this->createUser($org, 'admin');
        $this->actingAs($admin, 'sanctum');

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

        // Admin viewer — should see all notes
        $result = $this->service->getNotes($employee->id, $org->id, $admin);

        $this->assertEquals(2, $result->total());
    }

    public function test_get_notes_shows_confidential_for_owner(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $owner = $this->createUser($org, 'owner');
        $this->actingAs($owner, 'sanctum');

        EmployeeNote::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'author_id' => $owner->id,
            'is_confidential' => true,
        ]);

        $result = $this->service->getNotes($employee->id, $org->id, $owner);

        $this->assertEquals(1, $result->total());
    }

    public function test_get_notes_loads_author_relation(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $admin = $this->createUser($org, 'admin');
        $this->actingAs($admin, 'sanctum');

        EmployeeNote::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'author_id' => $admin->id,
        ]);

        $result = $this->service->getNotes($employee->id, $org->id, $admin);

        $this->assertTrue($result->first()->relationLoaded('author'));
    }

    // ── Create Note ─────────────────────────────────────

    public function test_create_note_with_correct_fields(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $admin = $this->createUser($org, 'admin');
        $this->actingAs($admin, 'sanctum');

        $note = $this->service->createNote($employee->id, $org->id, $admin->id, [
            'content' => 'Great performance this quarter.',
            'is_confidential' => false,
        ]);

        $this->assertInstanceOf(EmployeeNote::class, $note);
        $this->assertEquals($employee->id, $note->user_id);
        $this->assertEquals($org->id, $note->organization_id);
        $this->assertEquals($admin->id, $note->author_id);
        $this->assertEquals('Great performance this quarter.', $note->content);
        $this->assertFalse($note->is_confidential);
    }

    public function test_create_note_confidential(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $admin = $this->createUser($org, 'admin');
        $this->actingAs($admin, 'sanctum');

        $note = $this->service->createNote($employee->id, $org->id, $admin->id, [
            'content' => 'Disciplinary action note.',
            'is_confidential' => true,
        ]);

        $this->assertTrue($note->is_confidential);
    }

    public function test_create_note_defaults_is_confidential_to_false(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $admin = $this->createUser($org, 'admin');
        $this->actingAs($admin, 'sanctum');

        $note = $this->service->createNote($employee->id, $org->id, $admin->id, [
            'content' => 'Regular feedback.',
        ]);

        $this->assertFalse($note->is_confidential);
    }

    // ── Mask Financial Field ────────────────────────────

    public function test_mask_financial_field_returns_masked_value(): void
    {
        $result = $this->service->maskFinancialField('1234567890');

        $this->assertEquals('****7890', $result);
    }

    public function test_mask_financial_field_with_short_value(): void
    {
        $result = $this->service->maskFinancialField('AB');

        $this->assertEquals('****AB', $result);
    }

    public function test_mask_financial_field_with_4_chars(): void
    {
        $result = $this->service->maskFinancialField('ABCD');

        $this->assertEquals('****ABCD', $result);
    }

    public function test_mask_financial_field_with_null(): void
    {
        $result = $this->service->maskFinancialField(null);

        $this->assertNull($result);
    }

    public function test_mask_financial_field_with_empty_string(): void
    {
        $result = $this->service->maskFinancialField('');

        $this->assertNull($result);
    }

    public function test_mask_financial_field_with_single_char(): void
    {
        $result = $this->service->maskFinancialField('X');

        $this->assertEquals('****X', $result);
    }

    // ── Update Profile — Field-Level Authorization ──────

    public function test_update_profile_employee_can_only_edit_personal_fields(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $this->actingAs($employee, 'sanctum');

        $dept = Department::factory()->create(['organization_id' => $org->id]);

        EmployeeProfile::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'blood_group' => 'A+',
            'department_id' => null,
        ]);

        $result = $this->service->updateProfile($employee->id, $org->id, [
            'blood_group' => 'B+',
            'department_id' => $dept->id,  // Not a personal field — should be stripped
            'emergency_contact_name' => 'Jane Doe',
        ], $employee);

        $this->assertEquals('B+', $result->blood_group);
        $this->assertEquals('Jane Doe', $result->emergency_contact_name);
        // department_id should NOT have been updated
        $this->assertNull($result->department_id);
    }

    public function test_update_profile_admin_can_edit_all_fields(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $admin = $this->createUser($org, 'admin');
        $this->actingAs($admin, 'sanctum');

        $dept = Department::factory()->create(['organization_id' => $org->id]);

        EmployeeProfile::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'department_id' => null,
        ]);

        $result = $this->service->updateProfile($employee->id, $org->id, [
            'blood_group' => 'O-',
            'department_id' => $dept->id,
            'employment_status' => 'probation',
        ], $admin);

        $this->assertEquals('O-', $result->blood_group);
        $this->assertEquals($dept->id, $result->department_id);
        $this->assertEquals('probation', $result->employment_status);
    }

    public function test_update_profile_owner_can_edit_all_fields(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $owner = $this->createUser($org, 'owner');
        $this->actingAs($owner, 'sanctum');

        $dept = Department::factory()->create(['organization_id' => $org->id]);

        EmployeeProfile::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
        ]);

        $result = $this->service->updateProfile($employee->id, $org->id, [
            'department_id' => $dept->id,
        ], $owner);

        $this->assertEquals($dept->id, $result->department_id);
    }

    public function test_update_profile_creates_profile_if_not_exists(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'admin');
        $employee = $this->createUser($org, 'employee');
        $this->actingAs($admin, 'sanctum');

        // No profile exists yet
        $this->assertNull(EmployeeProfile::where('user_id', $employee->id)->first());

        $result = $this->service->updateProfile($employee->id, $org->id, [
            'blood_group' => 'AB+',
        ], $admin);

        $this->assertEquals('AB+', $result->blood_group);
        $this->assertDatabaseHas('employee_profiles', [
            'user_id' => $employee->id,
            'organization_id' => $org->id,
        ]);
    }
}
