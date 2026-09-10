'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  CalendarDays,
  CheckCircle2,
  DollarSign,
  Loader2,
  Plus,
  Receipt,
  TrendingDown,
  Wallet,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import {
  useApprovePayroll,
  useCreatePayrollPeriod,
  usePayrollPeriods,
} from '@/hooks/hr/use-payroll';
import { useRosterFetched } from '@/hooks/hr/use-salary-roster';
import { usePayslips } from '@/hooks/hr/use-payslips';
import { MONTHS, PayrollPeriodFilter } from '@/components/hr/PayrollPeriodFilter';
import { useMoney } from '@/lib/money';
import { formatDate } from '@/lib/utils';
import type { PayrollPeriod } from '@/lib/validations/payroll';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PayrollRunCard } from '@/components/hr/PayrollRunCard';
import { InlineSalaryRoster } from '@/components/hr/InlineSalaryRoster';

type TabKey = 'salaries' | 'periods';

/**
 * Has this period begun? Compared on calendar days, not instants — a period
 * starting today is runnable from midnight, not from whatever time of day the
 * row happens to carry.
 */
function hasStarted(period: Pick<PayrollPeriod, 'start_date'>): boolean {
  const start = new Date(period.start_date);
  if (Number.isNaN(start.getTime())) return true;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);

  return start <= today;
}
import { useAuthStore } from '@/stores/auth-store';
import { usePermissionStore } from '@/stores/permission-store';
import { cn } from '@/lib/utils';

