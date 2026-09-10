<?php

namespace Tests\Feature\Api;

use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Carbon\Carbon;
use Tests\TestCase;

/**
 * GET /dashboard/team-trend — the admin chart's per-day series.
 *
 * Replaces a client-side fake (everyone's today_seconds on today, zero on the
 * other days), so the headline assertion is that hours land on the day they
 * were worked and the window has one row per day with no holes.
 */
class DashboardTeamTrendTest extends TestCase
{
    private Organization $org;
    private User $manager;
    private User $a;
    private User $b;

    protected function setUp(): void
    {
        parent::setUp();
        $this->org = $this->createOrganization();
        $this->manager = $this->createUser($this->org, 'org_manager');
        $this->a = $this->createUser($this->org, 'employee');
        $this->b = $this->createUser($this->org, 'employee');
    }

    private function entry(User $u, Carbon $start, float $hours, array $overrides = []): void
    {
        TimeEntry::factory()->create(array_merge([
            'organization_id' => $this->org->id,
            'user_id' => $u->id,
            'started_at' => $start,
            'ended_at' => $start->copy()->addMinutes((int) round($hours * 60)),
            'type' => 'tracked',
            'approval_status' => 'approved',
        ], $overrides));
    }

    public function test_hours_land_on_the_day_they_were_worked_and_sum_across_the_team(): void
    {
        $tz = $this->manager->getTimezoneForDates();
        $today = Carbon::now($tz)->startOfDay();
        $yesterday = $today->copy()->subDay();

        $this->entry($this->a, $today->copy()->addHours(10)->utc(), 3);
        $this->entry($this->b, $today->copy()->addHours(11)->utc(), 2);
        $this->entry($this->a, $yesterday->copy()->addHours(10)->utc(), 4);

        $this->actingAs($this->manager, 'sanctum');
        $res = $this->getJson('/api/v1/dashboard/team-trend?period=7d');

        $res->assertOk();
        $rows = collect($res->json('data'));
        $this->assertCount(7, $rows);
        $this->assertSame(5.0, (float) $rows->firstWhere('date', $today->toDateString())['hours']);
        $this->assertSame(4.0, (float) $rows->firstWhere('date', $yesterday->toDateString())['hours']);
        // Every other day is present as zero — no holes in the axis.
        $this->assertSame(5, $rows->where('hours', 0)->count());
    }

    public function test_period_widens_the_window(): void
    {
        $this->actingAs($this->manager, 'sanctum');

        $this->assertCount(30, $this->getJson('/api/v1/dashboard/team-trend?period=30d')->json('data'));
        $this->assertCount(90, $this->getJson('/api/v1/dashboard/team-trend?period=90d')->json('data'));
        $this->getJson('/api/v1/dashboard/team-trend?period=1y')->assertStatus(422);
    }

    public function test_only_worked_time_counts(): void
    {
        $tz = $this->manager->getTimezoneForDates();
        $today = Carbon::now($tz)->startOfDay()->addHours(9)->utc();

        $this->entry($this->a, $today, 2);
        $this->entry($this->a, $today->copy()->addHours(3), 5, ['type' => 'idle']);
        $this->entry($this->b, $today, 4, ['type' => 'manual', 'approval_status' => 'pending']);

        $this->actingAs($this->manager, 'sanctum');
        $rows = collect($this->getJson('/api/v1/dashboard/team-trend')->json('data'));

        $this->assertSame(2.0, (float) $rows->last()['hours']);
    }

    public function test_employee_role_is_refused(): void
    {
        $this->actingAs($this->a, 'sanctum');
        $this->getJson('/api/v1/dashboard/team-trend')->assertStatus(403);
    }

    public function test_cross_org_hours_never_appear(): void
    {
        $other = $this->createOrganization();
        $twin = $this->createUser($other, 'employee');
        $now = Carbon::now()->subHours(2);

        TimeEntry::factory()->create([
            'organization_id' => $other->id,
            'user_id' => $twin->id,
            'started_at' => $now,
            'ended_at' => $now->copy()->addHours(8),
            'type' => 'tracked',
            'approval_status' => 'approved',
        ]);

        $this->actingAs($this->manager, 'sanctum');
        $rows = collect($this->getJson('/api/v1/dashboard/team-trend')->json('data'));

        $this->assertSame(0.0, (float) $rows->sum('hours'));
    }
}
