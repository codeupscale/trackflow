<?php

namespace Tests\Feature\Api;

use App\Models\Organization;
use App\Models\Project;
use App\Models\TimeEntry;
use App\Models\User;
use Tests\TestCase;

/**
 * GET /dashboard/project-hours — "my hours, grouped by project".
 *
 * This is how an employee answers "how long did I spend on project A in
 * August?" now that the Reports section is not theirs, so the employee-role
 * case is the headline test, not an afterthought.
 */
class DashboardProjectHoursTest extends TestCase
{
    private Organization $org;
    private User $employee;
    private User $colleague;
    private Project $alpha;
    private Project $beta;

    protected function setUp(): void
    {
        parent::setUp();

        $this->org = $this->createOrganization();
        $this->employee = $this->createUser($this->org, 'employee');
        $this->colleague = $this->createUser($this->org, 'employee');

        $this->alpha = Project::factory()->create([
            'organization_id' => $this->org->id,
            'name' => 'Alpha',
            'created_by' => $this->employee->id,
        ]);
        $this->beta = Project::factory()->create([
            'organization_id' => $this->org->id,
            'name' => 'Beta',
            'created_by' => $this->employee->id,
        ]);
    }

    /** One approved, closed, non-idle entry of $hours on $date. */
    private function entry(User $user, ?Project $project, string $date, float $hours, array $overrides = []): TimeEntry
    {
        $start = \Carbon\Carbon::parse("{$date} 10:00:00");

        return TimeEntry::factory()->create(array_merge([
            'organization_id' => $this->org->id,
            'user_id' => $user->id,
            'project_id' => $project?->id,
            'started_at' => $start,
            'ended_at' => $start->copy()->addMinutes((int) round($hours * 60)),
            'type' => 'tracked',
            'approval_status' => 'approved',
        ], $overrides));
    }

    private function url(array $params = []): string
    {
        return '/api/v1/dashboard/project-hours?' . http_build_query($params);
    }

    public function test_employee_gets_their_hours_grouped_by_project(): void
    {
        $this->entry($this->employee, $this->alpha, '2026-08-10', 3);
        $this->entry($this->employee, $this->alpha, '2026-08-11', 2);
        $this->entry($this->employee, $this->beta, '2026-08-12', 1);

        $this->actingAs($this->employee, 'sanctum');

        $response = $this->getJson($this->url(['period' => 'month', 'month' => '2026-08']));

        $response->assertOk();
        $this->assertSame(6 * 3600, $response->json('total_seconds'));

        // Ordered by time descending, so the biggest consumer reads first.
        $this->assertSame('Alpha', $response->json('projects.0.name'));
        $this->assertSame(5 * 3600, $response->json('projects.0.total_seconds'));
        $this->assertSame(2, $response->json('projects.0.entry_count'));
        $this->assertSame('Beta', $response->json('projects.1.name'));
        $this->assertSame(1 * 3600, $response->json('projects.1.total_seconds'));
    }

    /** The headline case: the two filters AND, they do not replace each other. */
    public function test_project_filter_and_month_filter_combine(): void
    {
        $this->entry($this->employee, $this->alpha, '2026-08-10', 3);
        $this->entry($this->employee, $this->beta, '2026-08-10', 4);
        $this->entry($this->employee, $this->alpha, '2026-07-10', 9);

        $this->actingAs($this->employee, 'sanctum');

        $response = $this->getJson($this->url([
            'period' => 'month',
            'month' => '2026-08',
            'project_id' => $this->alpha->id,
        ]));

        $response->assertOk();
        // Alpha in August only: not Beta's August, not Alpha's July.
        $this->assertCount(1, $response->json('projects'));
        $this->assertSame('Alpha', $response->json('projects.0.name'));
        $this->assertSame(3 * 3600, $response->json('total_seconds'));
    }

    public function test_week_and_custom_periods_narrow_the_range(): void
    {
        // 2026-08-12 is a Wednesday; 2026-08-03 is the Monday of a prior week.
        $this->entry($this->employee, $this->alpha, '2026-08-12', 2);
        $this->entry($this->employee, $this->alpha, '2026-08-03', 5);

        $this->actingAs($this->employee, 'sanctum');

        $week = $this->getJson($this->url(['period' => 'week', 'week_of' => '2026-08-12']));
        $week->assertOk();
        $this->assertSame(2 * 3600, $week->json('total_seconds'));

        $custom = $this->getJson($this->url([
            'period' => 'custom',
            'start_date' => '2026-08-01',
            'end_date' => '2026-08-31',
        ]));
        $custom->assertOk();
        $this->assertSame(7 * 3600, $custom->json('total_seconds'));
    }

