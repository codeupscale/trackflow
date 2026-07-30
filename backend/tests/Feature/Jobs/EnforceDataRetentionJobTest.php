<?php

namespace Tests\Feature\Jobs;

use App\Jobs\EnforceDataRetentionJob;
use App\Models\ActivityLog;
use App\Models\AuditLog;
use App\Models\Organization;
use App\Models\Project;
use App\Models\TimeEntry;
use App\Models\User;
use Carbon\Carbon;
use Tests\TestCase;

/**
 * Regression cover for EnforceDataRetentionJob.
 *
 * The job filtered `activity_logs` on `created_at`, a column that table has never
 * had (the migration creates `logged_at` and ActivityLog sets $timestamps = false).
 * Every scheduled run therefore died with SQLSTATE[42703] before reaching the audit
 * prune, so NEITHER prune had ever executed in production.
 */
class EnforceDataRetentionJobTest extends TestCase
{
    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    /** The bug: the job must run to completion instead of throwing on a missing column. */
    public function test_job_completes_without_a_database_error(): void
    {
        $org = $this->createOrganization(['data_retention_config' => ['activity_log_retention_days' => 90]]);
        $this->makeActivityLog($org, now()->subDays(200));

        (new EnforceDataRetentionJob)->handle();

        $this->assertSame(0, ActivityLog::withoutGlobalScopes()->count());
    }

    public function test_prunes_activity_logs_older_than_the_configured_window(): void
    {
        $org = $this->createOrganization(['data_retention_config' => ['activity_log_retention_days' => 30]]);

        $stale = $this->makeActivityLog($org, now()->subDays(31));
        $fresh = $this->makeActivityLog($org, now()->subDays(29));

        (new EnforceDataRetentionJob)->handle();

        $this->assertDatabaseMissing('activity_logs', ['id' => $stale->id]);
        $this->assertDatabaseHas('activity_logs', ['id' => $fresh->id]);
    }

    /**
     * The retention window is measured on `logged_at`. A row whose logged_at is inside
     * the window survives — this is what the created_at filter could never express.
     */
    public function test_retention_window_is_measured_on_logged_at(): void
    {
        $org = $this->createOrganization(['data_retention_config' => ['activity_log_retention_days' => 90]]);

        $inside = $this->makeActivityLog($org, now()->subDays(89));
        $outside = $this->makeActivityLog($org, now()->subDays(91));

        (new EnforceDataRetentionJob)->handle();

        $this->assertDatabaseHas('activity_logs', ['id' => $inside->id]);
        $this->assertDatabaseMissing('activity_logs', ['id' => $outside->id]);
    }

    /**
     * An org with no explicit window is left to PruneOldActivityLogsJob (02:00), which
     * owns the 90-day default AND the `pro`-plan unlimited-retention exemption. If this
     * job also applied a default it would delete a pro org's history behind that job's
     * back.
     */
    public function test_org_without_explicit_config_is_left_untouched(): void
    {
        $org = $this->createOrganization(['plan' => 'pro', 'data_retention_config' => null]);
        $ancient = $this->makeActivityLog($org, now()->subDays(500));

        (new EnforceDataRetentionJob)->handle();

        $this->assertDatabaseHas('activity_logs', ['id' => $ancient->id]);
    }

    public function test_prunes_audit_logs_older_than_two_years(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org);

        $stale = AuditLog::create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'action' => 'test.stale',
            'created_at' => now()->subYears(2)->subDay(),
        ]);

        $fresh = AuditLog::create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'action' => 'test.fresh',
            'created_at' => now()->subYears(2)->addDay(),
        ]);

        (new EnforceDataRetentionJob)->handle();

        $this->assertDatabaseMissing('audit_logs', ['id' => $stale->id]);
        $this->assertDatabaseHas('audit_logs', ['id' => $fresh->id]);
    }

    /**
     * The audit prune sits after the per-org loop. While the activity query was
     * throwing, that exception aborted the whole run and the audit prune never fired.
     * A per-org failure must now be contained.
     */
    public function test_a_failing_org_does_not_prevent_the_audit_prune(): void
    {
        $org = $this->createOrganization();
        $user = $this->createUser($org);

        // A non-numeric window trips the guard and logs, standing in for a malformed org.
        $broken = $this->createOrganization(['data_retention_config' => ['activity_log_retention_days' => 'nonsense']]);
        $this->makeActivityLog($broken, now()->subDays(400));

        $stale = AuditLog::create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'action' => 'test.stale',
            'created_at' => now()->subYears(3),
        ]);

        (new EnforceDataRetentionJob)->handle();

        $this->assertDatabaseMissing('audit_logs', ['id' => $stale->id]);
    }

    /** A zero/negative window is rejected rather than deleting everything. */
    public function test_invalid_retention_window_deletes_nothing(): void
    {
        $org = $this->createOrganization(['data_retention_config' => ['activity_log_retention_days' => 0]]);
        $log = $this->makeActivityLog($org, now()->subDays(400));

        (new EnforceDataRetentionJob)->handle();

        $this->assertDatabaseHas('activity_logs', ['id' => $log->id]);
    }

    /** Deletes are chunked at 1000; a backlog larger than one chunk must fully drain. */
    public function test_backlog_larger_than_one_chunk_is_fully_pruned(): void
    {
        $org = $this->createOrganization(['data_retention_config' => ['activity_log_retention_days' => 30]]);
        $user = $this->createUser($org);
        $entry = $this->makeTimeEntry($org, $user);

        ActivityLog::factory()->count(1200)->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'logged_at' => now()->subDays(60),
        ]);

        (new EnforceDataRetentionJob)->handle();

        $this->assertSame(0, ActivityLog::withoutGlobalScopes()->count());
    }

    /** Pruning is org-scoped — one org's window must never reach another's rows. */
    public function test_pruning_is_scoped_to_the_configured_organization(): void
    {
        $pruned = $this->createOrganization(['data_retention_config' => ['activity_log_retention_days' => 30]]);
        $other = $this->createOrganization(['data_retention_config' => ['activity_log_retention_days' => 365]]);

        $gone = $this->makeActivityLog($pruned, now()->subDays(60));
        $kept = $this->makeActivityLog($other, now()->subDays(60));

        (new EnforceDataRetentionJob)->handle();

        $this->assertDatabaseMissing('activity_logs', ['id' => $gone->id]);
        $this->assertDatabaseHas('activity_logs', ['id' => $kept->id]);
    }

    // -- helpers --

    private function makeActivityLog(Organization $org, Carbon $loggedAt): ActivityLog
    {
        $user = $this->createUser($org);

        return ActivityLog::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'time_entry_id' => $this->makeTimeEntry($org, $user)->id,
            'logged_at' => $loggedAt,
        ]);
    }

    private function makeTimeEntry(Organization $org, User $user): TimeEntry
    {
        $project = Project::factory()->create(['organization_id' => $org->id]);

        return TimeEntry::factory()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'project_id' => $project->id,
        ]);
    }
}
