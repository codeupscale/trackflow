'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Loader2, Search, Users, Wallet, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { TabLoading } from '@/components/ui/loader-3d';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';

import { AssignSalaryDialog } from '@/components/hr/AssignSalaryDialog';
import { useSalaryRoster, type SalaryRosterRow } from '@/hooks/hr/use-salary-roster';
import { useAuthStore } from '@/stores/auth-store';
import { usePermissionStore } from '@/stores/permission-store';
import { cn, formatDate } from '@/lib/utils';

const STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'unassigned', label: 'Needs salary' },
  { value: 'assigned', label: 'Assigned' },
] as const;

type StatusTab = (typeof STATUS_TABS)[number]['value'];

function initials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

function money(n: number | null | undefined) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
}

export default function SalaryRosterPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { hasPermission } = usePermissionStore();

  const canView = hasPermission('payroll.view_all');
  const canAssign = hasPermission('payroll.manage_structures');

  useEffect(() => {
    if (user && !canView) router.push('/hr/payroll');
  }, [user, canView, router]);

  const [status, setStatus] = useState<StatusTab>('all');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<SalaryRosterRow | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  const { data, isLoading, isError } = useSalaryRoster({
    status,
    search: debounced || undefined,
    page,
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.last_page ?? 1;

  // Coverage is the number that matters: payroll skips anyone unassigned, so a
  // gap here is why a run produces fewer payslips than expected.
  const { data: allData } = useSalaryRoster({ per_page: 100 });
  const allRows = allData?.data ?? [];
  const assigned = allRows.filter((r) => r.assignment).length;
  const headcount = allData?.total ?? allRows.length;
  const missing = headcount - assigned;

  if (!user || !canView) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Employee Salaries</h1>
        <p className="text-xs text-muted-foreground">
          Assign a salary structure to each employee so payroll can pay them
        </p>
      </div>

      {/* Coverage — the reason this screen exists */}
      <Card
        className={cn(
          'border',
          missing > 0
            ? 'border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/5'
            : 'border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/5',
        )}
      >
        <CardContent className="p-4 flex items-center gap-3">
          {missing > 0 ? (
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">
              {missing > 0
                ? `${missing} of ${headcount} employees have no salary assigned`
                : `All ${headcount} employees have a salary assigned`}
            </p>
            <p className="text-[0.65rem] text-muted-foreground mt-0.5">
              {missing > 0
                ? 'Payroll will skip them and generate no payslip.'
                : 'Payroll will generate a payslip for everyone.'}
            </p>
          </div>
          {missing > 0 && status !== 'unassigned' && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs ml-auto shrink-0"
              onClick={() => { setStatus('unassigned'); setPage(1); }}
            >
              Show them
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:w-[240px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            placeholder="Search employees..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-xs pl-8 pr-8"
          />
          {search && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setSearch('')}
              className="absolute right-0.5 top-1/2 -translate-y-1/2 size-7 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-3" />
            </Button>
          )}
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-muted p-1 w-fit">
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => { setStatus(t.value); setPage(1); }}
              className={cn(
                'rounded-md px-3 py-1.5 text-[0.7rem] font-medium transition-colors',
                status === t.value
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-12 flex flex-col items-center gap-2">
            <Wallet className="h-8 w-8 text-destructive/60" />
            <p className="text-sm text-muted-foreground font-medium">Failed to load salaries</p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <TabLoading />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 flex flex-col items-center text-center gap-2">
            <Users className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground font-medium">No employees found</p>
            <p className="text-xs text-muted-foreground">
              {status === 'unassigned' ? 'Everyone has a salary assigned.' : 'Try a different search.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">Employee</th>
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">Structure</th>
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 text-right">Base Salary</th>
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">Effective From</th>
                    {canAssign && (
                      <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 text-right">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <div className="flex items-center gap-2.5">
                          <Avatar className="h-7 w-7 shrink-0">
                            <AvatarImage src={row.avatar_url ?? undefined} alt={row.name} />
                            <AvatarFallback className="text-[0.55rem] font-semibold">{initials(row.name)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="text-[0.75rem] font-medium truncate">{row.name}</p>
                            <p className="text-[0.6rem] text-muted-foreground truncate">{row.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {row.assignment ? (
                          <span className="text-[0.75rem] text-foreground">{row.assignment.structure.name}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 px-2 py-0.5 text-[0.6rem] font-medium">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            No salary
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-right text-[0.75rem] tabular-nums">
                        {row.assignment ? (
                          <>
                            {money(row.assignment.effective_base_salary)}
                            {row.assignment.custom_base_salary != null && (
                              <span className="ml-1.5 text-[0.6rem] text-muted-foreground">custom</span>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-[0.75rem] text-muted-foreground">
                        {row.assignment ? formatDate(row.assignment.effective_from) : '—'}
                      </td>
                      {canAssign && (
                        <td className="px-4 py-2.5 whitespace-nowrap text-right">
                          <Button
                            variant={row.assignment ? 'ghost' : 'default'}
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setTarget(row)}
                          >
                            {row.assignment ? 'Change' : 'Assign'}
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {!isLoading && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-[0.65rem] text-muted-foreground tabular-nums">
            {rows.length} of {total} employees
          </p>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious onClick={() => setPage((p) => Math.max(1, p - 1))} className="cursor-pointer" />
              </PaginationItem>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <PaginationItem key={p}>
                  <PaginationLink isActive={p === page} onClick={() => setPage(p)} className="cursor-pointer">
                    {p}
                  </PaginationLink>
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="cursor-pointer" />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}

      <AssignSalaryDialog
        employee={target}
        open={!!target}
        onOpenChange={(open) => { if (!open) setTarget(null); }}
      />
    </div>
  );
}
