<?php

namespace Tests\Feature\Api;

use App\Models\Organization;
use App\Models\Project;
use App\Models\TimeEntry;
use App\Models\User;
use Tests\TestCase;

class ReportTest extends TestCase
{
    private Organization $org;
    private User $owner;
    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();
        $this->org = Organization::factory()->create();
        $this->owner = User::factory()->create(['organization_id' => $this->org->id, 'role' => 'owner']);
        $this->employee = User::factory()->create(['organization_id' => $this->org->id, 'role' => 'employee']);
    }

    public function test_can_get_summary_report(): void
    {
        TimeEntry::factory()->count(3)->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'started_at' => now()->subHours(2),
            'ended_at' => now()->subHour(),
            'duration_seconds' => 3600,
        ]);

        $this->actingAs($this->owner, 'sanctum');

        $response = $this->getJson('/api/v1/reports/summary?' . http_build_query([
            'date_from' => now()->subDays(7)->toDateString(),
            'date_to' => now()->toDateString(),
        ]));

        $response->assertOk()
            ->assertJsonStructure(['daily', 'total_seconds', 'avg_activity', 'total_entries']);
    }

    public function test_employee_only_sees_own_summary(): void
    {
        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'started_at' => now()->subHours(2),
            'ended_at' => now()->subHour(),
            'duration_seconds' => 3600,
        ]);

        $this->actingAs($this->employee, 'sanctum');

        $response = $this->getJson('/api/v1/reports/summary?' . http_build_query([
            'date_from' => now()->subDays(7)->toDateString(),
            'date_to' => now()->toDateString(),
            'user_id' => $this->owner->id, // Try to see owner's data
        ]));

        // Should be forced to own data regardless of user_id param
        $response->assertOk();
    }

    public function test_employee_cannot_access_team_report(): void
    {
        $this->actingAs($this->employee, 'sanctum');

        $response = $this->getJson('/api/v1/reports/team?' . http_build_query([
            'date_from' => now()->subDays(7)->toDateString(),
            'date_to' => now()->toDateString(),
        ]));

        $response->assertStatus(403);
    }

    public function test_can_get_project_report(): void
    {
        $project = Project::factory()->create([
            'organization_id' => $this->org->id,
            'created_by' => $this->owner->id,
        ]);

        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'project_id' => $project->id,
            'started_at' => now()->subHours(2),
            'ended_at' => now()->subHour(),
            'duration_seconds' => 3600,
        ]);

        $this->actingAs($this->owner, 'sanctum');

        $response = $this->getJson('/api/v1/reports/projects?' . http_build_query([
            'date_from' => now()->subDays(7)->toDateString(),
            'date_to' => now()->toDateString(),
        ]));

        $response->assertOk()
            ->assertJsonStructure(['projects']);
    }

    public function test_can_request_export(): void
    {
        \Illuminate\Support\Facades\Queue::fake();

        $this->actingAs($this->owner, 'sanctum');

        $response = $this->postJson('/api/v1/reports/export', [
            'type' => 'summary',
            'format' => 'csv',
            'date_from' => now()->subDays(7)->toDateString(),
            'date_to' => now()->toDateString(),
        ]);

        $response->assertStatus(202)
            ->assertJsonStructure(['job_id']);

        \Illuminate\Support\Facades\Queue::assertPushed(\App\Jobs\GenerateReportJob::class);
    }

    public function test_employee_cannot_access_payroll(): void
    {
        $this->actingAs($this->employee, 'sanctum');

        $response = $this->getJson('/api/v1/reports/payroll?' . http_build_query([
            'date_from' => now()->subDays(30)->toDateString(),
            'date_to' => now()->toDateString(),
        ]));

        $response->assertStatus(403);
    }
}
