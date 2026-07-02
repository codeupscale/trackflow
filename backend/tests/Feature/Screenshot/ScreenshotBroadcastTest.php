<?php

namespace Tests\Feature\Screenshot;

use App\Events\ScreenshotUploaded;
use App\Jobs\ProcessScreenshotJob;
use App\Models\ActivityLog;
use App\Models\Organization;
use App\Models\Screenshot;
use App\Models\TimeEntry;
use App\Models\User;
use App\Support\ScreenshotActivity;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ScreenshotBroadcastTest extends TestCase
{
    private Organization $org;
    private User $employee;
    private TimeEntry $timeEntry;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('s3');
        $defaultDisk = config('filesystems.default', 'local');
        if ($defaultDisk !== 's3') {
            Storage::fake($defaultDisk);
        }

        $this->org = $this->createOrganization();
        $this->employee = $this->createUser($this->org, 'employee');
        $this->timeEntry = TimeEntry::factory()->running()->create([
            'organization_id' => $this->org->id,
            'user_id'         => $this->employee->id,
        ]);
    }

    private function putFakeFile(Screenshot $screenshot): void
    {
        $disk = config('filesystems.default', 'local');
        Storage::disk($disk)->put(
            "screenshots/{$screenshot->s3_key}",
            UploadedFile::fake()->image('screenshot.jpg', 1280, 720)->get()
        );
    }

    // ── Issue 2: real-time broadcast ─────────────────────────────────────────

    public function test_confirm_dispatches_processing_job(): void
    {
        Bus::fake();

        $this->actingAs($this->employee, 'sanctum');

        $presign = $this->postJson('/api/v1/screenshots/presign', [
            'time_entry_id' => $this->timeEntry->id,
            'captured_at'   => now()->toDateTimeString(),
            'file_size'     => 200 * 1024,
        ]);
        $presign->assertStatus(200);

        $screenshot = Screenshot::findOrFail($presign->json('screenshot_id'));
        $this->putFakeFile($screenshot);

        $this->postJson('/api/v1/screenshots/confirm', ['screenshot_id' => $screenshot->id])
            ->assertStatus(201);

        Bus::assertDispatched(ProcessScreenshotJob::class);
    }

    public function test_processing_job_broadcasts_screenshot_uploaded_on_org_channel(): void
    {
        Event::fake([ScreenshotUploaded::class]);

        $screenshot = Screenshot::factory()->create([
            'organization_id'           => $this->org->id,
            'user_id'                   => $this->employee->id,
            'time_entry_id'             => $this->timeEntry->id,
            'status'                    => 'confirmed',
            'captured_at'               => now(),
            'activity_score_at_capture' => 62,
            's3_key'                    => "{$this->org->id}/{$this->employee->id}/2026-07-02/shot.jpg",
        ]);
        $this->putFakeFile($screenshot);

        (new ProcessScreenshotJob($screenshot))->handle();

        Event::assertDispatched(ScreenshotUploaded::class, function (ScreenshotUploaded $event) use ($screenshot) {
            $channels = $event->broadcastOn();
            $this->assertInstanceOf(PrivateChannel::class, $channels[0]);
            // Reverb/Echo channel name — frontend subscribes to `org.{orgId}`
            $this->assertSame('private-org.' . $this->org->id, (string) $channels[0]);

            $payload = $event->broadcastWith();

            // SECURITY (A01): the org-wide channel is visible to every role, so the
            // frame must carry ONLY non-sensitive routing identifiers. Assert the
            // exact minimal shape and that NO sensitive/capability fields leak.
            $this->assertSame(
                ['screenshot_id', 'user_id'],
                array_keys($payload)
            );
            $this->assertSame($screenshot->id, $payload['screenshot_id']);
            $this->assertSame($this->employee->id, $payload['user_id']);

            foreach ([
                'thumbnail_url', 'url', 'original_url', 'window_title', 'app_name',
                'activity_score', 'keyboard_events', 'mouse_events', 'project_name',
                'user_name', 'user_avatar_color', 'captured_at', 'status',
            ] as $forbidden) {
                $this->assertArrayNotHasKey($forbidden, $payload, "$forbidden must not be broadcast");
            }

            return $event->screenshot->id === $screenshot->id;
        });
    }

    // ── Issue 3: activity percentage / window alignment ──────────────────────

    public function test_capture_score_is_authoritative_over_entry_aggregate(): void
    {
        // Entry aggregate is high, but this screenshot's own capture score is 0.
        $this->timeEntry->update(['activity_score' => 88]);

        $screenshot = Screenshot::factory()->make([
            'organization_id'           => $this->org->id,
            'user_id'                   => $this->employee->id,
            'time_entry_id'             => $this->timeEntry->id,
            'activity_score_at_capture' => 0,
            'captured_at'               => now(),
        ]);

        // No matched log needed — capture score wins.
        $this->assertSame(0, ScreenshotActivity::resolveScore($screenshot, null));
    }

    public function test_null_capture_score_derives_from_matched_window_not_entry(): void
    {
        $this->timeEntry->update(['activity_score' => 88]);

        $capturedAt = now();
        $screenshot = Screenshot::factory()->create([
            'organization_id'           => $this->org->id,
            'user_id'                   => $this->employee->id,
            'time_entry_id'             => $this->timeEntry->id,
            'activity_score_at_capture' => null,
            'captured_at'               => $capturedAt,
        ]);

        // A log inside the tight window with zero activity → derived score 0.
        ActivityLog::factory()->create([
            'organization_id' => $this->org->id,
            'user_id'         => $this->employee->id,
            'time_entry_id'   => $this->timeEntry->id,
            'logged_at'       => $capturedAt->copy()->addSeconds(5),
            'keyboard_events' => 0,
            'mouse_events'    => 0,
            'active_seconds'  => 0,
        ]);

        $resolved = ScreenshotActivity::resolveForScreenshot($screenshot);

        $this->assertSame(0, $resolved['activity_score']); // NOT the entry's 88
        $this->assertSame(0, $resolved['keyboard_events']);
        $this->assertSame(0, $resolved['mouse_events']);
    }

    public function test_distant_activity_log_is_not_attributed_to_screenshot(): void
    {
        $capturedAt = now();
        $screenshot = Screenshot::factory()->create([
            'organization_id'           => $this->org->id,
            'user_id'                   => $this->employee->id,
            'time_entry_id'             => $this->timeEntry->id,
            'activity_score_at_capture' => null,
            'captured_at'               => $capturedAt,
        ]);

        // A busy log 5 minutes away — outside the 60s window, must be ignored.
        ActivityLog::factory()->create([
            'organization_id' => $this->org->id,
            'user_id'         => $this->employee->id,
            'time_entry_id'   => $this->timeEntry->id,
            'logged_at'       => $capturedAt->copy()->addMinutes(5),
            'keyboard_events' => 400,
            'mouse_events'    => 600,
            'active_seconds'  => 30,
        ]);

        $resolved = ScreenshotActivity::resolveForScreenshot($screenshot);

        $this->assertSame(0, $resolved['activity_score']);
        $this->assertNull($resolved['keyboard_events']);
        $this->assertNull($resolved['mouse_events']);
    }
}
