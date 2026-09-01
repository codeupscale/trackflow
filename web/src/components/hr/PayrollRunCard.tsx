'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Check,
  Loader2,
  Play,
  Wallet,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { cn } from '@/lib/utils';
import { useSalaryRoster } from '@/hooks/hr/use-salary-roster';
import {
  usePayrollPeriods,
  useCreatePayrollPeriod,
  useRunPayroll,
  useApprovePayroll,
  useMarkPayrollPaid,
} from '@/hooks/hr/use-payroll';

/** The four things that must happen, in order, every month. */
type Step = 'salaries' | 'run' | 'review' | 'approve';

const STEP_LABELS: Record<Step, string> = {
  salaries: 'Salaries assigned',
  run: 'Run payroll',
  review: 'Review payslips',
  approve: 'Approve & pay',
};

function monthBounds(d: Date) {
  const iso = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  return {
    start: iso(new Date(d.getFullYear(), d.getMonth(), 1)),
    end: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
    name: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
  };
}

function money(n: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
}

interface PayrollRunCardProps {
  canRun: boolean;
  canApprove: boolean;
  className?: string;
}

/**
 * The monthly payroll ritual as ONE card with ONE action.
 *
 * The period for the current month is proposed automatically rather than
 * created by hand — the app knows what month it is, and making the operator
 * create a period before they can do anything was pure friction.
 *
 * The stage is DERIVED, not read from status alone: a period sits in 'draft'
 * both before and after a run (the run flips to 'processing' then back), so
 * status by itself cannot answer "what do I do next?". Payslip count is what
 * separates "not run" from "ready to approve".
 */
