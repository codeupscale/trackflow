<?php

namespace Tests\Feature\Hr;

use App\Models\AttendanceRecord;
use App\Models\Team;
use Carbon\Carbon;
use Tests\TestCase;

/**
 * Role-scoped listing, per-employee summary rollups, and CSV export for the
 * check-in / checkout feature (added scope).
 *
 * Scoping matrix under test:
 *   employee    -> own records only
 *   team manager-> self + direct reports (managed teams)
 *   hr_manager  -> ALL org employees (via attendance.view_all)
 *   admin/owner -> all
 */
class CheckInReportTest extends TestCase
{
    private const DATE = '2026-03-16';
    private const MONTH = '2026-03';

    /** Create a check-in attendance record with explicit session columns. */
    private function checkInRecord(string $orgId, string $userId, array $overrides = []): AttendanceRecord
    {
        return AttendanceRecord::factory()->create(array_merge([
            'organization_id' => $orgId,
            'user_id' => $userId,
            'date' => self::DATE,
            'status' => 'present',
            'check_in_at' => Carbon::parse(self::DATE . ' 06:40:00', 'UTC'),
            'check_out_at' => Carbon::parse(self::DATE . ' 15:30:00', 'UTC'),
            'worked_seconds' => 3600,
            'check_in_status' => 'on_time',
            'check_in_late_minutes' => 0,
            'check_out_early_minutes' => 0,
            'check_out_overtime_minutes' => 0,
            'is_early_checkout' => false,
            'missing_checkout' => false,
        ], $overrides));
    }

    // ── Role-scoped listing ────────────────────────────────────────────────

    public function test_hr_manager_sees_all_org_check_ins(): void
    {
        $org = $this->createOrganization();
        $hr = $this->createUser($org, 'hr_manager');
        $emp1 = $this->createUser($org, 'employee');
        $emp2 = $this->createUser($org, 'employee');

        $this->checkInRecord($org->id, $emp1->id);
        $this->checkInRecord($org->id, $emp2->id);

        $this->actingAs($hr, 'sanctum');
        $response = $this->getJson('/api/v1/hr/attendance/check-ins');

        $response->assertOk();
        $userIds = collect($response->json('data'))->pluck('user_id')->all();
        $this->assertContains($emp1->id, $userIds);
        $this->assertContains($emp2->id, $userIds);
    }

    public function test_manager_sees_only_team_check_ins(): void
    {
        $org = $this->createOrganization();
        $manager = $this->createUser($org, 'employee');       // team lead (Team.manager_id)
        $teamMember = $this->createUser($org, 'employee');
        $outsider = $this->createUser($org, 'employee');

        $team = Team::factory()->create([
            'organization_id' => $org->id,
            'manager_id' => $manager->id,
        ]);
        $team->members()->attach($teamMember->id);

        $this->checkInRecord($org->id, $manager->id);
        $this->checkInRecord($org->id, $teamMember->id);
        $this->checkInRecord($org->id, $outsider->id);

        $this->actingAs($manager, 'sanctum');
        $response = $this->getJson('/api/v1/hr/attendance/check-ins');

        $response->assertOk();
        $userIds = collect($response->json('data'))->pluck('user_id')->unique()->all();
        $this->assertContains($manager->id, $userIds);
        $this->assertContains($teamMember->id, $userIds);
        $this->assertNotContains($outsider->id, $userIds);
    }

    public function test_employee_sees_only_own_check_ins(): void
    {
        $org = $this->createOrganization();
        $emp1 = $this->createUser($org, 'employee');
        $emp2 = $this->createUser($org, 'employee');

        $this->checkInRecord($org->id, $emp1->id);
        $this->checkInRecord($org->id, $emp2->id);

        $this->actingAs($emp1, 'sanctum');
        $response = $this->getJson('/api/v1/hr/attendance/check-ins');

        $response->assertOk();
        $userIds = collect($response->json('data'))->pluck('user_id')->unique()->all();
        $this->assertSame([$emp1->id], $userIds);
    }

