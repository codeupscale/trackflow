<?php

namespace Tests\Feature\Screenshot;

use App\Models\Organization;
use App\Models\Screenshot;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
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
        // Also fake the default disk (may be 'local' in CI rather than 's3')
        $defaultDisk = config('filesystems.default', 'local');
        if ($defaultDisk !== 's3') {
            Storage::fake($defaultDisk);
        }

        $this->org = $this->createOrganization();
        $this->owner = $this->createUser($this->org, 'owner');
        $this->manager = $this->createUser($this->org, 'org_manager');
        $this->employee = $this->createUser($this->org, 'employee');

        $this->timeEntry = TimeEntry::factory()->running()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
        ]);
    }

    // ── Helper: complete presign → fake-upload → confirm flow ─────────────────

    private function presignAndConfirm(User $user, array $presignData = []): \Illuminate\Testing\TestResponse
    {
        $this->actingAs($user, 'sanctum');

        $presignResponse = $this->postJson('/api/v1/screenshots/presign', array_merge([
            'time_entry_id' => $this->timeEntry->id,
            'captured_at'   => now()->toDateTimeString(),
            'file_size'     => 500 * 1024,
        ], $presignData));

        if ($presignResponse->status() !== 200) {
            return $presignResponse;
        }

        $screenshotId = $presignResponse->json('screenshot_id');
        $screenshot = Screenshot::findOrFail($screenshotId);

        // Simulate the S3 PUT — use whichever disk the controller checks (may be 'local' in CI)
        $disk = config('filesystems.default', 'local');
        Storage::disk($disk)->put("screenshots/{$screenshot->s3_key}", UploadedFile::fake()->image('screenshot.jpg', 1920, 1080)->get());

        return $this->postJson('/api/v1/screenshots/confirm', ['screenshot_id' => $screenshotId]);
    }

    // ── Upload flow (presign → S3 PUT → confirm) ──────────────────────────────

    public function test_employee_can_upload_screenshot(): void
    {
        $response = $this->presignAndConfirm($this->employee);

        $response->assertStatus(201)
            ->assertJsonStructure(['screenshot' => ['id', 'user_id', 'organization_id', 's3_key']]);

        $this->assertDatabaseHas('screenshots', [
            'user_id'         => $this->employee->id,
            'organization_id' => $this->org->id,
            'status'          => 'confirmed',
        ]);
    }

    public function test_upload_requires_authentication(): void
    {
        $response = $this->postJson('/api/v1/screenshots/presign', [
            'time_entry_id' => $this->timeEntry->id,
            'captured_at'   => now()->toDateTimeString(),
            'file_size'     => 100 * 1024,
        ]);

        $response->assertStatus(401);
    }

    public function test_upload_validation_file_too_large(): void
    {
        $this->actingAs($this->employee, 'sanctum');

        $response = $this->postJson('/api/v1/screenshots/presign', [
            'time_entry_id' => $this->timeEntry->id,
            'captured_at'   => now()->toDateTimeString(),
            'file_size'     => 11 * 1024 * 1024, // 11 MB > 10 MB cap
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['file_size']);
    }

    public function test_confirm_fails_when_file_not_uploaded(): void
    {
        $this->actingAs($this->employee, 'sanctum');

        $presignResponse = $this->postJson('/api/v1/screenshots/presign', [
            'time_entry_id' => $this->timeEntry->id,
            'captured_at'   => now()->toDateTimeString(),
            'file_size'     => 100 * 1024,
        ]);

        $presignResponse->assertStatus(200);

        // Skip the S3 PUT step — confirm should reject
        $response = $this->postJson('/api/v1/screenshots/confirm', [
            'screenshot_id' => $presignResponse->json('screenshot_id'),
        ]);

        $response->assertStatus(422);
    }

    public function test_employee_can_only_see_own_screenshots(): void
    {
        if (DB::getDriverName() === 'sqlite') {
            $this->markTestSkipped('Screenshot index uses PostgreSQL EXTRACT(EPOCH FROM ...) syntax not supported by SQLite.');
        }

        $otherEmployee = $this->createUser($this->org, 'employee');

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
        if (DB::getDriverName() === 'sqlite') {
            $this->markTestSkipped('Screenshot index uses PostgreSQL EXTRACT(EPOCH FROM ...) syntax not supported by SQLite.');
        }

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
        if (DB::getDriverName() === 'sqlite') {
            $this->markTestSkipped('Screenshot index uses PostgreSQL EXTRACT(EPOCH FROM ...) syntax not supported by SQLite.');
        }

        Screenshot::factory()->count(3)->create([
            'organization_id' => $this->org->id,
        ]);

        $this->actingAs($this->owner, 'sanctum');

        $response = $this->getJson('/api/v1/screenshots');

        $response->assertOk();
        $screenshots = $response->json('data');
        $this->assertGreaterThanOrEqual(3, count($screenshots));
    }

    public function test_owner_cannot_delete_screenshot(): void
    {
        // Screenshot deletion is disabled system-wide — not even an owner may delete.
        $screenshot = Screenshot::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
        ]);

        $this->actingAs($this->owner, 'sanctum');

        $response = $this->deleteJson("/api/v1/screenshots/{$screenshot->id}");

        $response->assertStatus(403);
        $this->assertNotSoftDeleted('screenshots', ['id' => $screenshot->id]);
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
        $otherOrg = $this->createOrganization();
        $otherOwner = $this->createUser($otherOrg, 'owner');

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

        $response = $this->postJson('/api/v1/screenshots/presign', [
            'time_entry_id' => 'invalid-uuid',
            'captured_at'   => now()->toDateTimeString(),
            'file_size'     => 100 * 1024,
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['time_entry_id']);
    }

    public function test_screenshot_requires_captured_at_date(): void
    {
        $this->actingAs($this->employee, 'sanctum');

        $response = $this->postJson('/api/v1/screenshots/presign', [
            'time_entry_id' => $this->timeEntry->id,
            'file_size'     => 100 * 1024,
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['captured_at']);
    }

    // ── Offline backfill onto a closed entry ──────────────────────────────────
    // bugs/offline-screenshots-rejected-after-entry-closed.md
    //
    // A desktop that captured while offline flushes its queue only after reconnect —
    // by then the session is stopped and older than the 5-minute live grace. presign
    // used to reject that with 422, which the desktop queue treats as a PERMANENT
    // client error, so every screenshot from an offline session was dropped.

    public function test_presign_accepts_offline_backfill_for_a_closed_entry(): void
    {
        $this->actingAs($this->employee, 'sanctum');

        $closed = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id'         => $this->employee->id,
            'started_at'      => now()->subHours(4),
            'ended_at'        => now()->subHours(3),
            'duration_seconds' => 3600,
        ]);

        $response = $this->postJson('/api/v1/screenshots/presign', [
            'time_entry_id' => $closed->id,
            // Captured mid-session, uploaded 3 hours later once back online.
            'captured_at'   => now()->subHours(3)->subMinutes(20)->toIso8601String(),
            'file_size'     => 500 * 1024,
        ]);

        $response->assertStatus(200)->assertJsonStructure(['screenshot_id', 'upload_url']);
    }

    public function test_presign_rejects_a_capture_outside_the_closed_entry_window(): void
    {
        $this->actingAs($this->employee, 'sanctum');

        $closed = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id'         => $this->employee->id,
            'started_at'      => now()->subHours(4),
            'ended_at'        => now()->subHours(3),
            'duration_seconds' => 3600,
        ]);

        $response = $this->postJson('/api/v1/screenshots/presign', [
            'time_entry_id' => $closed->id,
            // An hour after the entry ended — not part of that session.
            'captured_at'   => now()->subHours(2)->toIso8601String(),
            'file_size'     => 500 * 1024,
        ]);

        $response->assertStatus(422);
    }

    public function test_presign_rejects_backfill_beyond_the_horizon(): void
    {
        $this->actingAs($this->employee, 'sanctum');

        $ancient = TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id'         => $this->employee->id,
            'started_at'      => now()->subDays(30),
            'ended_at'        => now()->subDays(30)->addHour(),
            'duration_seconds' => 3600,
        ]);

        $response = $this->postJson('/api/v1/screenshots/presign', [
            'time_entry_id' => $ancient->id,
            'captured_at'   => now()->subDays(30)->addMinutes(20)->toIso8601String(),
            'file_size'     => 500 * 1024,
        ]);

        $response->assertStatus(422);
    }

    public function test_presign_requires_file_size(): void
    {
        $this->actingAs($this->employee, 'sanctum');

        $response = $this->postJson('/api/v1/screenshots/presign', [
            'time_entry_id' => $this->timeEntry->id,
            'captured_at'   => now()->toDateTimeString(),
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['file_size']);
    }

    public function test_screenshot_filters_by_date_range(): void
    {
        if (DB::getDriverName() === 'sqlite') {
            $this->markTestSkipped('Screenshot index uses PostgreSQL EXTRACT(EPOCH FROM ...) syntax not supported by SQLite.');
        }

        // Pin the clock to a safe mid-day UTC instant (10:00 UTC = 15:00 PKT) before any
        // data setup. The test user's timezone is Asia/Karachi (UTC+5); when the suite runs
        // between 19:00–24:00 UTC the PKT "today" is a day ahead of the UTC clock, so the
        // UTC-serialized captured_at and the date-range filter land on different days and the
        // count assertion skews. A mid-day instant keeps both zones on the same calendar day.
        $this->travelTo(\Illuminate\Support\Carbon::create(2026, 7, 6, 10, 0, 0, 'UTC'));

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

        // API applies date filter only when both date_from and date_to are present
        $dateStr = $today->format('Y-m-d');
        $response = $this->getJson('/api/v1/screenshots?date_from=' . $dateStr . '&date_to=' . $dateStr);

        $response->assertOk();
        $screenshots = $response->json('data');
        $this->assertCount(1, $screenshots);
        $this->assertGreaterThanOrEqual($dateStr, substr($screenshots[0]['captured_at'], 0, 10));
    }
}
