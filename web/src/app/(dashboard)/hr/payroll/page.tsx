'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, Play, CheckCircle, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import {
  usePayrollPeriods,
  useRunPayroll,
  useApprovePayroll,
} from '@/hooks/hr/use-payroll';
import { usePermissionStore } from '@/stores/permission-store';
import { useAuthStore } from '@/stores/auth-store';
import { formatDate } from '@/lib/utils';
import type { PayrollPeriod } from '@/lib/validations/payroll';

function PayrollStatusBadge({ status }: { status: PayrollPeriod['status'] }) {
  const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    draft: 'secondary',
    processing: 'outline',
    approved: 'default',
    paid: 'default',
  };
  return <Badge variant={variants[status] ?? 'secondary'}>{status}</Badge>;
}

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

  const [runTarget, setRunTarget] = useState<PayrollPeriod | null>(null);
  const [approveTarget, setApproveTarget] = useState<PayrollPeriod | null>(null);
  const { data, isLoading, isError } = usePayrollPeriods();
  const runMutation = useRunPayroll();
  const approveMutation = useApprovePayroll();

  const periods = data?.data ?? [];

  if (!canViewAll) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Payroll</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage payroll periods, run payroll, and approve payslips
          </p>
        </div>
        {canRun && (
          <Button render={<Link href="/hr/payroll/periods" />}>
            <Plus data-icon="inline-start" />
            Manage Periods
          </Button>
        )}
      </div>

      {isError ? (
        <Card>
          <CardContent className="py-8">
            <p className="text-center text-muted-foreground">Failed to load payroll periods</p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : periods.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <p className="text-muted-foreground font-medium">No payroll periods yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Create a payroll period to get started.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="hidden md:grid md:grid-cols-6 gap-4 px-4 py-2.5 text-xs font-medium text-muted-foreground border-b border-border">
              <span>Name</span>
              <span>Period</span>
              <span>Type</span>
              <span>Status</span>
              <span>Payslips</span>
              <span className="text-right">Actions</span>
            </div>
            {periods.map((period, idx) => (
              <div key={period.id}>
                {idx > 0 && <Separator />}
                <div className="grid grid-cols-2 gap-2 px-4 py-3 md:grid-cols-6 md:gap-4 md:items-center">
                  <div className="font-medium text-sm text-foreground">
                    <Link href={`/hr/payroll/periods/${period.id}`} className="hover:underline">
                      {period.name}
                    </Link>
                  </div>
                  <div className="text-xs text-muted-foreground md:text-sm">
                    {formatDate(period.start_date)} &mdash; {formatDate(period.end_date)}
                  </div>
                  <div className="text-xs text-muted-foreground md:text-sm capitalize">
                    {period.period_type}
                  </div>
                  <div>
                    <PayrollStatusBadge status={period.status} />
                  </div>
                  <div className="text-sm tabular-nums">
                    {period.payslips_count ?? '-'}
                  </div>
                  <div className="flex justify-end gap-1 col-span-2 md:col-span-1">
                    {canRun && period.status === 'draft' && (
                      <Button variant="ghost" size="sm" onClick={() => setRunTarget(period)}>
                        <Play className="h-3.5 w-3.5 mr-1" />
                        Run
                      </Button>
                    )}
                    {canApprove && period.status === 'draft' && (
                      <Button variant="ghost" size="sm" onClick={() => setApproveTarget(period)}>
                        <CheckCircle className="h-3.5 w-3.5 mr-1" />
                        Approve
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Run Payroll Dialog */}
      <Dialog open={!!runTarget} onOpenChange={(open) => { if (!open) setRunTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run Payroll</DialogTitle>
            <DialogDescription>
              This will calculate payslips for all employees with salary assignments
              for the period &ldquo;{runTarget?.name}&rdquo;. This may take a few minutes for large teams.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              onClick={() => {
                if (runTarget) {
                  runMutation.mutate(runTarget.id, { onSuccess: () => setRunTarget(null) });
                }
              }}
              disabled={runMutation.isPending}
            >
              {runMutation.isPending && <Loader2 className="animate-spin" data-icon="inline-start" />}
              Run Payroll
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approve Payroll Dialog */}
      <Dialog open={!!approveTarget} onOpenChange={(open) => { if (!open) setApproveTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Payroll</DialogTitle>
            <DialogDescription>
              This will finalize all payslips for &ldquo;{approveTarget?.name}&rdquo;.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              onClick={() => {
                if (approveTarget) {
                  approveMutation.mutate(approveTarget.id, { onSuccess: () => setApproveTarget(null) });
                }
              }}
              disabled={approveMutation.isPending}
            >
              {approveMutation.isPending && <Loader2 className="animate-spin" data-icon="inline-start" />}
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