    // ── Summary rollups ────────────────────────────────────────────────────

    public function test_summary_day_returns_per_employee_totals(): void
    {
        $org = $this->createOrganization();
        $hr = $this->createUser($org, 'hr_manager');
        $emp1 = $this->createUser($org, 'employee');
        $emp2 = $this->createUser($org, 'employee');

        $this->checkInRecord($org->id, $emp1->id, ['worked_seconds' => 3600]); // 01:00
        $this->checkInRecord($org->id, $emp2->id, ['worked_seconds' => 7200]); // 02:00

        $this->actingAs($hr, 'sanctum');
        $response = $this->getJson('/api/v1/hr/attendance/check-ins/summary?period=day&date=' . self::DATE);

        $response->assertOk()
            ->assertJsonStructure([
                'data' => [
                    '*' => [
                        'user' => ['id', 'name', 'email'],
                        'total_worked_seconds', 'worked_hhmm', 'days_present',
                        'late_count', 'early_checkout_count', 'missing_checkout_count',
                    ],
                ],
            ]);

        $rows = collect($response->json('data'))->keyBy('user.id');
        $this->assertSame(3600, $rows[$emp1->id]['total_worked_seconds']);
        $this->assertSame('01:00', $rows[$emp1->id]['worked_hhmm']);
        $this->assertSame(1, $rows[$emp1->id]['days_present']);
        $this->assertSame(7200, $rows[$emp2->id]['total_worked_seconds']);
        $this->assertSame('02:00', $rows[$emp2->id]['worked_hhmm']);
    }

    public function test_summary_month_returns_rollup_counts(): void
    {
        $org = $this->createOrganization();
        $hr = $this->createUser($org, 'hr_manager');
        $emp = $this->createUser($org, 'employee');

        // Four days in March: 1 late, 1 early-checkout, 1 missing-checkout, 1 clean.
        $this->checkInRecord($org->id, $emp->id, ['date' => '2026-03-02', 'worked_seconds' => 3600]);
        $this->checkInRecord($org->id, $emp->id, ['date' => '2026-03-03', 'worked_seconds' => 3600, 'check_in_status' => 'late', 'check_in_late_minutes' => 20]);
        $this->checkInRecord($org->id, $emp->id, ['date' => '2026-03-04', 'worked_seconds' => 1800, 'is_early_checkout' => true, 'check_out_early_minutes' => 30]);
        $this->checkInRecord($org->id, $emp->id, ['date' => '2026-03-05', 'worked_seconds' => null, 'check_out_at' => null, 'missing_checkout' => true]);

        $this->actingAs($hr, 'sanctum');
        $response = $this->getJson('/api/v1/hr/attendance/check-ins/summary?period=month&month=' . self::MONTH . '&user_id=' . $emp->id);

        $response->assertOk();
        $row = collect($response->json('data'))->firstWhere('user.id', $emp->id);

        $this->assertNotNull($row);
        $this->assertSame(4, $row['days_present']);
        $this->assertSame(1, $row['late_count']);
        $this->assertSame(1, $row['early_checkout_count']);
        $this->assertSame(1, $row['missing_checkout_count']);
        $this->assertSame(9000, $row['total_worked_seconds']); // 3600+3600+1800+0
        $this->assertSame('02:30', $row['worked_hhmm']);
    }

    // ── CSV export ─────────────────────────────────────────────────────────

