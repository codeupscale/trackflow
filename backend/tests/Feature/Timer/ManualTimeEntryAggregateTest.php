<?php

namespace Tests\Feature\Timer;

use App\Models\AttendanceRecord;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\AttendanceService;
use Carbon\Carbon;
use Tests\TestCase;

/**
 * Feature A — aggregate exclusion (the critical invariant).
 *
 * A PENDING or REJECTED manual entry must NEVER count toward any report or
 * aggregate; only an APPROVED entry does. These tests pin the clock so the
 * week/day windows are deterministic, then prove the invariant across the
 * ReportService summary + time-logs, the timesheet total, and the nightly
 * attendance worked-hours computation — plus a regression proving pre-existing
 * tracked entries (approval_status defaulting to 'approved') still count.
 *
 * Note on the dashboard "tracked" widget: it is filtered to type='tracked' by
 * design, so a manual entry (pending OR approved) never appears there. The
 * dashboard test locks that contract in.
 */
class ManualTimeEntryAggregateTest extends TestCase
{
    private Organization $org;
    private User $owner;
    private User $employee;

    private const DAY = '2026-06-17';          // a Wednesday
    private const RANGE_FROM = '2026-06-16';
    private const RANGE_TO = '2026-06-18';
    private const WEEK_START = '2026-06-15';   // Monday
    private const WEEK_END = '2026-06-21';     // Sunday

    private const TRACKED_SECONDS = 7200;      // 08:00–10:00
    private const MANUAL_SECONDS = 10800;      // 10:00–13:00

    protected function setUp(): void
    {
        parent::setUp();
        // Pin the clock — the desktop/report suite is otherwise wall-clock-flaky.
        Carbon::setTestNow(Carbon::parse(self::DAY . ' 12:00:00', 'UTC'));

        $this->org = $this->createOrganization();
        $this->owner = $this->createUser($this->org, 'owner');
        $this->employee = $this->createUser($this->org, 'employee');
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    // ── ReportService::summary ────────────────────────────────────────────

    public function test_pending_manual_entry_excluded_from_summary_then_counts_on_approval(): void
    {
        $this->trackedBaseline();
        $manual = $this->pendingManual();

        $this->actingAs($this->owner, 'sanctum');

        // Pending: only the tracked baseline counts.
        $before = $this->summary();
        $this->assertEquals(self::TRACKED_SECONDS, (int) $before['total_seconds']);
        $this->assertEquals(1, (int) $before['total_entries']);

        // Approve → the manual seconds now count (and the cache is busted).
        $this->postJson("/api/v1/time-entries/{$manual->id}/approve")->assertOk();

        $after = $this->summary();
        $this->assertEquals(self::TRACKED_SECONDS + self::MANUAL_SECONDS, (int) $after['total_seconds']);
        $this->assertEquals(2, (int) $after['total_entries']);
    }

    public function test_rejected_manual_entry_never_counts_in_summary(): void
    {
        $this->trackedBaseline();
        $manual = $this->pendingManual();

        $this->actingAs($this->owner, 'sanctum');
        $this->assertEquals(self::TRACKED_SECONDS, (int) $this->summary()['total_seconds']);

        $this->postJson("/api/v1/time-entries/{$manual->id}/reject", [
            'rejection_reason' => 'duplicate',
        ])->assertOk();

        // Still just the tracked baseline — the rejected entry is invisible.
        $this->assertEquals(self::TRACKED_SECONDS, (int) $this->summary()['total_seconds']);
    }

    // ── ReportService::timeLogs ───────────────────────────────────────────

    public function test_pending_manual_entry_excluded_from_time_logs_then_appears_on_approval(): void
    {
        $baseline = $this->trackedBaseline();
        $manual = $this->pendingManual();

        $this->actingAs($this->owner, 'sanctum');

        $ids = $this->timeLogIds();
        $this->assertContains($baseline->id, $ids);
        $this->assertNotContains($manual->id, $ids);

        $this->postJson("/api/v1/time-entries/{$manual->id}/approve")->assertOk();

        $idsAfter = $this->timeLogIds();
        $this->assertContains($manual->id, $idsAfter);
    }

    // ── Timesheet total ───────────────────────────────────────────────────

    public function test_timesheet_total_excludes_pending_and_counts_after_approval(): void
    {
        $this->trackedBaseline();
        $manual = $this->pendingManual();

        // Employee submits — pending manual excluded, only tracked counts.
        // (Read the total off the response: the pinned clock makes created_at
        // identical across submissions, so latest() would be ambiguous.)
        $this->actingAs($this->employee, 'sanctum');
        $first = $this->submitTimesheet();
        $first->assertStatus(201);
        $this->assertEquals(self::TRACKED_SECONDS, (int) $first->json('timesheet.total_seconds'));

        // A manager approves the manual entry...
        $this->actingAs($this->owner, 'sanctum');
        $this->postJson("/api/v1/time-entries/{$manual->id}/approve")->assertOk();

        // ...and a fresh submission now includes it.
        $this->actingAs($this->employee, 'sanctum');
        $second = $this->submitTimesheet();
        $second->assertStatus(201);
        $this->assertEquals(
            self::TRACKED_SECONDS + self::MANUAL_SECONDS,
            (int) $second->json('timesheet.total_seconds')
        );
    }

    // ── Dashboard (tracked-only widget) ───────────────────────────────────

    public function test_manual_entries_never_inflate_dashboard_tracked_total(): void
    {
        $this->trackedBaseline();

        $this->actingAs($this->employee, 'sanctum');
        $this->assertEquals(self::TRACKED_SECONDS, $this->dashboardWeekSeconds());

        // A pending manual entry does not appear...
        $manual = $this->pendingManual();
        $this->assertEquals(self::TRACKED_SECONDS, $this->dashboardWeekSeconds());

        // ...and neither does an approved one (the widget is type='tracked' only).
        $this->actingAs($this->owner, 'sanctum');
        $this->postJson("/api/v1/time-entries/{$manual->id}/approve")->assertOk();

        $this->actingAs($this->employee, 'sanctum');
        $this->assertEquals(self::TRACKED_SECONDS, $this->dashboardWeekSeconds());
    }

    // ── AttendanceService worked-hours ────────────────────────────────────

    public function test_attendance_worked_hours_excludes_pending_then_includes_on_approval(): void
    {
        // Only a manual entry, so worked-hours reflects it directly.
        $manual = $this->pendingManual();

        $service = app(AttendanceService::class);
        $service->generateDailyAttendance($this->org->id, self::DAY);

        $record = $this->attendanceRecord();
        $this->assertNotNull($record);
        $this->assertEquals(0.0, (float) $record->total_hours);

        // Approve directly on the model (service-layer aggregate test).
        $manual->update(['approval_status' => 'approved', 'is_approved' => true]);
        $service->generateDailyAttendance($this->org->id, self::DAY);

        $record = $this->attendanceRecord();
        $this->assertEquals(round(self::MANUAL_SECONDS / 3600, 2), (float) $record->total_hours);
    }

    // ── ReportService::attendance (REPT-08) ───────────────────────────────

    public function test_attendance_report_excludes_pending_manual_then_counts_on_approval(): void
    {
        // Only a manual entry, so the attendance worked-seconds reflects it directly.
        // Regression: ReportService::attendance() was missing the approval filter, so
        // a pending/rejected manual entry leaked into attendance totals and approving
        // had no effect. It must now behave like every other report aggregate.
        $manual = $this->pendingManual();

        $this->actingAs($this->owner, 'sanctum');

        // Pending: the attendance report shows no worked seconds for the employee.
        $this->assertEquals(0, $this->attendanceReportSeconds());

        // Approve → the manual seconds now appear (and the report cache is busted).
        $this->postJson("/api/v1/time-entries/{$manual->id}/approve")->assertOk();
        $this->assertEquals(self::MANUAL_SECONDS, $this->attendanceReportSeconds());
    }

    // ── Regression: default-approved tracked rows still count ─────────────

    public function test_preexisting_tracked_entries_still_count_in_summary(): void
    {
        // A factory entry with NO explicit approval fields — relies on the DB
        // default approval_status='approved'. It must aggregate exactly as before.
        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'type' => 'tracked',
            'started_at' => Carbon::parse(self::DAY . ' 08:00:00', 'UTC'),
            'ended_at' => Carbon::parse(self::DAY . ' 10:00:00', 'UTC'),
            'duration_seconds' => self::TRACKED_SECONDS,
        ]);

