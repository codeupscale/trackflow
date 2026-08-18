'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  CalendarDays,
  FileText,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import {
  usePayrollPeriods,
  useCreatePayrollPeriod,
  useDeletePayrollPeriod,
} from '@/hooks/hr/use-payroll';
import { usePermissionStore } from '@/stores/permission-store';
import { useAuthStore } from '@/stores/auth-store';
import { cn, formatDate } from '@/lib/utils';
import type { PayrollPeriod } from '@/lib/validations/payroll';

const statusDot: Record<string, { dot: string; text: string; label: string }> = {
  draft: { dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', label: 'Draft' },
  processing: { dot: 'bg-blue-500', text: 'text-blue-600 dark:text-blue-400', label: 'Processing' },
  approved: { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', label: 'Approved' },
  paid: { dot: 'bg-violet-500', text: 'text-violet-600 dark:text-violet-400', label: 'Paid' },
};

export default function PayrollPeriodsPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { hasPermission } = usePermissionStore();
  const canRun = hasPermission('payroll.run');

  useEffect(() => {
    if (user && !canRun) {
      router.push('/hr/payroll/my-payslips');
    }
  }, [user, canRun, router]);

  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PayrollPeriod | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    period_type: 'monthly' as 'monthly' | 'bi-weekly' | 'weekly',
    start_date: '',
    end_date: '',
  });

  const { data, isLoading, isError } = usePayrollPeriods();
  const createMutation = useCreatePayrollPeriod();
  const deleteMutation = useDeletePayrollPeriod();

  const periods = data?.data ?? [];

  const draftCount = periods.filter((p) => p.status === 'draft').length;
  const totalCount = periods.length;

  const handleCreate = () => {
    createMutation.mutate(formData, {
      onSuccess: () => {
        setShowCreate(false);
        setFormData({ name: '', period_type: 'monthly', start_date: '', end_date: '' });
      },
    });
  };

  const resetForm = () => {
    setFormData({ name: '', period_type: 'monthly', start_date: '', end_date: '' });
  };

  if (!canRun) return null;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Pay Periods</h1>
          <p className="text-xs text-muted-foreground">
            Create and manage payroll periods
          </p>
        </div>
        <Button size="sm" className="h-8 text-xs" onClick={() => { resetForm(); setShowCreate(true); }}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          New Period
        </Button>
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: totalCount, icon: FileText, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Draft', value: draftCount, icon: CalendarDays, color: 'text-amber-500', bg: 'bg-amber-500/10' },
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

      {/* Table */}
      {isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-12">
            <div className="flex flex-col items-center gap-2">
              <CalendarDays className="h-8 w-8 text-destructive/60" />
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
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3.5 w-16" />
                <Skeleton className="h-3.5 w-14" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : periods.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center gap-2">
              <CalendarDays className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">No payroll periods yet</p>
              <p className="text-xs text-muted-foreground">Create a payroll period to get started.</p>
              <Button size="sm" className="mt-2 h-7 text-xs" onClick={() => { resetForm(); setShowCreate(true); }}>
                <Plus className="h-3 w-3 mr-1" />
                New Period
              </Button>
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
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map((period) => {
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
                          <span className="text-[0.75rem] text-muted-foreground capitalize">
                            {period.period_type.replace('-', ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1.5 text-[0.7rem] font-medium ${sd.text}`}>
                            <span className={`inline-block w-1.5 h-1.5 rounded-full ${sd.dot}`} />
                            {sd.label}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-right">
                          {period.status === 'draft' ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                              onClick={() => setDeleteTarget(period)}
                              aria-label={`Delete ${period.name}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
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

      {/* Create Period Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                <CalendarDays className="h-3.5 w-3.5 text-primary" />
              </div>
              New Pay Period
            </DialogTitle>
            <DialogDescription className="text-xs">
              Create a new payroll period for your organization.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="period-name" className="text-xs">Name</Label>
              <Input
                id="period-name"
                className="h-9 text-sm"
                placeholder="e.g. August 2026"
                value={formData.name}
                onChange={(e) => setFormData((d) => ({ ...d, name: e.target.value }))}
              />
            </div>

            <div className="grid gap-1.5">
              <Label className="text-xs">Period Type</Label>
              <Select
                value={formData.period_type}
                onValueChange={(v) => setFormData((d) => ({ ...d, period_type: v as 'monthly' | 'bi-weekly' | 'weekly' }))}
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
                <span className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Date Range</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1">
                  <Label htmlFor="start_date" className="text-[0.65rem] text-muted-foreground">Start Date</Label>
                  <Input
                    id="start_date"
                    type="date"
                    className="h-8 text-xs"
                    value={formData.start_date}
                    onChange={(e) => setFormData((d) => ({ ...d, start_date: e.target.value }))}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="end_date" className="text-[0.65rem] text-muted-foreground">End Date</Label>
                  <Input
                    id="end_date"
                    type="date"
                    className="h-8 text-xs"
                    value={formData.end_date}
                    onChange={(e) => setFormData((d) => ({ ...d, end_date: e.target.value }))}
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
              onClick={() => setShowCreate(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={handleCreate}
              disabled={createMutation.isPending || !formData.name || !formData.start_date || !formData.end_date}
            >
              {createMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Create Period
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete Pay Period"
        description={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (deleteTarget) {
            deleteMutation.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) });
          }
        }}
        isPending={deleteMutation.isPending}
      />
    </div>
  );
}
