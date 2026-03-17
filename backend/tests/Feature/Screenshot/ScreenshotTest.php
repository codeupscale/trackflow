<?php

namespace Tests\Feature\Screenshot;

use App\Models\Organization;
use App\Models\Screenshot;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ScreenshotTest extends TestCase
{
    private Organization $org;
    private User $owner;
    private User $manager;
    private User $employee;
    private TimeEntry $timeEntry;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('s3');

        $this->org = Organization::factory()->create();
        $this->owner = User::factory()->create([
            'organization_id' => $this->org->id,
            'role' => 'owner',
        ]);
        $this->manager = User::factory()->create([
            'organization_id' => $this->org->id,
            'role' => 'manager',
        ]);
        $this->employee = User::factory()->create([
            'organization_id' => $this->org->id,
            'role' => 'employee',
        ]);

        $this->timeEntry = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
        ]);
    }

    public function test_employee_can_upload_screenshot(): void
    {
        $this->actingAs($this->employee, 'sanctum');

        $response = $this->postJson('/api/v1/screenshots', [
            'file' => UploadedFile::fake()->image('screenshot.jpg', 1920, 1080),
            'time_entry_id' => $this->timeEntry->id,
            'captured_at' => now()->toDateTimeString(),
        ]);

        $response->assertStatus(201)
            ->assertJsonStructure(['screenshot' => ['id', 'user_id', 'organization_id', 's3_key']]);

        $this->assertDatabaseHas('screenshots', [
            'user_id' => $this->employee->id,
            'organization_id' => $this->org->id,
        ]);
    }

    public function test_upload_requires_authentication(): void
    {
        $response = $this->postJson('/api/v1/screenshots', [
            'file' => UploadedFile::fake()->image('screenshot.jpg'),
            'time_entry_id' => $this->timeEntry->id,
            'captured_at' => now()->toDateTimeString(),
        ]);

        $response->assertStatus(401);
    }

    public function test_upload_validation_file_too_large(): void
    {
        $this->actingAs($this->employee, 'sanctum');

        $response = $this->postJson('/api/v1/screenshots', [
            'file' => UploadedFile::fake()->image('screenshot.jpg')->size(10000), // > 5120KB
            'time_entry_id' => $this->timeEntry->id,
            'captured_at' => now()->toDateTimeString(),
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['file']);
    }

    public function test_upload_validation_wrong_format(): void
    {
        $this->actingAs($this->employee, 'sanctum');

        $response = $this->postJson('/api/v1/screenshots', [
            'file' => UploadedFile::fake()->create('document.pdf', 100),
            'time_entry_id' => $this->timeEntry->id,
            'captured_at' => now()->toDateTimeString(),
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['file']);
    }

    public function test_employee_can_only_see_own_screenshots(): void
    {
        $otherEmployee = User::factory()->create([
            'organization_id' => $this->org->id,
            'role' => 'employee',
        ]);

        Screenshot::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
        ]);

        Screenshot::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $otherEmployee->id,
        ]);

        $this->actingAs($this->employee, 'sanctum');

        $response = $this->getJson('/api/v1/screenshots');

        $response->assertOk();
        $screenshots = $response->json('data');
        $this->assertEquals(1, count($screenshots));
        $this->assertEquals($this->employee->id, $screenshots[0]['user_id']);
    }

    public function test_manager_can_see_team_screenshots(): void
    {
        Screenshot::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
        ]);

        Screenshot::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->manager->id,
        ]);

        $this->actingAs($this->manager, 'sanctum');

        $response = $this->getJson('/api/v1/screenshots');

        $response->assertOk();
        $screenshots = $response->json('data');
        $this->assertGreaterThanOrEqual(1, count($screenshots));
    }

    public function test_owner_can_see_all_screenshots(): void
    {
        Screenshot::factory()->count(3)->create([
            'organization_id' => $this->org->id,
        ]);

        $this->actingAs($this->owner, 'sanctum');

        $response = $this->getJson('/api/v1/screenshots');

        $response->assertOk();
        $screenshots = $response->json('data');
        $this->assertGreaterThanOrEqual(3, count($screenshots));
    }

    public function test_owner_can_delete_screenshot(): void
    {
        $screenshot = Screenshot::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
        ]);

        $this->actingAs($this->owner, 'sanctum');

        $response = $this->deleteJson("/api/v1/screenshots/{$screenshot->id}");

        $response->assertOk();
        $this->assertSoftDeleted('screenshots', ['id' => $screenshot->id]);
    }

    public function test_employee_cannot_delete_own_screenshot(): void
    {
        $screenshot = Screenshot::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
        ]);

        $this->actingAs($this->employee, 'sanctum');

        $response = $this->deleteJson("/api/v1/screenshots/{$screenshot->id}");

        $response->assertStatus(403);
    }

    public function test_delete_screenshot_cross_tenant_forbidden(): void
    {
        $otherOrg = Organization::factory()->create();
        $otherOwner = User::factory()->create([
            'organization_id' => $otherOrg->id,
            'role' => 'owner',
        ]);

        $screenshot = Screenshot::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
        ]);

        $this->actingAs($otherOwner, 'sanctum');

        $response = $this->deleteJson("/api/v1/screenshots/{$screenshot->id}");

        // 404 is correct: org-scoped query doesn't find cross-tenant resources
        $this->assertContains($response->status(), [403, 404]);
    }

    public function test_screenshot_requires_valid_time_entry_id(): void
    {
        $this->actingAs($this->employee, 'sanctum');

        $response = $this->postJson('/api/v1/screenshots', [
            'file' => UploadedFile::fake()->image('screenshot.jpg'),
            'time_entry_id' => 'invalid-uuid',
            'captured_at' => now()->toDateTimeString(),
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['time_entry_id']);
    }

    public function test_screenshot_requires_captured_at_date(): void
    {
        $this->actingAs($this->employee, 'sanctum');

        $response = $this->postJson('/api/v1/screenshots', [
            'file' => UploadedFile::fake()->image('screenshot.jpg'),
            'time_entry_id' => $this->timeEntry->id,
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['captured_at']);
    }

    public function test_screenshot_filters_by_date_range(): void
    {
        $today = now();
        $yesterday = now()->subDay();

        Screenshot::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'captured_at' => $today,
        ]);

        Screenshot::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'captured_at' => $yesterday,
        ]);

        $this->actingAs($this->employee, 'sanctum');

        $response = $this->getJson('/api/v1/screenshots?date_from=' . $today->format('Y-m-d'));

        $response->assertOk();
        $screenshots = $response->json('data');
        foreach ($screenshots as $screenshot) {
            $this->assertGreaterThanOrEqual($today->format('Y-m-d'), substr($screenshot['captured_at'], 0, 10));
        }
    }
}
