<?php

namespace Tests\Feature\Public;

use App\Models\Department;
use App\Models\JobPosting;
use App\Models\Organization;
use Tests\TestCase;

class PublicJobPostingTest extends TestCase
{
    private function orgWithDepartment(string $slug): array
    {
        $org = Organization::factory()->create(['slug' => $slug]);
        $dept = Department::factory()->create([
            'organization_id' => $org->id,
            'name' => 'Engineering',
        ]);

        return [$org, $dept];
    }

    private function url(string $slug): string
    {
        return "/api/v1/public/organizations/{$slug}/job-postings";
    }

    public function test_endpoint_is_reachable_without_authentication(): void
    {
        [$org, $dept] = $this->orgWithDepartment('code-upscale');

        JobPosting::factory()->published()->create([
            'organization_id' => $org->id,
            'department_id' => $dept->id,
            'title' => 'Senior React Developer',
        ]);

        $this->getJson($this->url('code-upscale'))
            ->assertOk()
            ->assertJsonPath('data.0.title', 'Senior React Developer');
    }

    public function test_unpublished_postings_are_not_returned(): void
    {
        [$org, $dept] = $this->orgWithDepartment('code-upscale');

        JobPosting::factory()->create([
            'organization_id' => $org->id,
            'department_id' => $dept->id,
        ]);

        $this->getJson($this->url('code-upscale'))
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    /**
     * The feed must not be cacheable by browsers.
     *
     * It previously sent `public, max-age=60`, which meant a posting stayed on
     * the careers page for up to a minute after HR unpublished it — the reload
     * was answered from the visitor's own cache and never reached us. A shared
     * `s-maxage` for a purgeable CDN would be fine; `max-age` is not.
     */
    public function test_the_feed_is_not_browser_cacheable(): void
    {
        [$org, $dept] = $this->orgWithDepartment('code-upscale');

        JobPosting::factory()->published()->create([
            'organization_id' => $org->id,
            'department_id' => $dept->id,
        ]);

        $cacheControl = $this->getJson($this->url('code-upscale'))
            ->assertOk()
            ->headers->get('Cache-Control');

        $this->assertStringContainsString('no-store', (string) $cacheControl);
        $this->assertStringNotContainsString('max-age=', (string) $cacheControl);
    }

    /**
     * The trap this endpoint exists to avoid: GlobalOrganizationScope is inert
     * for unauthenticated requests, so without an explicit organization filter
     * every tenant's postings would be served here.
     */
    public function test_another_organizations_postings_are_never_returned(): void
    {
        [$mine, $myDept] = $this->orgWithDepartment('code-upscale');
        [$theirs, $theirDept] = $this->orgWithDepartment('someone-else');

        JobPosting::factory()->published()->create([
            'organization_id' => $mine->id,
            'department_id' => $myDept->id,
            'title' => 'Mine',
        ]);

        JobPosting::factory()->published()->count(3)->create([
            'organization_id' => $theirs->id,
            'department_id' => $theirDept->id,
            'title' => 'Theirs',
        ]);

        $response = $this->getJson($this->url('code-upscale'))->assertOk();

        $this->assertCount(1, $response->json('data'));
        $this->assertSame('Mine', $response->json('data.0.title'));
    }

    public function test_a_future_posting_date_keeps_it_off_the_feed(): void
    {
        [$org, $dept] = $this->orgWithDepartment('code-upscale');

        JobPosting::factory()->scheduled()->create([
            'organization_id' => $org->id,
            'department_id' => $dept->id,
        ]);

        $this->getJson($this->url('code-upscale'))
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_unknown_slug_returns_404(): void
    {
        $this->getJson($this->url('no-such-org'))->assertNotFound();
    }

    // ── Salary exposure ──────────────────────────────────

    public function test_salary_is_absent_when_the_toggle_is_off(): void
    {
        [$org, $dept] = $this->orgWithDepartment('code-upscale');

        JobPosting::factory()->published()->create([
            'organization_id' => $org->id,
            'department_id' => $dept->id,
            'min_salary' => 80000,
            'max_salary' => 120000,
            'send_salary_via_api' => false,
        ]);

        $response = $this->getJson($this->url('code-upscale'))->assertOk();

        $job = $response->json('data.0');
        $this->assertArrayNotHasKey('salary_display', $job);
        $this->assertArrayNotHasKey('salary_min', $job);
        $this->assertArrayNotHasKey('salary_max', $job);
    }

    public function test_both_values_render_as_a_range(): void
    {
        [$org, $dept] = $this->orgWithDepartment('code-upscale');

        JobPosting::factory()->published()->withSalaryPublished(80000, 120000)->create([
            'organization_id' => $org->id,
            'department_id' => $dept->id,
        ]);

        $this->getJson($this->url('code-upscale'))
            ->assertOk()
            ->assertJsonPath('data.0.salary_display', '80,000 - 120,000');
    }

    public function test_min_only_renders_as_from(): void
    {
        [$org, $dept] = $this->orgWithDepartment('code-upscale');

        JobPosting::factory()->published()->withSalaryPublished(80000, null)->create([
            'organization_id' => $org->id,
            'department_id' => $dept->id,
        ]);

        $this->getJson($this->url('code-upscale'))
            ->assertOk()
            ->assertJsonPath('data.0.salary_display', 'From 80,000');
    }

    public function test_max_only_renders_as_up_to(): void
    {
        [$org, $dept] = $this->orgWithDepartment('code-upscale');

        JobPosting::factory()->published()->withSalaryPublished(null, 120000)->create([
            'organization_id' => $org->id,
            'department_id' => $dept->id,
        ]);

        $this->getJson($this->url('code-upscale'))
            ->assertOk()
            ->assertJsonPath('data.0.salary_display', 'Up to 120,000');
    }

    public function test_equal_values_collapse_to_a_single_figure(): void
    {
        [$org, $dept] = $this->orgWithDepartment('code-upscale');

        JobPosting::factory()->published()->withSalaryPublished(90000, 90000)->create([
            'organization_id' => $org->id,
            'department_id' => $dept->id,
        ]);

        $this->getJson($this->url('code-upscale'))
            ->assertOk()
            ->assertJsonPath('data.0.salary_display', '90,000');
    }

    // ── Shape ────────────────────────────────────────────

    public function test_response_exposes_only_the_intended_fields(): void
    {
        [$org, $dept] = $this->orgWithDepartment('code-upscale');

        JobPosting::factory()->published()->create([
            'organization_id' => $org->id,
            'department_id' => $dept->id,
            'start_time' => '09:00:00',
            'end_time' => '18:00:00',
        ]);

        $job = $this->getJson($this->url('code-upscale'))->assertOk()->json('data.0');

        $this->assertSame([
            'id', 'title', 'department', 'position', 'employment_type',
            'work_mode', 'location', 'working_hours', 'short_description',
            'long_description', 'posting_date',
        ], array_keys($job));

        $this->assertSame('Engineering', $job['department']);
        $this->assertSame('9:00 AM - 6:00 PM', $job['working_hours']);
        // organization_id must never appear in a public payload.
        $this->assertArrayNotHasKey('organization_id', $job);
    }
}
