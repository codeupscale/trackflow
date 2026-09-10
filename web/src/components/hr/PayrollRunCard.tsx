'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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
import { formatMoney, useCurrency } from '@/lib/money';
import { useAutoAssignSalaries } from '@/hooks/hr/use-auto-assign-salaries';
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

/**
 * Today as `YYYY-MM-DD` in LOCAL time. Never toISOString(), which converts to
 * UTC first and so reports yesterday for anyone west of Greenwich in the
 * evening — a whole day's difference at exactly the month boundary this
 * comparison exists to police.
 */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function money(n: number, currency: string) {
  return formatMoney(n, currency, { compact: true });
}

interface PayrollRunCardProps {
  canRun: boolean;
  canApprove: boolean;
  className?: string;
  /**
   * Open the salary roster inline on this page. Assigning salaries is part of
   * the run, not a separate errand, so the card asks the page to expand it
   * rather than navigating away mid-task.
   */
  onAssignSalaries?: () => void;
  /** True once the roster has been fetched, so the CTA can become Assign. */
  salariesFetched?: boolean;
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
export function PayrollRunCard({
  canRun,
  canApprove,
  className,
  onAssignSalaries,
  salariesFetched = false,
}: PayrollRunCardProps) {
  const router = useRouter();
  const currency = useCurrency();
  const [confirmRun, setConfirmRun] = useState(false);

  const current = useMemo(() => monthBounds(new Date()), []);

  const { data: rosterData, isLoading: rosterLoading } = useSalaryRoster({ per_page: 100 });
  const { data: periodsData, isLoading: periodsLoading } = usePayrollPeriods();

  const createPeriod = useCreatePayrollPeriod();
  // Silent: this card shows the run's progress itself, so a "queued" toast
  // would announce the beginning as though it were the end.
  const runPayroll = useRunPayroll({ silent: true });
  const autoAssign = useAutoAssignSalaries();
  const approvePayroll = useApprovePayroll();
  const markPaid = useMarkPayrollPaid();

  const roster = rosterData?.data ?? [];
  const assignedCount = roster.filter((r) => r.assignment).length;
  const totalEmployees = rosterData?.total ?? roster.length;
  const salariesReady = totalEmployees > 0 && assignedCount === totalEmployees;

  // NOT cleared on arrival any more.
  //
  // This used to reset the remembered fetch whenever nobody had a salary, so
  // that a run reset on the server sent the card back to "Fetch employees".
  // But "nobody has a salary" is ALSO exactly the state between fetching and
  // assigning — the middle of the flow — so leaving the screen and returning
  // threw the fetch away and asked for it again.
  //
  // Of the two, persistence is the one that matters in use: once the employees
  // are listed, "Assign salaries" is the right next action whether or not a
  // reset happened, because the list is on screen either way. A reset simply
  // means everyone in it is unassigned, which is what the button acts on.

  // Estimated gross for the confirmation — the operator should see a number
  // before committing, since a run replaces any existing payslips.
  const estimatedGross = roster.reduce(
    (sum, r) => sum + (r.assignment?.effective_base_salary ?? 0),
    0,
  );

  const periods = useMemo(() => periodsData?.data ?? [], [periodsData]);
  // The period being paid RIGHT NOW: the one whose range contains today.
  //
  // This used to match a start_date equal to the 1st of the calendar month,
  // which broke in both directions once periods could be added by hand. A
  // period covering 05 Sep – 04 Oct was not found, so pressing Run created a
  // SECOND September period beside it; and a range not anchored to the 1st
  // could in principle be matched while it was still in the future. Containment
  // is the rule that actually expresses "the month we are paying": October is
  // never selected during September, because today is not inside it, and the
  // card therefore has no way to run a period that has not begun.
  const period = useMemo(() => {
    const today = todayIso();
    const live = periods.filter(
      (p) => (p.start_date?.slice(0, 10) ?? '') <= today && today <= (p.end_date?.slice(0, 10) ?? ''),
    );
    // More than one only happens where ranges overlap, which is a
    // configuration mistake rather than a state to model. The one that started
    // most recently is the one being worked on.
    live.sort((a, b) => (a.start_date < b.start_date ? 1 : -1));

    return live[0] ?? periods.find((p) => p.start_date?.slice(0, 10) === current.start);
  }, [periods, current.start]);
  // What the card calls the run. The period's own name when one exists — a
  // hand-made period may be named for the cycle it pays rather than the
  // calendar month it sits in, and the card must not rename it on screen.
  const periodName = period?.name ?? current.name;
  const payslipCount = period?.payslips_count ?? 0;
  // Approval is refused server-side until every payslip has been verified, so
  // the button must not offer itself before then — a control whose only
  // possible outcome is an error is worse than no control.
  const verifiedCount = period?.verified_payslips_count ?? 0;
  const allVerified = payslipCount > 0 && verifiedCount >= payslipCount;

  const isPaid = period?.status === 'paid';

  // ── Watching a queued run ────────────────────────────────────────────
  //
  // The run is a JOB. The request returns the moment it is accepted, and the
  // payslips appear some seconds later — so the screen used to say "queued"
  // and then sit there, indistinguishable from a run that had not started, and
  // reviewing meant reloading the page by hand to discover it had finished.
  //
  // Polling is the only signal available: the period sits in 'processing' only
  // while the job holds its transaction, so its status is not observable for
  // most of the wait. Payslip count is what actually answers "is it done".
  const queryClient = useQueryClient();
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // `processed_at` as it stood when the run was launched. Completion is that
  // value CHANGING — not the payslips merely existing, which on a re-run they
  // already do, and which would have declared the job finished before it
  // started. The job stamps it inside its own transaction, so the new value
  // and the finished payslips become visible together.
  const [processedAtBaseline, setProcessedAtBaseline] = useState<string | null>(null);
  const running = runStartedAt !== null;
  // Long enough to mean something is wrong rather than merely busy. The usual
  // cause is a queue worker that is not running, which no amount of waiting
  // fixes — so the card says so instead of spinning forever.
  const STALL_AFTER_MS = 30_000;
  const stalled = running && elapsed * 1000 >= STALL_AFTER_MS;

  useEffect(() => {
    if (!running) return;
    const tick = setInterval(() => {
      setElapsed(Math.round((Date.now() - runStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(tick);
  }, [running, runStartedAt]);

  useEffect(() => {
    if (!running || stalled) return;
    const poll = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ['payroll-periods'] });
    }, 1500);
    return () => clearInterval(poll);
  }, [running, stalled, queryClient]);

  // Handing over to the review step is the point of watching at all.
  //
  // This IS the rule's own exception — subscribing to an external system and
  // setting state when it changes — except the system is a queue with no
  // callback to offer, so the subscription is expressed as polling and the
  // "callback" lands in an effect. The guard above makes it fire once: the
  // stamp has to differ from the one captured at launch, and clearing
  // `running` closes the condition immediately.
  const processedAt = period?.processed_at ?? null;
  useEffect(() => {
    if (!running || !processedAt || processedAt === processedAtBaseline) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRunStartedAt(null);
    setElapsed(0);
    queryClient.invalidateQueries({ queryKey: ['payslips'] });
    toast.success(
      `Payroll complete — ${payslipCount} ${payslipCount === 1 ? 'payslip' : 'payslips'} ready to review.`,
    );
  }, [running, processedAt, processedAtBaseline, payslipCount, queryClient]);

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
    if (!id) return;
    // Captured BEFORE the request, so a job fast enough to finish between the
    // response and this line still reads as a change rather than as the
    // baseline it is being compared against.
    const baseline = period?.processed_at ?? null;
    try {
      await runPayroll.mutateAsync(id);
      setProcessedAtBaseline(baseline);
      setElapsed(0);
      setRunStartedAt(Date.now());
    } catch {
      // onError named the reason — a missing salary, most often. Not entering
      // the watching state matters: there is no job to wait for.
    }
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
              <h2 className="text-base font-semibold tracking-tight">{periodName}</h2>
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

          {/* While the job runs, the card watches it instead of offering an
              action — there is nothing to press, and the one thing worth
              knowing is that it is still working. */}
          {running && (
            <div className="mt-5 rounded-lg border border-border/60 bg-muted/30 p-4">
              <div className="flex items-center gap-3">
                <span className="relative flex h-8 w-8 shrink-0 items-center justify-center">
                  <span
                    className={cn(
                      'absolute inset-0 rounded-full',
                      stalled ? 'bg-amber-500/15' : 'animate-ping bg-primary/20',
                    )}
                  />
                  {stalled ? (
                    <AlertTriangle className="relative h-4 w-4 text-amber-600 dark:text-amber-400" />
                  ) : (
                    <Loader2 className="relative h-4 w-4 animate-spin text-primary" />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">
                    {stalled
                      ? 'Still waiting for the payroll job'
                      : `Running payroll for ${totalEmployees} ${totalEmployees === 1 ? 'employee' : 'employees'}…`}
                  </p>
                  <p className="mt-0.5 text-[0.68rem] text-muted-foreground">
                    {stalled
                      ? 'Nothing has come back after 30 seconds. The queue worker may not be running — payslips appear here on their own once it does.'
                      : 'Calculating each payslip. This page updates itself — no need to refresh.'}
                  </p>
                </div>

                <span className="shrink-0 text-[0.68rem] tabular-nums text-muted-foreground">
                  {elapsed}s
                </span>
              </div>

              {/* Indeterminate on purpose. The job writes all the payslips in
                  one transaction, so there is no honest fraction to show — a
                  bar that crept to 90% and waited would be a lie with a
                  progress bar's face on it. */}
              {!stalled && (
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-border/60">
                  <div className="h-full w-1/3 animate-[payroll-run_1.4s_ease-in-out_infinite] rounded-full bg-primary" />
                </div>
              )}

              <style>{`
                @keyframes payroll-run {
                  0%   { transform: translateX(-100%); }
                  100% { transform: translateX(320%); }
                }
              `}</style>
            </div>
          )}

          {/* Exactly one action, always the next one. */}
          <div className={cn('mt-5 flex items-center gap-3 flex-wrap', running && 'hidden')}>
            {step === 'salaries' && (
              <>
                {/* One CTA, two steps: it fetches the employees, then becomes
                    the assign action once they are on screen. The label has to
                    follow the state — a button still saying "Fetch employees"
                    after they are listed describes something already done. */}
                <Button
                  size="sm"
                  className="h-9"
                  disabled={autoAssign.isBusy}
                  onClick={() => {
                    if (!salariesFetched) {
                      onAssignSalaries?.();
                      return;
                    }
                    onAssignSalaries?.();
                    void autoAssign.run();
                  }}
                >
                  {autoAssign.isBusy ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : null}
                  {autoAssign.phase === 'assigning'
                    ? `Assigning ${autoAssign.progress.done}/${autoAssign.progress.total}`
                    : salariesFetched
                      ? 'Assign salaries'
                      : 'Fetch employees'}
                  {!autoAssign.isBusy && <ArrowRight className="h-3.5 w-3.5 ml-1.5" />}
                </Button>
                <p className="text-[0.7rem] text-amber-600 dark:text-amber-400 inline-flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Payroll will not run until everyone has a salary.
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
                {/* Reviewing leads; approving follows. Until every payslip is
                    verified the review is the only thing that can move the run
                    forward, so it is the primary button and Approve waits. */}
                <Button
                  size="sm"
                  variant={allVerified ? 'outline' : 'default'}
                  className="h-9"
                  onClick={() => router.push(`/hr/payroll/periods/${period.id}`)}
                >
                  Review {payslipCount} payslips
                </Button>
                <Button
                  size="sm"
                  className="h-9"
                  disabled={isBusy || !allVerified}
                  onClick={() => approvePayroll.mutate(period.id)}
                >
                  {isBusy && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                  Approve Payroll
                </Button>
                {!allVerified && (
                  <p className="text-[0.7rem] text-amber-600 dark:text-amber-400 inline-flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    {verifiedCount} of {payslipCount} payslips verified — review the rest before approving.
                  </p>
                )}
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
        title={`Run payroll for ${periodName}?`}
        description={
          `${assignedCount} of ${totalEmployees} employees have a salary assigned. ` +
          `This generates ${assignedCount} payslips, about ${money(estimatedGross, currency)} gross. ` +
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