        $this->actingAs($this->owner, 'sanctum');
        $summary = $this->summary();

        $this->assertEquals('approved', TimeEntry::latest()->first()->approval_status);
        $this->assertEquals(self::TRACKED_SECONDS, (int) $summary['total_seconds']);
        $this->assertEquals(1, (int) $summary['total_entries']);
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    private function trackedBaseline(): TimeEntry
    {
        return TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'type' => 'tracked',
            'approval_status' => 'approved',
            'is_approved' => true,
            'started_at' => Carbon::parse(self::DAY . ' 08:00:00', 'UTC'),
            'ended_at' => Carbon::parse(self::DAY . ' 10:00:00', 'UTC'),
            'duration_seconds' => self::TRACKED_SECONDS,
        ]);
    }

    private function pendingManual(): TimeEntry
    {
        return TimeEntry::factory()->manual()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'submitted_by' => $this->employee->id,
            'approval_status' => 'pending',
            'is_approved' => false,
            'started_at' => Carbon::parse(self::DAY . ' 10:00:00', 'UTC'),
            'ended_at' => Carbon::parse(self::DAY . ' 13:00:00', 'UTC'),
            'duration_seconds' => self::MANUAL_SECONDS,
        ]);
    }

    private function summary(): array
    {
        return $this->getJson('/api/v1/reports/summary?' . http_build_query([
            'date_from' => self::RANGE_FROM,
            'date_to' => self::RANGE_TO,
        ]))->assertOk()->json();
    }

    private function timeLogIds(): array
    {
        return collect($this->getJson('/api/v1/reports/time-logs?' . http_build_query([
            'date_from' => self::RANGE_FROM,
            'date_to' => self::RANGE_TO,
        ]))->assertOk()->json('data'))->pluck('id')->all();
    }

    private function submitTimesheet()
    {
        return $this->postJson('/api/v1/timesheets/submit', [
            'period_start' => self::WEEK_START,
            'period_end' => self::WEEK_END,
        ]);
    }

    private function dashboardWeekSeconds(): int
    {
        return (int) $this->getJson('/api/v1/dashboard')->assertOk()->json('week_seconds');
    }

    private function attendanceReportSeconds(): int
    {
        $rows = $this->getJson('/api/v1/reports/attendance?' . http_build_query([
            'date_from' => self::RANGE_FROM,
            'date_to' => self::RANGE_TO,
        ]))->assertOk()->json('attendance');

        foreach ($rows as $row) {
            if (($row['user_id'] ?? null) === $this->employee->id) {
                return (int) $row['total_seconds'];
            }
        }

        return 0;
    }

    private function attendanceRecord(): ?AttendanceRecord
    {
        return AttendanceRecord::withoutGlobalScopes()
            ->where('organization_id', $this->org->id)
            ->where('user_id', $this->employee->id)
            ->whereDate('date', self::DAY)
            ->first();
    }
}
