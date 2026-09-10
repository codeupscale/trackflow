<?php

namespace App\Console\Commands;

use App\Models\EmployeeSalaryAssignment;
use App\Models\Organization;
use App\Models\PayrollPeriod;
use App\Models\Payslip;
use App\Models\PayslipLineItem;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Put a payroll run back to its starting state so the flow can be walked again.
 *
 * Testing the run end to end consumes it: once a period is approved and paid it
 * refuses to run again, which is correct behaviour and exactly what makes the
 * second test impossible without a reset. Doing that by hand means remembering
 * which of five tables hold state and in what order they have to be cleared.
 *
 * Deletes are FORCED, not soft. Payslips, periods and salary assignments all
 * soft-delete, and a soft-deleted payslip still occupies its (user, period)
 * unique index — so a "cleared" run would collide with its own ghost on the
 * next attempt.
 *
 * Local and testing only. This destroys financial records; on any other
 * environment that is not a test fixture, it is a data loss incident.
 */
class ResetPayrollForTesting extends Command
{
    protected $signature = 'payroll:reset-test
        {--org= : Organization id. Defaults to the only one, or asks.}
        {--period= : Reset just this period. Defaults to every period in the org.}
        {--keep-salaries : Leave salary assignments in place, so the run starts at "Run payroll" instead of "Assign salaries".}
        {--force : Skip the confirmation prompt.}';

    protected $description = 'Reset payroll periods, payslips and salary assignments so the run can be tested again (local only).';

    public function handle(): int
    {
        if (! app()->environment('local', 'testing')) {
            $this->error('Refusing to run outside local/testing — this deletes payslips.');

            return self::FAILURE;
        }

        $orgId = $this->resolveOrganization();
        if ($orgId === null) {
            return self::FAILURE;
        }

        $periods = PayrollPeriod::withoutGlobalScopes()
            ->withTrashed()
            ->where('organization_id', $orgId)
            ->when($this->option('period'), fn ($q, $id) => $q->where('id', $id))
            ->orderBy('start_date')
            ->get();

        if ($periods->isEmpty()) {
            $this->warn('No payroll periods found for that organization.');

            return self::SUCCESS;
        }

        $payslipIds = Payslip::withoutGlobalScopes()
            ->withTrashed()
            ->whereIn('payroll_period_id', $periods->pluck('id'))
            ->pluck('id');

        $assignmentCount = $this->option('keep-salaries')
            ? 0
            : EmployeeSalaryAssignment::withoutGlobalScopes()
                ->withTrashed()
                ->where('organization_id', $orgId)
                ->count();

        $this->table(
            ['Period', 'Status', 'Payslips'],
            $periods->map(fn ($p) => [
                $p->name,
                $p->status . ($p->trashed() ? ' (deleted)' : ''),
                $payslipIds->isEmpty() ? 0 : Payslip::withoutGlobalScopes()->withTrashed()
                    ->where('payroll_period_id', $p->id)->count(),
            ])->all(),
        );

        $this->line("Will delete {$payslipIds->count()} payslips and their line items,");
        $this->line('reset those periods to draft, and '.(
            $this->option('keep-salaries')
                ? 'KEEP salary assignments.'
                : "delete {$assignmentCount} salary assignments."
        ));

        if (! $this->option('force') && ! $this->confirm('Proceed?', true)) {
            return self::SUCCESS;
        }

        DB::transaction(function () use ($periods, $payslipIds, $orgId) {
            // Line items first: they have no soft delete and are the child of
            // the payslip, so removing them by hand keeps the delete from
            // depending on cascade behaviour that differs per column.
            PayslipLineItem::whereIn('payslip_id', $payslipIds)->delete();

            Payslip::withoutGlobalScopes()->withTrashed()
                ->whereIn('id', $payslipIds)
                ->forceDelete();

            foreach ($periods as $period) {
                $period->restore();
                $period->forceFill([
                    'status' => 'draft',
                    'approved_by' => null,
                    'processed_at' => null,
                    // Cleared too, or the run stays OWNED by whoever last ran
                    // it — and after a reset the other payroll-capable person
                    // is refused with "only they can run it again", for a run
                    // that no longer exists.
                    'processed_by' => null,
                    'paid_at' => null,
                ])->save();
            }

            if (! $this->option('keep-salaries')) {
                EmployeeSalaryAssignment::withoutGlobalScopes()->withTrashed()
                    ->where('organization_id', $orgId)
                    ->forceDelete();
            }
        });

        // Deliberately NOT flushing the cache. Rendered payslips are cached
        // under a key built from the payslip's id and timestamps, and a rerun
        // mints fresh uuids — so no cached document is reachable after this,
        // and there is nothing to clear. `Cache::flush()` would be a FLUSHDB
        // on the Redis store, which is where sessions live too: it would sign
        // the tester out every time they reset.

        $this->newLine();
        $this->info('Payroll reset. Start again at HR → Payroll:');
        $this->line($this->option('keep-salaries')
            ? '  Run payroll → review and verify each payslip → approve → mark paid'
            : '  Fetch employees → assign salaries → run payroll → review and verify each payslip → approve → mark paid');

        return self::SUCCESS;
    }

    /** The org to reset: the flag, the only one there is, or a prompt. */
    private function resolveOrganization(): ?string
    {
        if ($id = $this->option('org')) {
            return $id;
        }

        $orgs = Organization::withoutGlobalScopes()->orderBy('name')->get(['id', 'name']);

        if ($orgs->isEmpty()) {
            $this->error('No organizations found.');

            return null;
        }

        if ($orgs->count() === 1) {
            $this->line("Organization: {$orgs->first()->name}");

            return $orgs->first()->id;
        }

        $name = $this->choice('Which organization?', $orgs->pluck('name')->all());

        return $orgs->firstWhere('name', $name)->id;
    }
}
