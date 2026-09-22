<?php

namespace Tests\Feature\Hr;

use App\Models\AttendanceRecord;
use App\Models\Shift;
use App\Models\User;
use App\Services\CheckInService;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Leaving before the hours are done, with or without an explanation.
 *
 * The rule the whole feature rests on: a reason SOFTENS the short-day flag, it
 * never removes it. The hours are still missing either way — what changes is
 * whether HR has to go and ask why.
 */
class EarlyCheckoutReasonTest extends TestCase
{
    private const MONDAY = '2026-03-16';

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function assignShift(User $user): Shift
    {
        // 11:30 → 20:30 = a 9-hour day.
        $shift = Shift::create([
            'organization_id' => $user->organization_id,
            'name' => 'Morning Shift',
            'start_time' => '11:30:00',
            'end_time' => '20:30:00',
            'grace_period_minutes' => 15,
            'timezone' => 'Asia/Karachi',
            'is_active' => true,
            'days_of_week' => [1, 2, 3, 4, 5],
        ]);

        DB::table('user_shifts')->insert([
            'id' => (string) Str::uuid(),
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'shift_id' => $shift->id,
            'effective_from' => Carbon::parse(self::MONDAY)->subWeek()->toDateString(),
            'effective_to' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $shift;
    }

    /** Check in at 11:30 Karachi (06:30 UTC), then check out $hours later. */
    private function workUntil(User $user, string $utcCheckout, ?array $reason = null): AttendanceRecord
    {
        Carbon::setTestNow(Carbon::parse(self::MONDAY . ' 06:30:00', 'UTC'));
        app(CheckInService::class)->checkIn($user);

        Carbon::setTestNow(Carbon::parse(self::MONDAY . ' ' . $utcCheckout, 'UTC'));

        return app(CheckInService::class)->checkOut($user, $reason);
    }

    public function test_a_short_day_with_a_reason_records_it(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $approver = $this->createUser($org, 'hr_manager');
        $this->assignShift($user);

        // Out after 6h — three hours short of the nine owed.
        $record = $this->workUntil($user, '12:30:00', [
            'category' => 'medical',
            'reason' => 'Dentist appointment at 5 PM',
            'approved_by' => $approver->id,
        ]);

        $this->assertFalse($record->met_required_hours, 'the day is still short');
        $this->assertSame('medical', $record->early_checkout_category);
        $this->assertSame('Dentist appointment at 5 PM', $record->early_checkout_reason);
        $this->assertSame($approver->id, $record->early_checkout_approved_by);
        $this->assertNotNull($record->early_checkout_reason_at);
    }

    public function test_a_short_day_without_a_reason_stays_unexplained(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->assignShift($user);

        $record = $this->workUntil($user, '12:30:00');

        $this->assertFalse($record->met_required_hours);
        $this->assertNull($record->early_checkout_category, 'nothing is invented when nothing was given');
        $this->assertFalse($record->hasEarlyCheckoutReason());
    }

    public function test_a_full_day_never_stores_a_reason(): void
    {
        // Someone who completes their hours has nothing to explain — a reason
        // left over on a full day would misrepresent them.
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->assignShift($user);

        $record = $this->workUntil($user, '15:30:00', [ // 9h exactly
            'category' => 'medical',
            'reason' => 'Should not be stored at all',
        ]);

        $this->assertTrue($record->met_required_hours);
        $this->assertNull($record->early_checkout_category);
    }

    public function test_checking_back_in_clears_the_earlier_reason(): void
    {
        // Reported from production: leave early with a reason, come back later
        // the same day, and the day still carried the old reason. That departure
        // turned out not to be the end of the day, so the reason no longer
        // describes anything — and left in place it would label the day's real
        // final checkout while suppressing the dialog that should ask about it.
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->assignShift($user);

        $this->workUntil($user, '12:30:00', [
            'category' => 'medical',
            'reason' => 'Doctor visit this afternoon',
        ]);

        Carbon::setTestNow(Carbon::parse(self::MONDAY . ' 13:00:00', 'UTC'));
        $record = app(CheckInService::class)->checkIn($user);

        $this->assertNull($record->early_checkout_category, 'the day is open again, so it has nothing to explain');
        $this->assertNull($record->early_checkout_reason);
        $this->assertNull($record->early_checkout_reason_at);
    }

    public function test_the_final_early_checkout_is_explained_on_its_own_terms(): void
    {
        // Back in and out again, still short: THIS departure gets its own
        // answer, rather than inheriting one written for a different one.
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->assignShift($user);

        $this->workUntil($user, '12:30:00', [
            'category' => 'medical',
            'reason' => 'Doctor visit this afternoon',
        ]);

        Carbon::setTestNow(Carbon::parse(self::MONDAY . ' 13:00:00', 'UTC'));
        app(CheckInService::class)->checkIn($user);
        Carbon::setTestNow(Carbon::parse(self::MONDAY . ' 13:30:00', 'UTC'));
        $record = app(CheckInService::class)->checkOut($user, [
            'category' => 'family_emergency',
            'reason' => 'Called home for my child',
        ]);

        $this->assertSame('family_emergency', $record->early_checkout_category);
        $this->assertSame('Called home for my child', $record->early_checkout_reason);
    }

    public function test_the_dialog_asks_again_after_checking_back_in(): void
    {
        // reason_given drives whether the checkout dialog opens at all. Left
        // true after a re-check-in, the final departure was never asked about.
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->assignShift($user);

        $this->workUntil($user, '12:30:00', ['category' => 'medical', 'reason' => 'Doctor visit this afternoon']);

        Carbon::setTestNow(Carbon::parse(self::MONDAY . ' 13:00:00', 'UTC'));
        app(CheckInService::class)->checkIn($user);

        $data = $this->actingAs($user, 'sanctum')->getJson('/api/v1/hr/attendance/today')->assertOk()->json('data');

        $this->assertFalse($data['early_checkout']['reason_given']);
        $this->assertNull($data['early_checkout_reason']);
    }

    public function test_a_reason_cannot_be_rewritten_for_the_same_departure(): void
    {
        // What write-once still protects: without checking back in, a second
        // checkout call cannot replace the answer already on record.
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->assignShift($user);

        $this->workUntil($user, '12:30:00', ['category' => 'medical', 'reason' => 'The original answer']);

        // A repeated checkout with no session open in between (double-click,
        // stale tab) — it is the SAME departure.
        Carbon::setTestNow(Carbon::parse(self::MONDAY . ' 12:31:00', 'UTC'));
        $record = app(CheckInService::class)->checkOut($user, ['category' => 'other', 'reason' => 'A convenient rewrite']);

        $this->assertSame('medical', $record->early_checkout_category);
        $this->assertSame('The original answer', $record->early_checkout_reason);
    }

    public function test_an_unknown_category_is_refused(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->assignShift($user);

        $this->expectException(\Symfony\Component\HttpKernel\Exception\HttpException::class);

        $this->workUntil($user, '12:30:00', ['category' => 'because_i_felt_like_it']);
    }

    public function test_an_approver_from_another_organization_is_refused(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->assignShift($user);

        $outsider = $this->createUser($this->createOrganization(), 'owner');

        $this->expectException(\Symfony\Component\HttpKernel\Exception\HttpException::class);

        $this->workUntil($user, '12:30:00', [
            'category' => 'medical',
            'reason' => 'Naming someone I should not be able to name',
            'approved_by' => $outsider->id,
        ]);
    }

    public function test_the_api_accepts_a_reason_and_returns_it_on_the_row(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $approver = $this->createUser($org, 'hr_manager');
        $this->assignShift($user);

        Carbon::setTestNow(Carbon::parse(self::MONDAY . ' 06:30:00', 'UTC'));
        $this->actingAs($user, 'sanctum')->postJson('/api/v1/hr/attendance/check-in')->assertStatus(201);

        Carbon::setTestNow(Carbon::parse(self::MONDAY . ' 12:30:00', 'UTC'));
        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/hr/attendance/check-out', [
                'early_checkout_category' => 'family_emergency',
                'early_checkout_reason' => 'Had to collect my child from school',
                'early_checkout_approved_by' => $approver->id,
            ])
            ->assertOk();

        $row = $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/hr/attendance?start_date=' . self::MONDAY . '&end_date=' . self::MONDAY)
            ->assertOk()
            ->json('data.0');

        $this->assertSame('family_emergency', $row['early_checkout_reason']['category']);
        $this->assertSame('Family emergency', $row['early_checkout_reason']['category_label']);
        $this->assertSame('Had to collect my child from school', $row['early_checkout_reason']['note']);
        $this->assertSame($approver->name, $row['early_checkout_reason']['approved_by']);
    }

