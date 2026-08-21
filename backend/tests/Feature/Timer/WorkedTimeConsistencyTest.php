<?php

namespace Tests\Feature\Timer;

use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\ReportService;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Every surface that reports time must report the SAME number for the same range.
 *
 * They did not. Over one 60-day window the product answered four different ways:
 * the reports tab said 23.02h, the report builder 31.52h, the dashboard 31.51h,
 * and the Time page 31.68h — of which it displayed only the slice on screen.
 * Four causes, one per surface:
 *
 *   1. The reports-tab KPI filtered type='tracked', dropping approved MANUAL time.
 *   2. Its charts and log tables filtered nothing, so they counted IDLE time.
 *   3. The dashboard summed `duration_seconds`, a desktop-written column that
 *      holds corrupt values — including NEGATIVE ones, which a SUM() subtracts.
 *   4. The Time page summed the page it had been handed, i.e. 20 rows, and showed
 *      that next to an "Entries" count covering every match.
 *
 * These tests pin the shared contract: worked time = every APPROVED, non-idle
 * entry, measured from its timestamps and clamped, bucketed in the org timezone.
 */
class WorkedTimeConsistencyTest extends TestCase
{
    private Organization $org;
    private User $owner;
    private User $employee;

    private const DAY = '2026-06-17';
    private const FROM = '2026-06-16';
    private const TO = '2026-06-18';

    private const TRACKED_SECONDS = 7200;   // 2h
    private const MANUAL_SECONDS = 3600;    // 1h
    private const IDLE_SECONDS = 1800;      // 30m — must never count
    private const WORKED_SECONDS = 10800;   // tracked + manual

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow(Carbon::parse(self::DAY . ' 20:00:00', 'UTC'));

