<?php

namespace Tests\Feature\Hr;

use App\Models\AttendanceRecord;
use App\Models\Team;
use App\Models\User;
use Carbon\Carbon;
use Tests\TestCase;

/**
 * Role → permission matrix for the check-in / checkout feature.
 *
 * Final matrix (all attendance.* permissions):
 *   attendance.view        : owner(bypass), org_manager, hr_manager, finance_manager (org),
 *                            manager=team, employee=own
 *   attendance.view_all    : owner(bypass), org_manager, hr_manager, finance_manager
 *   attendance.export      : owner(bypass), org_manager, hr_manager, finance_manager
 *   attendance.manage_policy (PUT policy): owner(bypass), org_manager, hr_manager  (NOT finance)
 *   attendance.check_in    : every role (all org members check themselves in/out)
 *
 * Owner bypass is verified end-to-end (route middleware + policy) — owners get no
 * explicit attendance.* grants in the seeder yet still pass every gate.
 */
class CheckInRoleMatrixTest extends TestCase
{
    private const DATE = '2026-03-16'; // Monday

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

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
            'is_early_checkout' => false,
            'missing_checkout' => false,
        ], $overrides));
    }

    /** Assert the acting user has org-wide visibility (both employees) + can export. */
    private function assertCanViewAllAndExport(array $empIds): void
    {
        $summary = $this->getJson('/api/v1/hr/attendance/check-ins/summary?period=day&date=' . self::DATE);
        $summary->assertOk();
        $seen = collect($summary->json('data'))->pluck('user.id')->all();
        foreach ($empIds as $id) {
            $this->assertContains($id, $seen);
        }

        $export = $this->get('/api/v1/hr/attendance/check-ins/export?period=day&date=' . self::DATE);
        $export->assertOk();
        $export->assertHeader('Content-Type', 'text/csv; charset=UTF-8');
    }

    private function putPolicy(): \Illuminate\Testing\TestResponse
    {
        return $this->putJson('/api/v1/hr/attendance/policy', [
            'check_in_time' => '10:00:00',
            'late_threshold' => '10:15:00',
            'checkout_time' => '19:00:00',
            'timezone' => 'Asia/Karachi',
        ]);
    }

    // ── Elevated roles: view_all + export + edit policy ────────────────────

    public function test_owner_can_view_all_summary_export_and_edit_policy(): void
    {
        $org = $this->createOrganization();
        // Owner gets NO explicit attendance.* grants — pure bypass path.
        $owner = $this->createUser($org, 'owner');
        $emp1 = $this->createUser($org, 'employee');
        $emp2 = $this->createUser($org, 'employee');
        $this->checkInRecord($org->id, $emp1->id);
        $this->checkInRecord($org->id, $emp2->id);

        $this->actingAs($owner, 'sanctum');

        $this->assertCanViewAllAndExport([$emp1->id, $emp2->id]);
        $this->putPolicy()->assertOk();
    }

    public function test_org_manager_can_view_all_export_and_edit_policy(): void
    {
        $org = $this->createOrganization();
        $admin = $this->createUser($org, 'org_manager');
        $emp1 = $this->createUser($org, 'employee');
        $emp2 = $this->createUser($org, 'employee');
        $this->checkInRecord($org->id, $emp1->id);
        $this->checkInRecord($org->id, $emp2->id);

        $this->actingAs($admin, 'sanctum');

        $this->assertCanViewAllAndExport([$emp1->id, $emp2->id]);
        $this->putPolicy()->assertOk();
    }

    public function test_hr_manager_can_view_all_export_and_edit_policy(): void
    {
        $org = $this->createOrganization();
        $hr = $this->createUser($org, 'hr_manager');
        $emp1 = $this->createUser($org, 'employee');
        $emp2 = $this->createUser($org, 'employee');
        $this->checkInRecord($org->id, $emp1->id);
        $this->checkInRecord($org->id, $emp2->id);

        $this->actingAs($hr, 'sanctum');

        $this->assertCanViewAllAndExport([$emp1->id, $emp2->id]);
        $this->putPolicy()->assertOk();
    }

    public function test_finance_manager_can_view_all_and_export_but_cannot_edit_policy(): void
    {
        $org = $this->createOrganization();
        $finance = $this->createUser($org, 'finance_manager');
        $emp1 = $this->createUser($org, 'employee');
        $emp2 = $this->createUser($org, 'employee');
        $this->checkInRecord($org->id, $emp1->id);
        $this->checkInRecord($org->id, $emp2->id);

        $this->actingAs($finance, 'sanctum');

        $this->assertCanViewAllAndExport([$emp1->id, $emp2->id]);
        // Finance must NOT be able to change the check-in windows.
        $this->putPolicy()->assertStatus(403);
    }

    // ── Restricted roles: scoped view + no export ──────────────────────────

    public function test_manager_sees_only_team_and_cannot_export(): void
    {
        $org = $this->createOrganization();
        $manager = $this->createUser($org, 'employee'); // team lead via Team.manager_id
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

        $list = $this->getJson('/api/v1/hr/attendance/check-ins');
        $list->assertOk();
        $ids = collect($list->json('data'))->pluck('user_id')->unique()->all();
        $this->assertContains($manager->id, $ids);
        $this->assertContains($teamMember->id, $ids);
        $this->assertNotContains($outsider->id, $ids);

        // No attendance.export permission for a team lead.
        $this->get('/api/v1/hr/attendance/check-ins/export?period=day&date=' . self::DATE)
            ->assertStatus(403);
    }

    public function test_employee_sees_only_own_and_cannot_export(): void
    {
        $org = $this->createOrganization();
        $emp1 = $this->createUser($org, 'employee');
        $emp2 = $this->createUser($org, 'employee');
        $this->checkInRecord($org->id, $emp1->id);
        $this->checkInRecord($org->id, $emp2->id);

        $this->actingAs($emp1, 'sanctum');

        $list = $this->getJson('/api/v1/hr/attendance/check-ins');
        $list->assertOk();
        $ids = collect($list->json('data'))->pluck('user_id')->unique()->all();
        $this->assertSame([$emp1->id], $ids);

        $this->get('/api/v1/hr/attendance/check-ins/export?period=day&date=' . self::DATE)
            ->assertStatus(403);
    }

    // ── Every role can check themselves in ─────────────────────────────────

    public function test_all_elevated_roles_can_check_themselves_in(): void
    {
        $org = $this->createOrganization();

        // 06:40 UTC = 11:40 Asia/Karachi — inside the default check-in window.
        Carbon::setTestNow(Carbon::parse(self::DATE . ' 06:40:00', 'UTC'));

        foreach (['owner', 'org_manager', 'hr_manager', 'finance_manager', 'employee'] as $role) {
            $user = $this->createUser($org, $role);
            $this->actingAs($user, 'sanctum');

            $this->postJson('/api/v1/hr/attendance/check-in')
                ->assertStatus(201);

            $this->assertDatabaseHas('attendance_records', [
                'user_id' => $user->id,
                'date' => self::DATE,
                'check_in_status' => 'on_time',
            ]);
        }
    }
}