    public function test_a_plain_checkout_with_no_body_still_works(): void
    {
        // The overwhelmingly common case: a full day, no dialog, no body. It
        // must never 422 because the endpoint learned to accept a reason.
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->assignShift($user);

        Carbon::setTestNow(Carbon::parse(self::MONDAY . ' 06:30:00', 'UTC'));
        $this->actingAs($user, 'sanctum')->postJson('/api/v1/hr/attendance/check-in')->assertStatus(201);

        Carbon::setTestNow(Carbon::parse(self::MONDAY . ' 15:30:00', 'UTC'));
        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/hr/attendance/check-out')
            ->assertOk();
    }

    public function test_a_note_that_says_nothing_is_rejected(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $this->assignShift($user);

        Carbon::setTestNow(Carbon::parse(self::MONDAY . ' 06:30:00', 'UTC'));
        $this->actingAs($user, 'sanctum')->postJson('/api/v1/hr/attendance/check-in')->assertStatus(201);

        Carbon::setTestNow(Carbon::parse(self::MONDAY . ' 12:30:00', 'UTC'));
        $this->actingAs($user, 'sanctum')
            ->postJson('/api/v1/hr/attendance/check-out', [
                'early_checkout_category' => 'other',
                'early_checkout_reason' => 'ok',
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('early_checkout_reason');
    }

    public function test_today_status_offers_the_categories_and_approvers(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org, 'employee');
        $hr = $this->createUser($org, 'hr_manager');
        $finance = $this->createUser($org, 'finance_manager');
        $this->assignShift($user);

        Carbon::setTestNow(Carbon::parse(self::MONDAY . ' 06:30:00', 'UTC'));

        $data = $this->actingAs($user, 'sanctum')
            ->getJson('/api/v1/hr/attendance/today')
            ->assertOk()
            ->json('data');

        $this->assertSame(9 * 3600, $data['required_day_seconds']);
        $this->assertNotEmpty($data['early_checkout']['categories']);
        $this->assertFalse($data['early_checkout']['reason_given']);

        $approverIds = array_column($data['early_checkout']['approvers'], 'id');
        $this->assertContains($hr->id, $approverIds, 'HR may authorise an early departure');
        $this->assertNotContains($finance->id, $approverIds, 'finance reads attendance, it does not authorise it');
        $this->assertNotContains($user->id, $approverIds, 'nobody approves their own early checkout');
    }
}