        $this->org = $this->createOrganization();
        $this->owner = $this->createUser($this->org, 'owner');
        $this->employee = $this->createUser($this->org, 'employee');
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function entry(string $type, string $start, int $seconds, string $status = 'approved'): TimeEntry
    {
        $startedAt = Carbon::parse(self::DAY . ' ' . $start, 'UTC');

        return TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'type' => $type,
            'started_at' => $startedAt,
            'ended_at' => $startedAt->copy()->addSeconds($seconds),
            'duration_seconds' => $seconds,
            'approval_status' => $status,
            'is_approved' => $status === 'approved',
        ]);
    }

    /** tracked 2h + approved manual 1h + idle 30m. Worked = 3h. */
    private function baseline(): void
    {
        $this->entry('tracked', '08:00:00', self::TRACKED_SECONDS);
        $this->entry('manual', '11:00:00', self::MANUAL_SECONDS);
        $this->entry('idle', '13:00:00', self::IDLE_SECONDS);
    }

    public function test_every_surface_reports_the_same_worked_total(): void
    {
        $this->baseline();
        $this->actingAs($this->owner, 'sanctum');

        $expectedHours = round(self::WORKED_SECONDS / 3600, 1); // 3.0

        // 1. Report builder / summary
        $summary = app(ReportService::class)->summary(
            $this->org->id, null, self::FROM . ' 00:00:00', self::TO . ' 00:00:00'
        );
        $this->assertSame(self::WORKED_SECONDS, (int) $summary['total_seconds_worked'], 'report builder');

        // 2. Reports tab KPI — used to filter type='tracked' and drop the manual hour
        $analytics = app(ReportService::class)->analytics(
            $this->org->id, null, self::FROM . ' 00:00:00', self::TO . ' 00:00:00'
        );
        $this->assertSame(
            $expectedHours,
            $analytics['kpis']['total_tracked_hours']['value'],
            'reports tab KPI must count approved manual time and exclude idle'
        );

        // 3. Dashboard (the per-user card lives on the employee dashboard)
        $this->actingAs($this->employee, 'sanctum');
        $dashboard = $this->getJson('/api/v1/dashboard?date_from=' . self::FROM . '&date_to=' . self::TO)
            ->assertOk()->json();
        $this->assertSame(self::WORKED_SECONDS, (int) $dashboard['today_seconds'], 'dashboard');

        // 4. Time page card
        $entries = $this->getJson('/api/v1/time-entries?date_from=' . self::FROM . '&date_to=' . self::TO)
            ->assertOk()->json();
        $this->assertSame(self::WORKED_SECONDS, (int) $entries['total_seconds'], 'time page card');

        // 5. Time series — the daily rows must sum to the same headline
        $this->assertSame(
            self::WORKED_SECONDS,
            (int) collect($summary['daily'])->sum('worked_seconds'),
            'daily series must reconcile with the headline total'
        );
    }

    public function test_idle_time_is_never_counted_as_worked_time(): void
    {
        $this->baseline();
        $this->actingAs($this->owner, 'sanctum');

        $entries = $this->getJson('/api/v1/time-entries?date_from=' . self::FROM . '&date_to=' . self::TO)
            ->assertOk()->json();

        $this->assertSame(self::WORKED_SECONDS, (int) $entries['total_seconds']);
        $this->assertSame(self::IDLE_SECONDS, (int) $entries['idle_seconds'], 'idle is reported separately, not folded in');
    }

    public function test_a_corrupt_duration_seconds_column_cannot_move_any_total(): void
    {
        $this->baseline();

        // Exactly the corruption present in real data: a negative stored duration,
        // which a SUM(duration_seconds) subtracts from the day's total.
        DB::table('time_entries')
            ->where('organization_id', $this->org->id)
            ->where('type', 'tracked')
            ->update(['duration_seconds' => -9999]);

        $summary = app(ReportService::class)->summary(
            $this->org->id, null, self::FROM . ' 00:00:00', self::TO . ' 00:00:00'
        );
        $this->assertSame(self::WORKED_SECONDS, (int) $summary['total_seconds_worked']);

        $this->actingAs($this->employee, 'sanctum');
        $dashboard = $this->getJson('/api/v1/dashboard?date_from=' . self::FROM . '&date_to=' . self::TO)
            ->assertOk()->json();
        $this->assertSame(self::WORKED_SECONDS, (int) $dashboard['today_seconds']);

        $entries = $this->getJson('/api/v1/time-entries?date_from=' . self::FROM . '&date_to=' . self::TO)
            ->assertOk()->json();
        $this->assertSame(self::WORKED_SECONDS, (int) $entries['total_seconds']);
    }

    public function test_time_entry_total_covers_the_whole_filtered_set_not_one_page(): void
    {
        // 25 half-hour entries = 12.5h, deliberately more than one page of 10.
        for ($i = 0; $i < 25; $i++) {
            $startedAt = Carbon::parse(self::DAY . ' 00:00:00', 'UTC')->addMinutes($i * 31);
            TimeEntry::factory()->create([
                'organization_id' => $this->org->id,
                'user_id' => $this->employee->id,
                'type' => 'tracked',
                'started_at' => $startedAt,
                'ended_at' => $startedAt->copy()->addMinutes(30),
                'duration_seconds' => 1800,
                'approval_status' => 'approved',
                'is_approved' => true,
            ]);
        }

        $this->actingAs($this->owner, 'sanctum');

        $expected = 25 * 1800;

        $page1 = $this->getJson('/api/v1/time-entries?per_page=10&page=1&date_from=' . self::FROM . '&date_to=' . self::TO)
            ->assertOk()->json();
        $page3 = $this->getJson('/api/v1/time-entries?per_page=10&page=3&date_from=' . self::FROM . '&date_to=' . self::TO)
            ->assertOk()->json();

        $this->assertCount(10, $page1['data']);
        $this->assertSame(25, (int) $page1['total'], 'entry count covers the filtered set');
        $this->assertSame($expected, (int) $page1['total_seconds'], 'total must cover all 25, not the 10 on screen');

        // The headline must not move as the user pages.
        $this->assertSame(
            (int) $page1['total_seconds'],
            (int) $page3['total_seconds'],
            'the total changed between pages'
        );
    }

    public function test_pending_manual_time_is_excluded_from_the_time_page_total(): void
    {
        $this->entry('tracked', '08:00:00', self::TRACKED_SECONDS);
        $this->entry('manual', '11:00:00', self::MANUAL_SECONDS, 'pending');

        $this->actingAs($this->owner, 'sanctum');

        $entries = $this->getJson('/api/v1/time-entries?date_from=' . self::FROM . '&date_to=' . self::TO)
            ->assertOk()->json();

        $this->assertSame(self::TRACKED_SECONDS, (int) $entries['total_seconds']);
        $this->assertSame(self::MANUAL_SECONDS, (int) $entries['unapproved_seconds']);
    }

    public function test_daily_series_buckets_by_the_organization_timezone_not_utc(): void
    {
        // Asia/Karachi is UTC+5. 2026-06-17 21:00 UTC is 2026-06-18 02:00 locally,
        // so this hour belongs to the 18th. Grouping on the raw UTC date filed it
        // under the 17th, which is how the series disagreed with the dashboard.
        $this->org->settings = array_merge($this->org->settings ?? [], ['timezone' => 'Asia/Karachi']);
        $this->org->save();

        $startedAt = Carbon::parse('2026-06-17 21:00:00', 'UTC');
        TimeEntry::factory()->create([
            'organization_id' => $this->org->id,
            'user_id' => $this->employee->id,
            'type' => 'tracked',
            'started_at' => $startedAt,
            'ended_at' => $startedAt->copy()->addHour(),
            'duration_seconds' => 3600,
            'approval_status' => 'approved',
            'is_approved' => true,
        ]);

        $summary = app(ReportService::class)->summary(
            $this->org->id, null, '2026-06-16 00:00:00', '2026-06-19 00:00:00'
        );

        $dates = collect($summary['daily'])->pluck('date')->map(fn ($d) => substr((string) $d, 0, 10))->all();

        $this->assertContains('2026-06-18', $dates, 'entry must land on its LOCAL day');
        $this->assertNotContains('2026-06-17', $dates, 'entry must not land on the UTC day');
    }
}
