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
        $this->org = $this->createOrganization();
        $this->owner = $this->createUser($this->org, 'owner');
        $this->employee = $this->createUser($this->org, 'employee');
    }

    public function test_can_get_summary_report(): void
    {
        $refDate = now()->subDays(2)->startOfDay()->addHours(10);

        TimeEntry::factory()->count(3)->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'started_at' => $refDate,
            'ended_at' => $refDate->copy()->addHour(),
            'duration_seconds' => 3600,
        ]);

        $this->actingAs($this->owner, 'sanctum');

        $response = $this->getJson('/api/v1/reports/summary?' . http_build_query([
            'date_from' => now()->subDays(7)->toDateString(),
            'date_to' => now()->addDay()->toDateString(),
        ]));

        $response->assertOk()
            ->assertJsonStructure(['daily', 'total_seconds', 'avg_activity', 'total_entries']);
    }

    public function test_employee_only_sees_own_summary(): void
    {
        $refDate = now()->subDays(2)->startOfDay()->addHours(10);

        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'started_at' => $refDate,
            'ended_at' => $refDate->copy()->addHour(),
            'duration_seconds' => 3600,
        ]);

        $this->actingAs($this->employee, 'sanctum');

        $response = $this->getJson('/api/v1/reports/summary?' . http_build_query([
            'date_from' => now()->subDays(7)->toDateString(),
            'date_to' => now()->addDay()->toDateString(),
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
            'date_to' => now()->addDay()->toDateString(),
        ]));

        $response->assertStatus(403);
    }

    public function test_can_get_project_report(): void
    {
        $project = Project::factory()->create([
            'organization_id' => $this->org->id,
            'created_by' => $this->owner->id,
        ]);

        $refDate = now()->subDays(2)->startOfDay()->addHours(10);

        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'project_id' => $project->id,
            'started_at' => $refDate,
            'ended_at' => $refDate->copy()->addHour(),
            'duration_seconds' => 3600,
        ]);

        $this->actingAs($this->owner, 'sanctum');

        $response = $this->getJson('/api/v1/reports/projects?' . http_build_query([
            'date_from' => now()->subDays(7)->toDateString(),
            'date_to' => now()->addDay()->toDateString(),
        ]));

        $response->assertOk()
            ->assertJsonStructure(['projects'])
            ->assertJsonPath('projects.0.project_name', $project->name);
    }

    public function test_apps_report_returns_per_user_breakdown(): void
    {
        $date = now()->toDateString();

        \Illuminate\Support\Facades\DB::table('app_usage_summaries')->insert([
            [
                'id' => (string) \Illuminate\Support\Str::uuid(),
                'organization_id' => $this->org->id,
                'user_id' => $this->employee->id,
                'date' => $date,
                'app_name' => 'powershell',
                'duration_seconds' => 3600,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'id' => (string) \Illuminate\Support\Str::uuid(),
                'organization_id' => $this->org->id,
                'user_id' => $this->owner->id,
                'date' => $date,
                'app_name' => 'Code',
                'duration_seconds' => 1800,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $this->actingAs($this->owner, 'sanctum');

        $response = $this->getJson('/api/v1/reports/apps?' . http_build_query([
            'date_from' => $date,
            'date_to' => $date,
        ]));

        $response->assertOk()
            ->assertJsonStructure(['apps' => [['user_name', 'active_app', 'duration_seconds', 'days_used']]]);

        $rows = collect($response->json('apps'));
        $this->assertTrue($rows->contains(fn ($r) => $r['user_name'] === $this->employee->name && $r['active_app'] === 'powershell'));
        $this->assertTrue($rows->contains(fn ($r) => $r['user_name'] === $this->owner->name && $r['active_app'] === 'Code'));
    }

    public function test_can_export_csv_synchronously(): void
    {
        $this->actingAs($this->owner, 'sanctum');

        $response = $this->postJson('/api/v1/reports/export', [
            'type' => 'summary',
            'format' => 'csv',
            'date_from' => now()->subDays(7)->toDateString(),
            'date_to' => now()->addDay()->toDateString(),
        ]);

        $response->assertOk();
        $this->assertStringContainsString('text/csv', $response->headers->get('Content-Type'));
        $this->assertStringContainsString('attachment', $response->headers->get('Content-Disposition'));
        // Human-readable header, never raw "Total Seconds".
        $this->assertStringContainsString('Time Utilized', $response->getContent());
    }

    public function test_employee_cannot_access_payroll(): void
    {
        $this->actingAs($this->employee, 'sanctum');

        $response = $this->getJson('/api/v1/reports/payroll?' . http_build_query([
            'date_from' => now()->subDays(30)->toDateString(),
            'date_to' => now()->addDay()->toDateString(),
        ]));

        $response->assertStatus(403);
    }
}