    public function test_export_day_all_employees(): void
    {
        $org = $this->createOrganization();
        $hr = $this->createUser($org, 'hr_manager');
        $emp1 = $this->createUser($org, 'employee', ['email' => 'alice@example.test']);
        $emp2 = $this->createUser($org, 'employee', ['email' => 'bob@example.test']);

        $this->checkInRecord($org->id, $emp1->id);
        $this->checkInRecord($org->id, $emp2->id);

        $this->actingAs($hr, 'sanctum');
        $response = $this->get('/api/v1/hr/attendance/check-ins/export?period=day&date=' . self::DATE);

        $response->assertOk();
        $response->assertHeader('Content-Type', 'text/csv; charset=UTF-8');
        $response->assertHeader(
            'Content-Disposition',
            'attachment; filename="check-ins-detail-day-' . self::DATE . '.csv"'
        );

        $body = $response->getContent();
        $this->assertStringContainsString('Employee,Email,Date,Sessions,"First In","Last Out","Total (HH:MM)"', $body);
        $this->assertStringContainsString('alice@example.test', $body);
        $this->assertStringContainsString('bob@example.test', $body);
        // First In / Last Out render as 12-hour clock times in the org policy tz
        // (06:40 UTC → 11:40 AM, 15:30 UTC → 8:30 PM in Asia/Karachi).
        $this->assertStringContainsString('11:40 AM', $body);
        $this->assertStringContainsString('8:30 PM', $body);
    }

    public function test_export_month_single_employee(): void
    {
        $org = $this->createOrganization();
        $hr = $this->createUser($org, 'hr_manager');
        $emp1 = $this->createUser($org, 'employee', ['email' => 'alice@example.test']);
        $emp2 = $this->createUser($org, 'employee', ['email' => 'bob@example.test']);

        $this->checkInRecord($org->id, $emp1->id, ['date' => '2026-03-10']);
        $this->checkInRecord($org->id, $emp2->id, ['date' => '2026-03-10']);

        $this->actingAs($hr, 'sanctum');
        $response = $this->get('/api/v1/hr/attendance/check-ins/export?period=month&month=' . self::MONTH . '&user_id=' . $emp1->id);

        $response->assertOk();
        $response->assertHeader(
            'Content-Disposition',
            'attachment; filename="check-ins-detail-month-' . self::MONTH . '.csv"'
        );

        $body = $response->getContent();
        $this->assertStringContainsString('alice@example.test', $body);
        $this->assertStringNotContainsString('bob@example.test', $body);
    }

    public function test_detail_export_renders_human_durations_and_renamed_headers(): void
    {
        $org = $this->createOrganization();
        $hr = $this->createUser($org, 'hr_manager');
        $late = $this->createUser($org, 'employee', ['email' => 'late@example.test']);
        $overtime = $this->createUser($org, 'employee', ['email' => 'ot@example.test']);
        $clean = $this->createUser($org, 'employee', ['email' => 'clean@example.test']);

        // Late by 1h16m AND early checkout by 5h56m (356m ≈ a 2:34 PM checkout).
        $this->checkInRecord($org->id, $late->id, [
            'check_in_status' => 'late',
            'check_in_late_minutes' => 76,
            'is_early_checkout' => true,
            'check_out_early_minutes' => 356,
            'check_out_overtime_minutes' => 0,
        ]);
        // Overtime by 45m (mutually exclusive with early checkout).
        $this->checkInRecord($org->id, $overtime->id, [
            'check_out_early_minutes' => 0,
            'check_out_overtime_minutes' => 45,
        ]);
        // Clean row: all zeros → empty duration cells.
        $this->checkInRecord($org->id, $clean->id);

        $this->actingAs($hr, 'sanctum');
        $response = $this->get('/api/v1/hr/attendance/check-ins/export?period=day&date=' . self::DATE);

        $response->assertOk();
        $body = $response->getContent();

        // Renamed headers (Late By / Early Checkout By / Overtime replace the raw "(min)" ones).
        $this->assertStringContainsString('"Late By","Early Checkout By",Overtime,"Missing Checkout"', $body);
        $this->assertStringNotContainsString('Late (min)', $body);
        $this->assertStringNotContainsString('Early (min)', $body);
        $this->assertStringNotContainsString('Overtime (min)', $body);

        // Human-readable durations, not raw minute integers.
        $this->assertStringContainsString('1h 16m', $body); // 76m late
        $this->assertStringContainsString('5h 56m', $body); // 356m early checkout
        $this->assertStringContainsString('45m', $body);    // 45m overtime

        // Clean row (present, zero late/early/overtime) leaves the duration cells empty.
        $this->assertStringContainsString('present,,,,no', $body);
    }