export function PayrollRunCard({ canRun, canApprove, className }: PayrollRunCardProps) {
  const router = useRouter();
  const [confirmRun, setConfirmRun] = useState(false);

  const current = useMemo(() => monthBounds(new Date()), []);

  const { data: rosterData, isLoading: rosterLoading } = useSalaryRoster({ per_page: 100 });
  const { data: periodsData, isLoading: periodsLoading } = usePayrollPeriods();

  const createPeriod = useCreatePayrollPeriod();
  const runPayroll = useRunPayroll();
  const approvePayroll = useApprovePayroll();
  const markPaid = useMarkPayrollPaid();

  const roster = rosterData?.data ?? [];
  const assignedCount = roster.filter((r) => r.assignment).length;
  const totalEmployees = rosterData?.total ?? roster.length;
  const salariesReady = totalEmployees > 0 && assignedCount === totalEmployees;

  // Estimated gross for the confirmation — the operator should see a number
  // before committing, since a run replaces any existing payslips.
  const estimatedGross = roster.reduce(
    (sum, r) => sum + (r.assignment?.effective_base_salary ?? 0),
    0,
  );

  const periods = periodsData?.data ?? [];
  const period = periods.find((p) => p.start_date?.slice(0, 10) === current.start);
  const payslipCount = period?.payslips_count ?? 0;

  const isPaid = period?.status === 'paid';

  // A paid period is FINISHED, so the salary check no longer applies — without
  // this the card said "Payroll complete" and "Assign salaries" at the same
  // time whenever coverage was incomplete but the month was already paid.
  const step: Step = isPaid
    ? 'approve'
    : !salariesReady
      ? 'salaries'
      : !period || payslipCount === 0
        ? 'run'
        : period.status === 'draft'
          ? 'review'
          : 'approve';

  const isBusy =
    createPeriod.isPending ||
    runPayroll.isPending ||
    approvePayroll.isPending ||
    markPaid.isPending ||
    period?.status === 'processing';

  const stepIndex: Record<Step, number> = { salaries: 0, run: 1, review: 2, approve: 3 };
  const done = (s: Step) => {
    if (period?.status === 'paid') return true;
    return stepIndex[s] < stepIndex[step];
  };

  // Creating the period is folded into Run: the operator asked to run payroll,
  // not to manage a period, so the period is created on demand if missing.
  const handleRun = async () => {
    setConfirmRun(false);
    let id = period?.id;
    if (!id) {
      const created = await createPeriod.mutateAsync({
        name: current.name,
        period_type: 'monthly',
        start_date: current.start,
        end_date: current.end,
      });
      id = created?.data?.id ?? created?.id;
    }
    if (id) runPayroll.mutate(id);
  };

  if (rosterLoading || periodsLoading) {
    return (
      <Card className={className}>
        <CardContent className="p-5 flex flex-col gap-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-full max-w-sm" />
          <Skeleton className="h-3 w-full max-w-xs" />
          <Skeleton className="h-9 w-36 mt-2" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className={cn('overflow-hidden', className)}>
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight">{current.name}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isPaid ? 'Payroll complete for this month' : `Step ${stepIndex[step] + 1} of 4`}
              </p>
            </div>
            {isPaid && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 px-2.5 py-1 text-[0.65rem] font-medium">
                <BadgeCheck className="h-3.5 w-3.5" />
                Paid
              </span>
            )}
          </div>

          {/* The four steps — the flow made visible, so nobody has to learn
              the status vocabulary to know where they are. */}
          <ol className="mt-4 flex flex-col gap-2">
            {(Object.keys(STEP_LABELS) as Step[]).map((s) => {
              const isDone = done(s);
              const isCurrent = !isPaid && s === step;
              return (
                <li key={s} className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      'flex h-4 w-4 items-center justify-center rounded-full shrink-0 border',
                      isDone
                        ? 'bg-emerald-500 border-emerald-500 text-white'
                        : isCurrent
                          ? 'border-primary bg-primary/10'
                          : 'border-muted-foreground/25',
                    )}
                  >
                    {isDone ? (
                      <Check className="h-2.5 w-2.5" strokeWidth={3} />
                    ) : isCurrent ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      'text-xs',
                      isDone
                        ? 'text-muted-foreground line-through decoration-muted-foreground/40'
                        : isCurrent
                          ? 'font-medium text-foreground'
                          : 'text-muted-foreground',
                    )}
                  >
                    {STEP_LABELS[s]}
                  </span>
                  {s === 'salaries' && (
                    <span
                      className={cn(
                        'text-[0.65rem] tabular-nums',
                        salariesReady ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400 font-medium',
                      )}
                    >
                      {assignedCount} of {totalEmployees}
                    </span>
                  )}
                  {s === 'review' && payslipCount > 0 && (
                    <span className="text-[0.65rem] text-muted-foreground tabular-nums">
                      {payslipCount} payslips
                    </span>
                  )}
                </li>
              );
            })}
          </ol>

          {/* Exactly one action, always the next one. */}
          <div className="mt-5 flex items-center gap-3 flex-wrap">
            {step === 'salaries' && (
              <>
                <Button size="sm" className="h-9" onClick={() => router.push('/hr/payroll/salaries')}>
                  Assign salaries
                  <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                </Button>
                <p className="text-[0.7rem] text-amber-600 dark:text-amber-400 inline-flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Payroll skips employees with no salary.
                </p>
              </>
            )}

            {step === 'run' && canRun && (
              <Button size="sm" className="h-9" disabled={isBusy} onClick={() => setConfirmRun(true)}>
                {isBusy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
                Run Payroll
              </Button>
            )}

            {step === 'review' && canApprove && period && (
              <>
                <Button size="sm" className="h-9" disabled={isBusy} onClick={() => approvePayroll.mutate(period.id)}>
                  {isBusy && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                  Approve Payroll
                </Button>
                <Button variant="outline" size="sm" className="h-9" onClick={() => router.push(`/hr/payroll/periods/${period.id}`)}>
                  Review {payslipCount} payslips
                </Button>
              </>
            )}

            {step === 'approve' && !isPaid && canApprove && period && (
              <Button size="sm" className="h-9" disabled={isBusy} onClick={() => markPaid.mutate(period.id)}>
                {isBusy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Wallet className="h-3.5 w-3.5 mr-1.5" />}
                Mark as Paid
              </Button>
            )}

            {isPaid && period && (
              <Button variant="outline" size="sm" className="h-9" onClick={() => router.push(`/hr/payroll/periods/${period.id}`)}>
                View {payslipCount} payslips
              </Button>
            )}

            {step === 'run' && !canRun && (
              <p className="text-xs text-muted-foreground">You do not have permission to run payroll.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Payroll is the least reversible thing in the product, so the numbers
          are shown before committing — including that a re-run replaces. */}
      <ConfirmDialog
        open={confirmRun}
        onOpenChange={setConfirmRun}
        title={`Run payroll for ${current.name}?`}
        description={
          `${assignedCount} of ${totalEmployees} employees have a salary assigned. ` +
          `This generates ${assignedCount} payslips, about ${money(estimatedGross)} gross. ` +
          (payslipCount > 0
            ? 'Re-running replaces the payslips already generated for this period.'
            : '')
        }
        confirmLabel="Run Payroll"
        onConfirm={handleRun}
        isPending={isBusy}
      />
    </>
  );
}