const statusDot: Record<string, { dot: string; text: string; label: string }> = {
  draft: { dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', label: 'Draft' },
  processing: { dot: 'bg-blue-500', text: 'text-blue-600 dark:text-blue-400', label: 'Processing' },
  approved: { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', label: 'Approved' },
  paid: { dot: 'bg-violet-500', text: 'text-violet-600 dark:text-violet-400', label: 'Paid' },
};

const STATUS_FILTERS = ['all', 'draft', 'processing', 'approved', 'paid'] as const;

/**
 * Why this period cannot be approved yet, or null when it can.
 *
 * Mirrors PayrollService::approvePayroll's own preconditions — it is the
 * authority and still refuses on its own — so that the reason is readable
 * before the click rather than as a failure after it.
 */
function approveBlockedReason(period: PayrollPeriod): string | null {
  if (!hasStarted(period)) {
    return `This period starts ${formatDate(period.start_date)}. It cannot be approved before it has run.`;
  }

  const slips = period.payslips_count ?? 0;

  if (slips === 0) {
    return 'Run payroll for this period first — there are no payslips to approve.';
  }

  // Approval is the point of no return: it locks the figures and moves the
  // period towards payment. Letting it through with payslips nobody has opened
  // would make the per-employee review optional in practice, which is the same
  // as not having it. Verified is stamped when a payslip is sent to the
  // employee, so this reads as "everyone has theirs".
  const verified = period.verified_payslips_count ?? 0;

  if (verified < slips) {
    const left = slips - verified;

    return `${left} of ${slips} payslips have not been sent yet. Review and send each one before approving.`;
  }

  return null;
}

function canApproveNow(period: PayrollPeriod): boolean {
  return approveBlockedReason(period) === null;
}

interface PeriodForm {
  name: string;
  period_type: 'monthly' | 'bi-weekly' | 'weekly';
  start_date: string;
  end_date: string;
}

const emptyPeriodForm = (): PeriodForm => ({
  name: '',
  period_type: 'monthly',
  start_date: '',
  end_date: '',
});

/**
 * The month a `YYYY-MM-DD` string falls in, e.g. "September 2026" — the name
 * every period in this product actually carries. Parsed from the parts rather
 * than by `new Date(value)`, which reads a bare date as UTC midnight and so
 * names the previous month for anyone west of Greenwich.
 */
function monthNameFor(date: string): string {
  const [y, m] = date.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return '';
  return `${MONTHS[m - 1]} ${y}`;
}

/**
 * First day of the current month as `YYYY-MM-DD`, built from local parts rather
 * than toISOString() — the latter converts to UTC first and hands back the
 * PREVIOUS month for anyone east of Greenwich on the 1st. Must match how
 * PayrollRunCard picks the period, or the two disagree about which run is live.
 */
function currentMonthStartDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function PayrollPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { hasPermission } = usePermissionStore();
  const canViewAll = hasPermission('payroll.view_all');
  const canRun = hasPermission('payroll.run');
  const canApprove = hasPermission('payroll.approve');
  const canManageSalaries = hasPermission('payroll.manage_structures');
  const [tab, setTab] = useState<TabKey>('salaries');

  useEffect(() => {
    if (user && !canViewAll) {
      router.push('/hr/payroll/my-payslips');
    }
  }, [user, canViewAll, router]);

  const money = useMoney();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  // What the money figures cover. Defaults to the current year, which is the
  // question anyone opening this tab is usually asking.
  const [year, setYear] = useState<number | undefined>(new Date().getFullYear());
  const [month, setMonth] = useState<number | undefined>(undefined);

  // Role-scoped SERVER-side: the same call an employee makes returns only their
  // own payslip, and returns the whole company's for anyone holding
  // payroll.view_all. Nothing here has to know which it is.
  const { data: payslipData, isLoading: totalsLoading } = usePayslips({
    year,
    month,
    per_page: 1,
  });
  const totals = payslipData?.totals;
  const payslipYears = payslipData?.years ?? [];

  const periodLabel = month
    ? `${MONTHS[month - 1]}${year ? ` ${year}` : ''}`
    : year
      ? String(year)
      : 'All-time';
  const [approveTarget, setApproveTarget] = useState<PayrollPeriod | null>(null);

  const [showCreatePeriod, setShowCreatePeriod] = useState(false);
  const [periodForm, setPeriodForm] = useState<PeriodForm>(emptyPeriodForm);
  const createPeriod = useCreatePayrollPeriod();

  const openCreatePeriod = () => {
    setPeriodForm(emptyPeriodForm());
    setShowCreatePeriod(true);
  };

  const submitCreatePeriod = () => {
    createPeriod.mutate(periodForm, {
      onSuccess: () => {
        setShowCreatePeriod(false);
        setPeriodForm(emptyPeriodForm());
        // Land on the list the new period just joined — otherwise the press
        // appears to do nothing, because the row is on the other tab.
        setTab('periods');
        setStatusFilter('all');
      },
    });
  };

  const currentMonthStart = useMemo(() => currentMonthStartDate(), []);

  const { data, isLoading, isError } = usePayrollPeriods();
  const approveMutation = useApprovePayroll();

  const periods = data?.data ?? [];

  // The remembered "employees fetched" flag is pinned to the run it was made
  // against — the current month's period, the same row PayrollRunCard drives.
  // Its updated_at moves when the run is reset, which is exactly when the
  // operator is back at step one and must be offered "Fetch employees" again;
  // fetching and assigning salaries leave the period alone, so the flag holds
  // across tab switches in the middle of the flow. Before the period exists
  // there is nothing to pin to, and a constant stands in so the first fetch of
  // a brand-new month still survives a tab switch.
  const rosterStateKey = isLoading
    ? null
    : (periods.find((p) => p.start_date?.slice(0, 10) === currentMonthStart)?.updated_at ??
       'no-period');
  const [fetchRoster, markRosterFetched] = useRosterFetched(rosterStateKey);

  const filteredPeriods = useMemo(
    () => statusFilter === 'all' ? periods : periods.filter((p) => p.status === statusFilter),
    [periods, statusFilter],
  );

  const draftCount = periods.filter((p) => p.status === 'draft').length;
  const approvedCount = periods.filter((p) => p.status === 'approved').length;
  const paidCount = periods.filter((p) => p.status === 'paid').length;

  if (!canViewAll) return null;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Payroll</h1>
          <p className="text-xs text-muted-foreground">
            Run this month&apos;s payroll and review past periods
          </p>
        </div>
        {/* Adding a period is a small form, not a destination. It used to send
            the operator to a separate Pay Periods screen, which broke the run
            in half: the thing they came here to do was two pages away from the
            list it appears in. The dialog keeps them on the run screen and
            drops the new period straight into the Salary periods tab. */}
        {canRun && (
          <Button size="sm" className="h-8 text-xs" onClick={openCreatePeriod}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Period
          </Button>
        )}
      </div>

      {/* This month's run — the whole monthly task in one card, with the single
          next action. The table below is history. */}
      <PayrollRunCard
        canRun={canRun}
        canApprove={canApprove}
        salariesFetched={fetchRoster}
        onAssignSalaries={() => {
          // The run card's "Fetch employees" lands on this tab WITH the
          // directory already requested, so one press does one thing.
          setTab('salaries');
          markRosterFetched();
        }}
      />

      {/* Salaries and periods are two views of the same job, so they are tabs
          on the run screen rather than separate pages. The roster is the
          default: it is what the run depends on, and it is where a raise or a
          new hire is handled long after the run itself is done. */}
      <Tabs value={tab} onValueChange={(v) => setTab((v as TabKey) ?? 'salaries')}>
        <TabsList>
          <TabsTrigger value="salaries" className="text-xs">
            Salaries
          </TabsTrigger>
          <TabsTrigger value="periods" className="text-xs">
            Salary periods
          </TabsTrigger>
        </TabsList>

        <TabsContent value="salaries" className="mt-3">
          <InlineSalaryRoster
            canManage={canManageSalaries}
            autoLoad={fetchRoster}
            onFetched={markRosterFetched}
          />
        </TabsContent>

        <TabsContent value="periods" className="mt-3 flex flex-col gap-4">
      {/* What payroll actually COST, over a period you choose.
          This strip used to count periods — Total / Draft / Approved / Paid —
          four numbers with no money anywhere, so "what did we pay out this
          year" had nowhere to be answered. The counts are kept, demoted to the
          line underneath, because they answer a different and smaller
          question. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Payroll cost</h2>
          <p className="text-[0.65rem] text-muted-foreground">
            Across every payslip in the selected period.
          </p>
        </div>
        <PayrollPeriodFilter
          years={payslipYears}
          year={year}
          month={month}
          onYearChange={setYear}
          onMonthChange={setMonth}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: `${periodLabel} Gross`,
            value: totalsLoading || !totals ? '--' : money(totals.gross),
            icon: DollarSign, color: 'text-emerald-500', bg: 'bg-emerald-500/10',
          },
          {
            label: `${periodLabel} Tax`,
            value: totalsLoading || !totals ? '--' : money(totals.tax),
            icon: Receipt, color: 'text-amber-500', bg: 'bg-amber-500/10',
          },
          {
            label: `${periodLabel} Deductions`,
            value: totalsLoading || !totals ? '--' : money(totals.deductions),
            icon: TrendingDown, color: 'text-red-500', bg: 'bg-red-500/10',
          },
          {
            label: `${periodLabel} Net Paid`,
            value: totalsLoading || !totals ? '--' : money(totals.net),
            icon: Wallet, color: 'text-violet-500', bg: 'bg-violet-500/10',
          },
        ].map((s) => (
          <Card key={s.label} className="border-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-2.5">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${s.bg} shrink-0`}>
                  <s.icon className={`h-4 w-4 ${s.color}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">{s.label}</p>
                  <p className="text-base font-bold text-foreground tabular-nums leading-tight truncate">
                    {s.value}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* The counts, kept but demoted. They describe the RUNS rather than the
          money, and saying how much of the total is final matters: a figure
          that includes payslips still inside an open run is not one to report
          upward yet. */}
      {!totalsLoading && totals && (
        <p className="-mt-1 text-[0.65rem] text-muted-foreground">
          {periods.length} {periods.length === 1 ? 'period' : 'periods'} · {draftCount} draft ·{' '}
          {approvedCount} approved · {paidCount} paid — {totals.slips}{' '}
          {totals.slips === 1 ? 'payslip' : 'payslips'} in {periodLabel}
          {totals.slips > 0 && totals.finalised < totals.slips
            ? `, ${totals.finalised} of them finalised`
            : ''}
          .
        </p>
      )}

      {/* Status Filter Tabs */}
      <div className="flex items-center gap-1 rounded-lg bg-muted p-1 w-fit">
        {STATUS_FILTERS.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setStatusFilter(status)}
            className={cn(
              'rounded-md px-3 py-1.5 text-[0.65rem] font-medium transition-colors capitalize',
              statusFilter === status
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            aria-pressed={statusFilter === status}
          >
            {status}
          </button>
        ))}
      </div>

      {/* Table */}
      {isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-12">
            <div className="flex flex-col items-center gap-2">
              <DollarSign className="h-8 w-8 text-destructive/60" />
              <p className="text-sm text-muted-foreground font-medium">Failed to load payroll periods</p>
              <p className="text-xs text-muted-foreground">Please try again later.</p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center gap-4 px-4 py-2.5 border-b border-border/50">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-3 w-20" />
              ))}
            </div>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3.5 w-16" />
                <Skeleton className="h-3.5 w-14" />
                <Skeleton className="h-3.5 w-10" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : filteredPeriods.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center gap-2">
              <DollarSign className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">
                {statusFilter !== 'all' ? `No ${statusFilter} periods` : 'No payroll periods yet'}
              </p>
              <p className="text-xs text-muted-foreground">
                {statusFilter !== 'all'
                  ? 'No payroll periods match the selected filter.'
                  : 'Create a payroll period to get started.'}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Period</th>
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Date Range</th>
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Type</th>
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Status</th>
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-center">Payslips</th>
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Run by</th>
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPeriods.map((period) => {
                    const sd = statusDot[period.status] ?? statusDot.draft;
                    return (
                      <tr key={period.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <Link
                            href={`/hr/payroll/periods/${period.id}`}
                            className="text-[0.75rem] font-medium text-foreground hover:text-primary transition-colors"
                          >
                            {period.name}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className="text-[0.75rem] text-muted-foreground tabular-nums">
                            {formatDate(period.start_date)} &ndash; {formatDate(period.end_date)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className="text-[0.75rem] text-muted-foreground capitalize">{period.period_type}</span>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1.5 text-[0.7rem] font-medium ${sd.text}`}>
                            <span className={`inline-block w-1.5 h-1.5 rounded-full ${sd.dot}`} />
                            {sd.label}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-center">
                          <span className="text-[0.75rem] text-muted-foreground tabular-nums">
                            {period.payslips_count ?? 0}
                          </span>
                        </td>
                        {/* Owner and finance manager can both run payroll, and a
                            run BELONGS to whoever started it — only they can run
                            it again. The listing has to say who that is, or the
                            other person meets that rule as a refusal with no
                            explanation on screen. */}
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          {period.processor ? (
                            <div className="leading-tight">
                              <p className="text-[0.72rem] text-foreground">{period.processor.name}</p>
                              {period.processed_at && (
                                <p className="text-[0.6rem] text-muted-foreground tabular-nums">
                                  {formatDate(period.processed_at)}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-[0.72rem] text-muted-foreground/60">Not run yet</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-right">
                          {period.status === 'draft' ? (
                            <div className="inline-flex items-center gap-1.5">
                              {/* There is deliberately NO Run button here.
                                  Running is a guided sequence — fetch the
                                  employees, assign salaries, then run — and the
                                  card at the top of this screen is where that
                                  sequence lives. A second entry point in the
                                  row skipped the salary check and let a run
                                  start against an unassigned roster, which
                                  succeeds while silently paying nobody. This
                                  column reports on runs; it does not start
                                  them. */}
                              {(period.payslips_count ?? 0) === 0 && (
                                <span
                                  className="text-[0.6rem] text-muted-foreground/70"
                                  title={
                                    hasStarted(period)
                                      ? 'Use the run card at the top of this screen'
                                      : `Starts ${formatDate(period.start_date)}`
                                  }
                                >
                                  {hasStarted(period) ? 'Not run yet' : 'Not started'}
                                </span>
                              )}
                              {(period.payslips_count ?? 0) > 0 && (
                                <span
                                  className="inline-flex items-center gap-1.5 rounded-md bg-blue-500/10 px-2 py-1 text-[0.6rem] font-medium text-blue-600 dark:text-blue-400"
                                  title={`${period.verified_payslips_count ?? 0} of ${period.payslips_count} payslips verified`}
                                >
                                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500" />
                                  In progress · {period.verified_payslips_count ?? 0}/
                                  {period.payslips_count} verified
                                </span>
                              )}
                              {/* Approval finalises figures and moves the
                                  period towards payment, so there has to be
                                  something to finalise. A period that has not
                                  started, or that has never been run, has no
                                  payslips at all — the server refuses both, but
                                  an enabled button that answers with an error
                                  toast teaches nothing. Say why up front. */}
                              {canApprove && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-6 px-2.5 text-[0.6rem]"
                                  disabled={!canApproveNow(period)}
                                  title={approveBlockedReason(period) ?? undefined}
                                  onClick={() => setApproveTarget(period)}
                                >
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Approve
                                </Button>
                              )}
                            </div>
                          ) : period.status === 'paid' && period.approver ? (
                            <span className="text-[0.6rem] text-muted-foreground">
                              by {period.approver.name}
                            </span>
                          ) : (
                            <span className="text-[0.65rem] text-muted-foreground/50">&mdash;</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
        </TabsContent>
      </Tabs>

      {/* Add Period Dialog */}
      <Dialog open={showCreatePeriod} onOpenChange={setShowCreatePeriod}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                <CalendarDays className="h-3.5 w-3.5 text-primary" />
              </div>
              Add Pay Period
            </DialogTitle>
            <DialogDescription className="text-xs">
              Choose the month, the dates it covers and how often it repeats. The
              period appears under Salary periods, ready to run.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="period-name" className="text-xs">Month</Label>
              <Input
                id="period-name"
                className="h-9 text-sm"
                placeholder="e.g. September 2026"
                value={periodForm.name}
                onChange={(e) => setPeriodForm((d) => ({ ...d, name: e.target.value }))}
              />
            </div>

            <div className="grid gap-1.5">
              <Label className="text-xs">Period Type</Label>
              <Select
                value={periodForm.period_type}
                onValueChange={(v) =>
                  setPeriodForm((d) => ({ ...d, period_type: v as PeriodForm['period_type'] }))
                }
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="bi-weekly">Bi-Weekly</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-lg border border-border/60 p-3">
              <div className="flex items-center gap-1.5 mb-2.5">
                <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">
                  Date Range
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1">
                  <Label htmlFor="start_date" className="text-[0.65rem] text-muted-foreground">
                    Start Date
                  </Label>
                  <Input
                    id="start_date"
                    type="date"
                    className="h-8 text-xs"
                    value={periodForm.start_date}
                    max={periodForm.end_date || undefined}
                    onChange={(e) =>
                      setPeriodForm((d) => {
                        const v = e.target.value;
                        const next: PeriodForm = { ...d, start_date: v };
                        // An end date now BEFORE the start is nonsense, so it
                        // follows rather than being left to 422 server-side.
                        if (d.end_date && v > d.end_date) next.end_date = v;
                        // The name is almost always the month being paid, so it
                        // is offered — but only while untouched, never over
                        // something typed by hand.
                        if (!d.name || d.name === monthNameFor(d.start_date)) {
                          next.name = monthNameFor(v);
                        }
                        return next;
                      })
                    }
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="end_date" className="text-[0.65rem] text-muted-foreground">
                    End Date
                  </Label>
                  <Input
                    id="end_date"
                    type="date"
                    className="h-8 text-xs"
                    value={periodForm.end_date}
                    min={periodForm.start_date || undefined}
                    onChange={(e) => setPeriodForm((d) => ({ ...d, end_date: e.target.value }))}
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setShowCreatePeriod(false)}
              disabled={createPeriod.isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={submitCreatePeriod}
              disabled={
                createPeriod.isPending ||
                !periodForm.name ||
                !periodForm.start_date ||
                !periodForm.end_date
              }
            >
              {createPeriod.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Add Period
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approve Payroll Dialog */}
      <Dialog open={!!approveTarget} onOpenChange={(open) => { if (!open) setApproveTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              </div>
              Approve Payroll
            </DialogTitle>
            <DialogDescription className="text-xs">
              This will finalize all payslips for <span className="font-medium text-foreground">{approveTarget?.name}</span>.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setApproveTarget(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => {
                if (approveTarget) {
                  approveMutation.mutate(approveTarget.id, { onSuccess: () => setApproveTarget(null) });
                }
              }}
              disabled={approveMutation.isPending}
            >
              {approveMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