    public function test_export_summary_view_rollup_columns(): void
    {
        $org = $this->createOrganization();
        $hr = $this->createUser($org, 'hr_manager');
        $emp = $this->createUser($org, 'employee', ['email' => 'alice@example.test']);

        $this->checkInRecord($org->id, $emp->id, ['check_in_status' => 'late']);

        $this->actingAs($hr, 'sanctum');
        $response = $this->get('/api/v1/hr/attendance/check-ins/export?period=day&date=' . self::DATE . '&view=summary');

        $response->assertOk();
        $response->assertHeader(
            'Content-Disposition',
            'attachment; filename="check-ins-summary-day-' . self::DATE . '.csv"'
        );

        $body = $response->getContent();
        $this->assertStringContainsString('Employee,Email,"Total (HH:MM)","Days Present","Late Count"', $body);
        $this->assertStringContainsString('alice@example.test', $body);
    }

    public function test_export_requires_attendance_export_permission(): void
    {
        $org = $this->createOrganization();
        $employee = $this->createUser($org, 'employee');
        $this->actingAs($employee, 'sanctum');

        $this->get('/api/v1/hr/attendance/check-ins/export?period=day&date=' . self::DATE)
            ->assertStatus(403);
    }

    // ── Cross-org isolation ────────────────────────────────────────────────

    public function test_check_in_summary_cross_org_isolation(): void
    {
        $orgA = $this->createOrganization();
        $orgB = $this->createOrganization();

        $empA = $this->createUser($orgA, 'employee');
        $this->checkInRecord($orgA->id, $empA->id);

        $hrB = $this->createUser($orgB, 'hr_manager');
        $this->actingAs($hrB, 'sanctum');

        $response = $this->getJson('/api/v1/hr/attendance/check-ins/summary?period=day&date=' . self::DATE);
        $response->assertOk();

        $userIds = collect($response->json('data'))->pluck('user.id')->all();
        $this->assertNotContains($empA->id, $userIds);
        $this->assertCount(0, $response->json('data'));
    }

    // ── CSV formula-injection neutralization (OWASP) ───────────────────────

    public function test_export_neutralizes_csv_formula_injection_in_detail_and_summary(): void
    {
        $org = $this->createOrganization();
        $hr = $this->createUser($org, 'hr_manager');
        // Employee-controlled display name carrying a formula/DDE payload.
        $attacker = $this->createUser($org, 'employee', [
            'name' => '=cmd|/c calc',
            'email' => 'attacker@example.test',
        ]);
        $this->checkInRecord($org->id, $attacker->id, ['check_in_status' => 'late']);

        $this->actingAs($hr, 'sanctum');

        // Detail export: the name cell must be prefixed with a single quote.
        $detail = $this->get('/api/v1/hr/attendance/check-ins/export?period=day&date=' . self::DATE);
        $detail->assertOk();
        $detailBody = $detail->getContent();
        $this->assertStringContainsString("'=cmd|/c calc", $detailBody);
        $this->assertStringNotContainsString(',=cmd|/c calc', $detailBody);

        // Summary export: same neutralization on the rollup row.
        $summary = $this->get('/api/v1/hr/attendance/check-ins/export?period=day&date=' . self::DATE . '&view=summary');
        $summary->assertOk();
        $summaryBody = $summary->getContent();
        $this->assertStringContainsString("'=cmd|/c calc", $summaryBody);
        $this->assertStringNotContainsString(',=cmd|/c calc', $summaryBody);
    }
}
