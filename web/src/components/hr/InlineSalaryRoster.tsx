'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2, Users, Wallet } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

import { AssignSalaryDialog } from '@/components/hr/AssignSalaryDialog';
import { useSalaryRoster, type SalaryRosterRow } from '@/hooks/hr/use-salary-roster';
import { useAutoAssignSalaries } from '@/hooks/hr/use-auto-assign-salaries';
import { cn, formatDate } from '@/lib/utils';
import { formatMoney, useCurrency } from '@/lib/money';

interface Props {
  canManage: boolean;
  className?: string;
  /** Fetch the directory as soon as this mounts, as the run card asks for. */
  autoLoad?: boolean;
  /**
   * This list's own Fetch button was pressed. There are two doors to the same
   * step — the run card's CTA and the button here — and without telling the
   * page, pressing this one left the card still offering "Fetch employees" for
   * a list that was already on screen.
   */
  onFetched?: () => void;
}

function money(value: number | null | undefined, currency: string) {
  if (value === null || value === undefined) return '—';
  return formatMoney(value, currency, { symbol: false, compact: true });
}

/**
 * Who is on payroll, inline on the payroll screen.
 *
 * Every active employee is listed, with their grade and base salary when they
 * have one. Those without are sorted to the top and highlighted, because they
 * are what stops the run.
 *
 * One button covers all of them: it reads each person's designation and gives
 * them the grade linked to it. No grade is chosen here — that decision already
 * lives on the designation, and asking for one figure to apply to everybody is
 * exactly what this must not do.
 */