    public function test_today_period_covers_only_the_current_day(): void
    {
        $tz = $this->employee->getTimezoneForDates();
        $today = \Carbon\Carbon::now($tz)->toDateString();
        $yesterday = \Carbon\Carbon::now($tz)->subDay()->toDateString();

        $this->entry($this->employee, $this->alpha, $today, 2);
        $this->entry($this->employee, $this->alpha, $yesterday, 5);

        $this->actingAs($this->employee, 'sanctum');

        $response = $this->getJson($this->url(['period' => 'today']));

        $response->assertOk();
        $this->assertSame($today, $response->json('date_from'));
        $this->assertSame($today, $response->json('date_to'));
        $this->assertSame(2 * 3600, $response->json('total_seconds'));
    }

    public function test_only_worked_time_is_counted(): void
    {
        $this->entry($this->employee, $this->alpha, '2026-08-10', 2);
        // Idle is not work.
        $this->entry($this->employee, $this->alpha, '2026-08-11', 3, ['type' => 'idle']);
        // A manual entry awaiting approval must stay invisible until approved.
        $this->entry($this->employee, $this->alpha, '2026-08-12', 4, [
            'type' => 'manual',
            'approval_status' => 'pending',
        ]);
        // A running entry has no end yet.
        $this->entry($this->employee, $this->alpha, '2026-08-13', 1, ['ended_at' => null]);

        $this->actingAs($this->employee, 'sanctum');

        $response = $this->getJson($this->url(['period' => 'month', 'month' => '2026-08']));

        $response->assertOk();
        $this->assertSame(2 * 3600, $response->json('total_seconds'));
    }

    public function test_time_with_no_project_is_still_counted(): void
    {
        $this->entry($this->employee, null, '2026-08-10', 2);

        $this->actingAs($this->employee, 'sanctum');

        $response = $this->getJson($this->url(['period' => 'month', 'month' => '2026-08']));

        $response->assertOk();
        $this->assertSame('No project', $response->json('projects.0.name'));
        $this->assertSame(2 * 3600, $response->json('total_seconds'));
    }

    /** Self-scoped by construction — there is no parameter that can widen it. */
    public function test_a_colleagues_hours_are_never_included(): void
    {
        $this->entry($this->employee, $this->alpha, '2026-08-10', 2);
        $this->entry($this->colleague, $this->alpha, '2026-08-10', 8);

        $this->actingAs($this->employee, 'sanctum');

        $response = $this->getJson($this->url([
            'period' => 'month',
            'month' => '2026-08',
            // Not a supported parameter; must not widen the result either way.
            'user_id' => $this->colleague->id,
        ]));

        $response->assertOk();
        $this->assertSame(2 * 3600, $response->json('total_seconds'));
    }

    public function test_cross_org_entries_are_never_included(): void
    {
        $otherOrg = $this->createOrganization();
        $twin = User::factory()->create([
            'organization_id' => $otherOrg->id,
            'email' => $this->employee->email . '.other',
        ]);
        $otherProject = Project::factory()->create([
            'organization_id' => $otherOrg->id,
            'created_by' => $twin->id,
        ]);

        TimeEntry::factory()->create([
            'organization_id' => $otherOrg->id,
            'user_id' => $twin->id,
            'project_id' => $otherProject->id,
            'started_at' => \Carbon\Carbon::parse('2026-08-10 10:00:00'),
            'ended_at' => \Carbon\Carbon::parse('2026-08-10 18:00:00'),
            'type' => 'tracked',
            'approval_status' => 'approved',
        ]);

        $this->entry($this->employee, $this->alpha, '2026-08-10', 2);

        $this->actingAs($this->employee, 'sanctum');

        $response = $this->getJson($this->url(['period' => 'month', 'month' => '2026-08']));

        $response->assertOk();
        $this->assertSame(2 * 3600, $response->json('total_seconds'));
    }

    public function test_invalid_period_parameters_are_rejected(): void
    {
        $this->actingAs($this->employee, 'sanctum');

        $this->getJson($this->url(['period' => 'quarter']))->assertStatus(422);
        $this->getJson($this->url(['period' => 'month', 'month' => 'August']))->assertStatus(422);
        $this->getJson($this->url([
            'period' => 'custom',
            'start_date' => '2026-08-31',
            'end_date' => '2026-08-01',
        ]))->assertStatus(422);
    }
}
