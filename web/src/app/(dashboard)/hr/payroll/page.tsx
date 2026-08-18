'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  CalendarDays,
  CheckCircle2,
  DollarSign,
  FileText,
  Hourglass,
  Loader2,
  Play,
  Plus,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
  usePayrollPeriods,
  useRunPayroll,
} from '@/hooks/hr/use-payroll';
import { formatDate } from '@/lib/utils';
import type { PayrollPeriod } from '@/lib/validations/payroll';
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

export default function PayrollPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { hasPermission } = usePermissionStore();
  const canViewAll = hasPermission('payroll.view_all');
  const canRun = hasPermission('payroll.run');
  const canApprove = hasPermission('payroll.approve');

  useEffect(() => {
    if (user && !canViewAll) {
      router.push('/hr/payroll/my-payslips');
    }
  }, [user, canViewAll, router]);

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [runTarget, setRunTarget] = useState<PayrollPeriod | null>(null);
  const [approveTarget, setApproveTarget] = useState<PayrollPeriod | null>(null);

  const { data, isLoading, isError } = usePayrollPeriods();
  const runMutation = useRunPayroll();
  const approveMutation = useApprovePayroll();

  const periods = data?.data ?? [];

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
            Manage payroll periods, run payroll, and approve payslips
          </p>
        </div>
        {canRun && (
          <Button
            size="sm"
            className="h-8 text-xs"
            nativeButton={false}
            render={<Link href="/hr/payroll/periods" />}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Manage Periods
          </Button>
        )}
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: periods.length, icon: FileText, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Draft', value: draftCount, icon: Hourglass, color: 'text-amber-500', bg: 'bg-amber-500/10' },
          { label: 'Approved', value: approvedCount, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          { label: 'Paid', value: paidCount, icon: DollarSign, color: 'text-violet-500', bg: 'bg-violet-500/10' },
        ].map((s) => (
          <Card key={s.label} className="border-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-2.5">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${s.bg} shrink-0`}>
                  <s.icon className={`h-4 w-4 ${s.color}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">{s.label}</p>
                  <p className="text-base font-bold text-foreground tabular-nums leading-tight">
                    {isLoading ? '--' : s.value}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

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
                        <td className="px-4 py-2.5 whitespace-nowrap text-right">
                          {period.status === 'draft' ? (
                            <div className="inline-flex items-center gap-1.5">
                              {canRun && (
                                <Button
                                  size="sm"
                                  className="h-6 px-2.5 text-[0.6rem]"
                                  onClick={() => setRunTarget(period)}
                                >
                                  <Play className="h-3 w-3 mr-1" />
                                  Run
                                </Button>
                              )}
                              {canApprove && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-6 px-2.5 text-[0.6rem]"
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

      {/* Run Payroll Dialog */}
      <Dialog open={!!runTarget} onOpenChange={(open) => { if (!open) setRunTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                <Play className="h-3.5 w-3.5 text-primary" />
              </div>
              Run Payroll
            </DialogTitle>
            <DialogDescription className="text-xs">
              This will calculate payslips for all employees with salary assignments
              for <span className="font-medium text-foreground">{runTarget?.name}</span>.
              This may take a few minutes for large teams.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setRunTarget(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                if (runTarget) {
                  runMutation.mutate(runTarget.id, { onSuccess: () => setRunTarget(null) });
                }
              }}
              disabled={runMutation.isPending}
            >
              {runMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Run Payroll
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