export function InlineSalaryRoster({
  canManage,
  className,
  autoLoad = false,
  onFetched,
}: Props) {
  const currency = useCurrency();
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<SalaryRosterRow | null>(null);
  const [loaded, setLoaded] = useState(autoLoad);

  // Follows the parent BOTH ways. It used to latch on only — so when the run
  // card reset itself to "Fetch employees" (the salaries had been wiped since
  // the last visit) this list stayed populated underneath it, showing a roster
  // the card was simultaneously offering to fetch.
  //
  // A press of this component's own Fetch button is safe from being undone:
  // the effect re-runs only when `autoLoad` itself changes, and that press
  // does not change it.
  useEffect(() => {
    setLoaded(autoLoad);
  }, [autoLoad]);

  // Held until asked for. Fetching is its own step: the employees are listed
  // first so what is about to be assigned is visible BEFORE it happens.
  const { data, isLoading, isFetching } = useSalaryRoster({
    search: search || undefined,
    per_page: 200,
    enabled: loaded,
  });
  const autoAssign = useAutoAssignSalaries();

  // Unassigned first: they are the ones blocking the run, and on a long
  // roster they would otherwise be scattered through it.
  const rows = useMemo(
    () =>
      [...(data?.data ?? [])].sort((a, b) => {
        if (!a.assignment && b.assignment) return -1;
        if (a.assignment && !b.assignment) return 1;
        return a.name.localeCompare(b.name);
      }),
    [data],
  );
  const queue = useMemo(() => rows.filter((r) => !r.assignment), [rows]);

  return (
    <Card className={className}>
      <CardContent className="p-0">
        {/* Always present, because it is the way the list gets populated at
            all — not a warning that appears once something is wrong. */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 p-3">
          <div className="flex items-center gap-2">
            {queue.length > 0 && (
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            )}
            <div>
              <p className="text-xs font-medium">Employees on payroll</p>
              <p className="text-[0.65rem] text-muted-foreground">
                {!loaded
                  ? 'Fetch your employees from the directory to get started.'
                  : isFetching
                    ? 'Fetching employees from the directory…'
                    : autoAssign.phase === 'assigning'
                      ? `Assigning salaries… ${autoAssign.progress.done} of ${autoAssign.progress.total}`
                      : queue.length > 0
                        ? `${queue.length} of ${rows.length} still without a salary — payroll will not run until they have one.`
                        : `${rows.length} ${rows.length === 1 ? 'employee' : 'employees'} ready to be paid.`}
              </p>
            </div>
          </div>

          {/* Two distinct steps in ONE button position, so it never vanishes
              mid-flow: Fetch lists them, then Assign acts on the list. While
              the fetch is in flight the button stays put and says so —
              previously it disappeared, leaving nothing to press. */}
          {!loaded ? (
            <Button
              size="sm"
              className="h-8 shrink-0 text-xs"
              onClick={() => {
                setLoaded(true);
                onFetched?.();
              }}
            >
              <Users className="mr-1.5 h-3.5 w-3.5" />
              Fetch employees
            </Button>
          ) : isLoading || isFetching ? (
            <Button size="sm" className="h-8 shrink-0 text-xs" disabled>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Fetching employees…
            </Button>
          ) : queue.length > 0 ? (
            <Button
              size="sm"
              className="h-8 shrink-0 text-xs"
              disabled={!canManage || autoAssign.isBusy}
              onClick={autoAssign.run}
            >
              {autoAssign.isBusy ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wallet className="mr-1.5 h-3.5 w-3.5" />
              )}
              {autoAssign.phase === 'assigning'
                ? `Assigning ${autoAssign.progress.done}/${autoAssign.progress.total}`
                : `Assign salaries to all ${queue.length}`}
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[0.7rem] font-medium text-emerald-600 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" />
              All salaries assigned
            </span>
          )}
        </div>

        {/* Anyone the automatic pass could not place. Named, because "3 could
            not be assigned" sends someone hunting through a roster. */}
        {autoAssign.skipped.length > 0 && (
          <div className="flex items-start gap-2 border-b border-border/50 bg-amber-500/[0.06] px-3 py-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-[0.68rem] text-muted-foreground">
              <span className="font-medium text-amber-700 dark:text-amber-400">
                {autoAssign.skipped.join(', ')}
              </span>{' '}
              {autoAssign.skipped.length === 1 ? 'has' : 'have'} no grade set for their designation
              — assign {autoAssign.skipped.length === 1 ? 'them' : 'those'} on the row below, or
              link a grade to that designation under Salary Structures.
            </p>
          </div>
        )}

        {/* Nothing to search until the list is fetched. */}
        {loaded && (
          <div className="border-b border-border/50 p-3">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or email"
              className="h-8 max-w-xs text-xs"
            />
          </div>
        )}

        {/* Table */}
        {!loaded ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Users className="h-7 w-7 text-muted-foreground/40" />
            <p className="text-xs font-medium text-muted-foreground">No employees loaded</p>
            <p className="max-w-sm text-[0.65rem] text-muted-foreground">
              Press <span className="font-medium text-foreground">Fetch employees</span> to list
              everyone from the employee directory. You can then assign their salaries.
            </p>
          </div>
        ) : isLoading || isFetching ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-xs font-medium text-muted-foreground">
              {search ? 'No matching employee.' : 'No employees found in the directory.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border/50">
                  {[
                    'Employee',
                    'Role',
                    'Designation',
                    'Grade',
                    'Type',
                    'Base salary',
                    'Effective from',
                    'Status',
                    '',
                  ].map((h, i) => (
                    <th
                      key={h || i}
                      className={cn(
                        'whitespace-nowrap px-3 py-2.5 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground',
                        h === 'Base salary' && 'text-right',
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const a = row.assignment;
                  return (
                    <tr
                      key={row.id}
                      className={cn(
                        'border-b border-border/30 transition-colors last:border-0',
                        // The rows that block a run are the ones to look at
                        // first, so they carry the weight.
                        a ? 'hover:bg-muted/30' : 'bg-amber-500/[0.06] hover:bg-amber-500/[0.1]',
                      )}
                    >
                      <td className="whitespace-nowrap px-3 py-2">
                        <p className="text-[0.75rem] font-medium">{row.name}</p>
                        <p className="text-[0.62rem] text-muted-foreground">{row.email}</p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-[0.7rem] capitalize text-muted-foreground">
                        {row.role.replace(/_/g, ' ')}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-[0.7rem] text-muted-foreground">
                        {row.position?.title ?? '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-[0.72rem]">
                        {a?.structure.name ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-[0.7rem] capitalize text-muted-foreground">
                        {a?.structure.type ?? '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-[0.72rem] tabular-nums">
                        {a ? (
                          <>
                            {money(a.effective_base_salary, currency)}
                            {a.custom_base_salary !== null && (
                              <span className="ml-1 text-[0.58rem] uppercase text-muted-foreground">
                                custom
                              </span>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-[0.7rem] text-muted-foreground">
                        {a ? formatDate(a.effective_from) : '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {a ? (
                          <span className="inline-flex items-center gap-1.5 text-[0.7rem] font-medium text-emerald-600 dark:text-emerald-400">
                            <Check className="h-3.5 w-3.5" />
                            Assigned
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[0.7rem] font-medium text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            No salary
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {/* The row that blocks the run gets the solid button —
                            it is the action, not an option among others. */}
                        <Button
                          variant={a ? 'ghost' : 'default'}
                          size="sm"
                          className="h-7 text-[0.7rem]"
                          disabled={!canManage}
                          onClick={() => setTarget(row)}
                        >
                          {a ? 'Change' : 'Assign salary'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {/* Per-employee override, for a salary that is not the standard grade. */}
      <AssignSalaryDialog
        employee={target}
        open={Boolean(target)}
        onOpenChange={(open) => !open && setTarget(null)}
      />

    </Card>
  );
}
