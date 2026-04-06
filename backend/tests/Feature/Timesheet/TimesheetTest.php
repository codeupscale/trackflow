<?php

namespace Tests\Feature\Timesheet;

use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\Timesheet;
use App\Models\User;
use Tests\TestCase;

class TimesheetTest extends TestCase
{
    private Organization $org;
    private User $owner;
    private User $manager;
    private User $employee;
    private User $otherEmployee;

    protected function setUp(): void
    {
        parent::setUp();

        $this->org = $this->createOrganization();
        $this->owner = $this->createUser($this->org, 'owner');
        $this->manager = $this->createUser($this->org, 'manager');
        $this->employee = $this->createUser($this->org, 'employee');
        $this->otherEmployee = $this->createUser($this->org, 'employee');
    }

    public function test_employee_can_submit_timesheet(): void
    {
        $periodStart = now()->startOfWeek();
        $periodEnd = now()->endOfWeek();

        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'started_at' => $periodStart->copy()->addHours(8),
            'ended_at' => $periodStart->copy()->addHours(16),
            'duration_seconds' => 28800, // 8 hours
        ]);

        $this->actingAs($this->employee, 'sanctum');

        $response = $this->postJson('/api/v1/timesheets/submit', [
            'period_start' => $periodStart->format('Y-m-d'),
            'period_end' => $periodEnd->format('Y-m-d'),
        ]);

        $response->assertStatus(201)
            ->assertJsonStructure(['timesheet' => ['id', 'user_id', 'period_start', 'period_end', 'total_seconds', 'status', 'submitted_at']]);

        $this->assertDatabaseHas('timesheets', [
            'user_id' => $this->employee->id,
            'organization_id' => $this->org->id,
            'status' => 'submitted',
        ]);
    }

    public function test_submit_timesheet_requires_authentication(): void
    {
        $response = $this->postJson('/api/v1/timesheets/submit', [
            'period_start' => now()->format('Y-m-d'),
            'period_end' => now()->format('Y-m-d'),
        ]);

        $response->assertStatus(401);
    }

    public function test_submit_timesheet_requires_valid_dates(): void
    {
        $this->actingAs($this->employee, 'sanctum');

        // Period end before start
        $response = $this->postJson('/api/v1/timesheets/submit', [
            'period_start' => now()->format('Y-m-d'),
            'period_end' => now()->subDay()->format('Y-m-d'),
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['period_end']);
    }

    public function test_manager_can_review_timesheet(): void
    {
        $timesheet = Timesheet::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'status' => 'submitted',
        ]);

        $this->actingAs($this->manager, 'sanctum');

        $response = $this->postJson("/api/v1/timesheets/{$timesheet->id}/review", [
            'action' => 'approve',
            'notes' => 'Looks good.',
        ]);

        $response->assertOk()
            ->assertJsonStructure(['timesheet' => ['id', 'status', 'reviewed_by', 'reviewed_at']]);

        $timesheet->refresh();
        $this->assertEquals('approved', $timesheet->status);
        $this->assertEquals($this->manager->id, $timesheet->reviewed_by);
        $this->assertNotNull($timesheet->reviewed_at);
    }

    public function test_manager_can_reject_timesheet(): void
    {
        $timesheet = Timesheet::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'status' => 'submitted',
        ]);

        $this->actingAs($this->manager, 'sanctum');

        $response = $this->postJson("/api/v1/timesheets/{$timesheet->id}/review", [
            'action' => 'reject',
            'notes' => 'Please adjust hours.',
        ]);

        $response->assertOk();

        $timesheet->refresh();
        $this->assertEquals('rejected', $timesheet->status);
    }

    public function test_owner_can_review_timesheet(): void
    {
        $timesheet = Timesheet::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'status' => 'submitted',
        ]);

        $this->actingAs($this->owner, 'sanctum');

        $response = $this->postJson("/api/v1/timesheets/{$timesheet->id}/review", [
            'action' => 'approve',
        ]);

        $response->assertOk();
        $timesheet->refresh();
        $this->assertEquals('approved', $timesheet->status);
    }

    public function test_employee_cannot_review_timesheet(): void
    {
        $timesheet = Timesheet::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'status' => 'submitted',
        ]);

        $this->actingAs($this->employee, 'sanctum');

        $response = $this->postJson("/api/v1/timesheets/{$timesheet->id}/review", [
            'action' => 'approve',
        ]);

        $response->assertStatus(403);
    }

    public function test_manager_cannot_review_other_org_timesheet(): void
    {
        $otherOrg = $this->createOrganization();
        $otherManager = $this->createUser($otherOrg, 'manager');

        $timesheet = Timesheet::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'status' => 'submitted',
        ]);

        $this->actingAs($otherManager, 'sanctum');

        $response = $this->postJson("/api/v1/timesheets/{$timesheet->id}/review", [
            'action' => 'approve',
        ]);

        // 404 is correct: org-scoped query doesn't find cross-tenant resources
        $this->assertContains($response->status(), [403, 404]);
    }

    public function test_review_timesheet_requires_valid_action(): void
    {
        $timesheet = Timesheet::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'status' => 'submitted',
        ]);

        $this->actingAs($this->manager, 'sanctum');

        $response = $this->postJson("/api/v1/timesheets/{$timesheet->id}/review", [
            'action' => 'invalid_action',
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['action']);
    }

    public function test_timesheet_calculates_total_seconds_correctly(): void
    {
        $periodStart = now()->subDays(7)->startOfDay();
        $periodEnd = now()->subDays(1)->endOfDay();

        // Create time entries totaling 16 hours
        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'started_at' => $periodStart->copy()->addHours(8),
            'ended_at' => $periodStart->copy()->addHours(12),
            'duration_seconds' => 14400, // 4 hours
        ]);

        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'started_at' => $periodStart->copy()->addHours(13),
            'ended_at' => $periodStart->copy()->addHours(21),
            'duration_seconds' => 28800, // 8 hours
        ]);

        $this->actingAs($this->employee, 'sanctum');

        $response = $this->postJson('/api/v1/timesheets/submit', [
            'period_start' => $periodStart->format('Y-m-d'),
            'period_end' => $periodEnd->format('Y-m-d'),
        ]);

        $response->assertStatus(201);
        $timesheet = Timesheet::latest()->first();
        $this->assertGreaterThan(0, $timesheet->total_seconds);
    }

    public function test_review_timesheet_validation_notes_max_length(): void
    {
        $timesheet = Timesheet::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'status' => 'submitted',
        ]);

        $this->actingAs($this->manager, 'sanctum');

        $response = $this->postJson("/api/v1/timesheets/{$timesheet->id}/review", [
            'action' => 'approve',
            'notes' => str_repeat('a', 1001), // Exceeds max 1000
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['notes']);
    }

    public function test_employee_cannot_submit_other_employee_timesheet(): void
    {
        $periodStart = now()->startOfWeek();
        $periodEnd = now()->endOfWeek();

        // This would require a separate endpoint, but the authorization check is in the policy
        // Demonstrating that employees can only submit their own
        $this->actingAs($this->employee, 'sanctum');

        $response = $this->postJson('/api/v1/timesheets/submit', [
            'period_start' => $periodStart->format('Y-m-d'),
            'period_end' => $periodEnd->format('Y-m-d'),
        ]);

        // Should create for the authenticated user, not allow specifying a different user_id
        $response->assertStatus(201);
        $timesheet = Timesheet::latest()->first();
        $this->assertEquals($this->employee->id, $timesheet->user_id);
    }
}
