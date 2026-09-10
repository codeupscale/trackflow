<?php

namespace Tests\Feature\Api;

use App\Models\Organization;
use App\Models\Project;
use App\Models\TimeEntry;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Feature B — Project-manager time report + CSV/PDF export.
 *
 * The report surfaces approved tracked + manual rows (pending/rejected manual and
 * org-scoped and further narrowed by the actor's reports.view scope
 * (organization / project / own). Export streams CSV (formula-injection
 * neutralized) or renders PDF (row-capped at 5000).
 */
class ProjectTimeReportTest extends TestCase
{
    private Organization $org;
    private User $owner;
    private User $employee;

    private const START = '2026-06-15';
    private const END = '2026-06-20';
    private const AT = '2026-06-17 10:00:00';   // inside the range
    private const AT_END = '2026-06-17 12:00:00';

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow(Carbon::parse('2026-06-17 12:30:00', 'UTC'));
        $this->org = $this->createOrganization();
        $this->owner = $this->createUser($this->org, 'owner');
        $this->employee = $this->createUser($this->org, 'employee');
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    // ── Index: envelope + filtering ───────────────────────────────────────

    public function test_index_returns_data_and_summary_envelope(): void
    {
        $project = $this->project();
        $this->trackedEntry($this->employee, $project);

        $this->actingAs($this->owner, 'sanctum');
        $response = $this->getJson($this->url());

        $response->assertOk()
            ->assertJsonStructure([
                'data' => [['id', 'user_name', 'project_name', 'duration_seconds', 'billable_amount']],
                'meta' => [
                    'current_page', 'last_page', 'per_page', 'total', 'group_by_day',
                    'summary' => [
                        'total_seconds', 'billable_amount',
                        'entry_count', 'resource_count', 'project_count',
                    ],
                ],
            ]);

        $this->assertEquals(1, $response->json('meta.summary.entry_count'));
        $this->assertEquals(7200, $response->json('meta.summary.total_seconds'));
        $this->assertFalse($response->json('meta.group_by_day'));
    }

    public function test_index_group_by_day_sums_entries_per_resource_project_and_day(): void
    {
        $project = $this->project();
        $otherProject = Project::factory()->billable(50)->create([
            'organization_id' => $this->org->id,
            'created_by' => $this->owner->id,
            'name' => 'Other Project',
        ]);

        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'project_id' => $project->id,
            'type' => 'tracked',
            'approval_status' => 'approved',
            'is_approved' => true,
            'started_at' => Carbon::parse('2026-06-17 09:00:00'),
            'ended_at' => Carbon::parse('2026-06-17 10:00:00'),
            'duration_seconds' => 3600,
        ]);
        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'project_id' => $project->id,
            'type' => 'manual',
            'approval_status' => 'approved',
            'is_approved' => true,
            'started_at' => Carbon::parse('2026-06-17 14:00:00'),
            'ended_at' => Carbon::parse('2026-06-17 15:30:00'),
            'duration_seconds' => 5400,
        ]);
        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'project_id' => $otherProject->id,
            'type' => 'tracked',
            'approval_status' => 'approved',
            'is_approved' => true,
            'started_at' => Carbon::parse('2026-06-17 16:00:00'),
            'ended_at' => Carbon::parse('2026-06-17 17:00:00'),
            'duration_seconds' => 3600,
        ]);

        $this->actingAs($this->owner, 'sanctum');
        $response = $this->getJson($this->url(['group_by_day' => 1]));

        $response->assertOk()
            ->assertJsonPath('meta.group_by_day', true)
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('meta.summary.entry_count', 3)
            ->assertJsonPath('meta.summary.total_seconds', 12600);

        $rows = collect($response->json('data'))->keyBy('project_name');
        $this->assertEquals(9000, $rows[$project->name]['duration_seconds']);
        $this->assertEquals(2, $rows[$project->name]['entry_count']);
        $this->assertEquals('Mixed', $rows[$project->name]['type']);
        $this->assertEquals(3600, $rows['Other Project']['duration_seconds']);
        $this->assertEquals(1, $rows['Other Project']['entry_count']);
    }

    public function test_index_only_includes_approved_tracked_and_manual_entries(): void
    {
        $project = $this->project();
        $tracked = $this->trackedEntry($this->employee, $project);

        $approvedManual = TimeEntry::factory()->manual()->create([
            'organization_id' => $this->org->id, 'user_id' => $this->employee->id,
            'project_id' => $project->id, 'approval_status' => 'approved', 'is_approved' => true,
            'started_at' => Carbon::parse(self::AT), 'ended_at' => Carbon::parse(self::AT_END),
            'duration_seconds' => 3600,
        ]);

        // Pending manual, rejected manual, and idle markers never count.
        TimeEntry::factory()->manual()->create([
            'organization_id' => $this->org->id, 'user_id' => $this->employee->id,
            'project_id' => $project->id, 'approval_status' => 'pending', 'is_approved' => false,
            'started_at' => Carbon::parse(self::AT), 'ended_at' => Carbon::parse(self::AT_END),
            'duration_seconds' => 7200,
        ]);
        TimeEntry::factory()->create([
            'organization_id' => $this->org->id, 'user_id' => $this->employee->id,
            'project_id' => $project->id, 'type' => 'idle', 'approval_status' => 'approved',
            'started_at' => Carbon::parse(self::AT), 'ended_at' => Carbon::parse(self::AT_END),
            'duration_seconds' => 7200,
        ]);

        $this->actingAs($this->owner, 'sanctum');
        $response = $this->getJson($this->url());

        $ids = collect($response->json('data'))->pluck('id')->all();
        $this->assertEqualsCanonicalizing([$tracked->id, $approvedManual->id], $ids);
        $this->assertEquals(2, $response->json('meta.summary.entry_count'));
    }

    public function test_project_id_filter_narrows_results(): void
    {
        $p1 = $this->project();
        $p2 = $this->project();
        $e1 = $this->trackedEntry($this->employee, $p1);
        $this->trackedEntry($this->employee, $p2);

        $this->actingAs($this->owner, 'sanctum');
        $response = $this->getJson($this->url(['project_id' => $p1->id]));

        $ids = collect($response->json('data'))->pluck('id')->all();
        $this->assertEquals([$e1->id], $ids);
        $this->assertEquals(1, $response->json('meta.summary.project_count'));
    }

    public function test_project_id_array_filter_includes_multiple_projects(): void
    {
        $p1 = $this->project();
        $p2 = $this->project();
        $p3 = $this->project();
        $this->trackedEntry($this->employee, $p1);
        $this->trackedEntry($this->employee, $p2);
        $this->trackedEntry($this->employee, $p3);

        $this->actingAs($this->owner, 'sanctum');
        $response = $this->getJson($this->url(['project_id' => [$p1->id, $p2->id]]));

        $this->assertEquals(2, $response->json('meta.summary.entry_count'));
        $this->assertEquals(2, $response->json('meta.summary.project_count'));
    }

    public function test_user_id_filter_narrows_results(): void
    {
        $other = $this->createUser($this->org, 'employee');
        $project = $this->project();
        $mine = $this->trackedEntry($this->employee, $project);
        $this->trackedEntry($other, $project);

        $this->actingAs($this->owner, 'sanctum');
        $response = $this->getJson($this->url(['user_id' => $this->employee->id]));

        $ids = collect($response->json('data'))->pluck('id')->all();
        $this->assertEquals([$mine->id], $ids);
        $this->assertEquals(1, $response->json('meta.summary.resource_count'));
    }

    public function test_user_id_array_filter_includes_multiple_resources(): void
    {
        $a = $this->createUser($this->org, 'employee');
        $b = $this->createUser($this->org, 'employee');
        $c = $this->createUser($this->org, 'employee');
        $project = $this->project();
        $ea = $this->trackedEntry($a, $project);
        $eb = $this->trackedEntry($b, $project);
        $this->trackedEntry($c, $project);

        $this->actingAs($this->owner, 'sanctum');
        $response = $this->getJson($this->url(['user_id' => [$a->id, $b->id]]));

        $ids = collect($response->json('data'))->pluck('id')->all();
        $this->assertEqualsCanonicalizing([$ea->id, $eb->id], $ids);
        $this->assertEquals(2, $response->json('meta.summary.entry_count'));
        $this->assertEquals(2, $response->json('meta.summary.resource_count'));
    }

    public function test_user_id_array_combines_with_project_id_array(): void
    {
        $a = $this->createUser($this->org, 'employee');
        $b = $this->createUser($this->org, 'employee');
        $p1 = $this->project();
        $p2 = $this->project();
        $keep = $this->trackedEntry($a, $p1);
        // Right resource, wrong project — and vice versa. Neither may appear.
        $this->trackedEntry($a, $p2);
        $this->trackedEntry($b, $p2);

        $this->actingAs($this->owner, 'sanctum');
        $response = $this->getJson($this->url([
            'project_id' => [$p1->id],
            'user_id' => [$a->id, $b->id],
        ]));

        $ids = collect($response->json('data'))->pluck('id')->all();
        $this->assertEquals([$keep->id], $ids);
        $this->assertEquals(1, $response->json('meta.summary.entry_count'));
    }

    public function test_user_id_array_never_widens_an_employees_own_scope(): void
    {
        $other = $this->createUser($this->org, 'employee');
        $project = $this->project();
        $mine = $this->trackedEntry($this->employee, $project);
        $this->trackedEntry($other, $project);

        // An employee asking for a colleague's rows still only sees their own.
        // The employee ROLE no longer carries reports; this asserts what an
        // 'own' scope does for whoever holds it, so grant it explicitly.
        $this->grantPermission($this->employee, 'reports.view', 'own');
        $this->actingAs($this->employee, 'sanctum');
        $response = $this->getJson($this->url([
            'user_id' => [$this->employee->id, $other->id],
        ]));

        $ids = collect($response->json('data'))->pluck('id')->all();
        $this->assertEquals([$mine->id], $ids);
        $this->assertEquals(1, $response->json('meta.summary.resource_count'));
    }

    public function test_user_id_array_rejects_a_non_uuid_member(): void
    {
        $this->actingAs($this->owner, 'sanctum');

        $this->getJson($this->url(['user_id' => [$this->employee->id, 'not-a-uuid']]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('user_id.1');
    }

    public function test_custom_period_excludes_entries_outside_range(): void
    {
        $project = $this->project();
        $inRange = $this->trackedEntry($this->employee, $project);
        // Well outside the [START, END] window.
        TimeEntry::factory()->create([
            'organization_id' => $this->org->id, 'user_id' => $this->employee->id,
            'project_id' => $project->id, 'type' => 'tracked', 'approval_status' => 'approved',
            'started_at' => Carbon::parse('2026-05-01 10:00:00'),
            'ended_at' => Carbon::parse('2026-05-01 12:00:00'), 'duration_seconds' => 7200,
        ]);

        $this->actingAs($this->owner, 'sanctum');
        $ids = collect($this->getJson($this->url())->json('data'))->pluck('id')->all();
        $this->assertEquals([$inRange->id], $ids);
    }

    // ── Role scope ────────────────────────────────────────────────────────

    public function test_employee_sees_only_own_rows(): void
    {
        $project = $this->project();
        $mine = $this->trackedEntry($this->employee, $project);
        $this->trackedEntry($this->owner, $project);

        // Granted explicitly: the employee role itself no longer holds reports.
        $this->grantPermission($this->employee, 'reports.view', 'own');
        $this->actingAs($this->employee, 'sanctum');
        $response = $this->getJson($this->url());

        $ids = collect($response->json('data'))->pluck('id')->all();
        $this->assertEquals([$mine->id], $ids);
    }

    public function test_employee_role_cannot_reach_the_project_time_report(): void
    {
        $this->trackedEntry($this->employee, $this->project());

        $this->actingAs($this->employee, 'sanctum');

        $this->getJson($this->url())->assertStatus(403);
    }

    public function test_project_scoped_manager_sees_team_not_outsiders(): void
    {
        $project = $this->project();
        $teamMember = $this->createUser($this->org, 'employee');
        $project->members()->attach($teamMember->id);
        $outsider = $this->createUser($this->org, 'employee');

        $pm = $this->makeRoleUser(['reports.view' => 'project'], $project);

        $teamEntry = $this->trackedEntry($teamMember, $project);
        $this->trackedEntry($outsider, $this->project()); // different, unrelated project

        $this->actingAs($pm, 'sanctum');
        $rows = collect($this->getJson($this->url())->json('data'));

        $this->assertContains($teamEntry->id, $rows->pluck('id')->all());
        // The outsider's row must not leak into a project-scoped view.
        $this->assertNotContains($outsider->name, $rows->pluck('user_name')->all());
    }

    // ── Multi-tenancy ─────────────────────────────────────────────────────

    public function test_cross_tenant_rows_are_never_visible(): void
    {
        $projectA = $this->project();
        $this->trackedEntry($this->employee, $projectA);

        $otherOrg = $this->createOrganization();
        $otherOwner = $this->createUser($otherOrg, 'owner');
        $otherUser = $this->createUser($otherOrg, 'employee');
        $projectB = Project::factory()->billable(100)->create([
            'organization_id' => $otherOrg->id, 'created_by' => $otherOwner->id,
        ]);
        $this->trackedEntry($otherUser, $projectB, $otherOrg);

        // Org B admin sees only org B's single row.
        $this->actingAs($otherOwner, 'sanctum');
        $response = $this->getJson($this->url());
        $this->assertEquals(1, $response->json('meta.summary.entry_count'));
        $names = collect($response->json('data'))->pluck('user_name')->all();
        $this->assertNotContains($this->employee->name, $names);
    }

    // ── Export: CSV ───────────────────────────────────────────────────────

    public function test_csv_export_is_streamed_download_with_metadata_and_sanitization(): void
    {
        // A project name that looks like a spreadsheet formula must be neutralized.
        $project = Project::factory()->billable(100)->create([
            'organization_id' => $this->org->id,
            'created_by' => $this->owner->id,
            'name' => '=cmd',
        ]);
        $this->trackedEntry($this->employee, $project);

        $this->actingAs($this->owner, 'sanctum');
        $response = $this->getJson($this->url([], '/export', ['format' => 'csv']));

        $response->assertOk();
        $this->assertStringContainsString('text/csv', $response->headers->get('Content-Type'));
        $this->assertStringContainsString('attachment', $response->headers->get('Content-Disposition'));

        $body = $response->streamedContent();
        // Metadata header block includes the exporting user's name.
        $this->assertStringContainsString('Exported By', $body);
        $this->assertStringContainsString($this->owner->name, $body);
        // Formula-injection neutralized: "=cmd" becomes "'=cmd".
        $this->assertStringContainsString("'=cmd", $body);
    }

    // ── Export: PDF ───────────────────────────────────────────────────────

    public function test_pdf_export_returns_pdf_for_small_result_set(): void
    {
        $project = $this->project();
        $this->trackedEntry($this->employee, $project);

        $this->actingAs($this->owner, 'sanctum');
        $response = $this->getJson($this->url([], '/export', ['format' => 'pdf']));

        $response->assertOk();
        $this->assertStringContainsString('application/pdf', $response->headers->get('Content-Type'));
    }

    public function test_pdf_export_rejects_result_set_over_row_cap(): void
    {
        $project = $this->project();
        $this->bulkTrackedEntries($this->employee, $project, 5001);

        $this->actingAs($this->owner, 'sanctum');
        $response = $this->getJson($this->url([], '/export', ['format' => 'pdf']));

        $response->assertStatus(422);
    }

    // ── Export: validation + permission ───────────────────────────────────

    public function test_export_requires_a_valid_format(): void
    {
        $this->actingAs($this->owner, 'sanctum');

        // Missing format.
        $this->getJson($this->url([], '/export'))
            ->assertStatus(422)->assertJsonValidationErrors(['format']);

        // Invalid format.
        $this->getJson($this->url([], '/export', ['format' => 'xlsx']))
            ->assertStatus(422)->assertJsonValidationErrors(['format']);
    }

    public function test_export_requires_export_permission(): void
    {
        // A user holding reports.view but NOT reports.export.
        $viewer = $this->makeRoleUser(['reports.view' => 'organization']);

        $this->actingAs($viewer, 'sanctum');
        $this->getJson($this->url([], '/export', ['format' => 'csv']))
            ->assertStatus(403);
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    private function project(): Project
    {
        return Project::factory()->billable(100)->create([
            'organization_id' => $this->org->id,
            'created_by' => $this->owner->id,
        ]);
    }

    private function trackedEntry(User $user, Project $project, ?Organization $org = null): TimeEntry
    {
        return TimeEntry::factory()->create([
            'organization_id' => ($org ?? $this->org)->id,
            'user_id' => $user->id,
            'project_id' => $project->id,
            'type' => 'tracked',
            'approval_status' => 'approved',
            'is_approved' => true,
            'started_at' => Carbon::parse(self::AT),
            'ended_at' => Carbon::parse(self::AT_END),
            'duration_seconds' => 7200,
        ]);
    }

    private function bulkTrackedEntries(User $user, Project $project, int $count): void
    {
        $now = now();
        $rows = [];
        for ($i = 0; $i < $count; $i++) {
            $rows[] = [
                'id' => (string) Str::uuid(),
                'organization_id' => $this->org->id,
                'user_id' => $user->id,
                'project_id' => $project->id,
                'type' => 'tracked',
                'approval_status' => 'approved',
                'is_approved' => true,
                'started_at' => self::AT,
                'ended_at' => self::AT_END,
                'duration_seconds' => 7200,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }
        foreach (array_chunk($rows, 1000) as $chunk) {
            DB::table('time_entries')->insert($chunk);
        }
    }

    /**
     * @param  array<string,string>  $params
     * @param  array<string,mixed>   $extra
     */
    private function url(array $params = [], string $suffix = '', array $extra = []): string
    {
        return '/api/v1/reports/project-time' . $suffix . '?' . http_build_query(array_merge([
            'period' => 'custom',
            'start_date' => self::START,
            'end_date' => self::END,
        ], $params, $extra));
    }

    /**
     * Create a user whose ONLY role is a custom role granting the given scopes
     * (the default employee role is removed so its scopes don't bleed in).
     *
     * @param array<string,string> $scopes  permission key => scope
     */
    private function makeRoleUser(array $scopes, ?Project $manages = null): User
    {
        $user = $this->createUser($this->org, 'employee');
        DB::table('user_roles')->where('user_id', $user->id)->delete();

        $roleId = (string) Str::uuid();
        DB::table('roles')->insert([
            'id' => $roleId,
            'organization_id' => $this->org->id,
            'name' => 'custom_' . Str::random(6),
            'display_name' => 'Custom',
            'is_system' => false,
            'is_default' => false,
            'priority' => 50,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        foreach ($scopes as $key => $scope) {
            $permId = DB::table('permissions')->where('key', $key)->value('id');
            DB::table('role_permissions')->insert([
                'id' => (string) Str::uuid(),
                'role_id' => $roleId,
                'permission_id' => $permId,
                'scope' => $scope,
                'created_at' => now(),
            ]);
        }

        DB::table('user_roles')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $user->id,
            'role_id' => $roleId,
            'assigned_by' => null,
            'assigned_at' => now(),
        ]);

        if ($manages) {
            DB::table('projects')->where('id', $manages->id)->update(['manager_id' => $user->id]);
        }

        return $user->fresh();
    }
}
