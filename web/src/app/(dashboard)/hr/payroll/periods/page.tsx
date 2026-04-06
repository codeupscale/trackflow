'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, Trash2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

import {
  usePayrollPeriods,
  useCreatePayrollPeriod,
  useDeletePayrollPeriod,
} from '@/hooks/hr/use-payroll';
import { usePermissionStore } from '@/stores/permission-store';
import { useAuthStore } from '@/stores/auth-store';
import { formatDate } from '@/lib/utils';
import type { PayrollPeriod } from '@/lib/validations/payroll';

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
  const [formData, setFormData] = useState<{
    name: string;
    period_type: 'monthly' | 'bi-weekly' | 'weekly';
    start_date: string;
    end_date: string;
  }>({
    name: '',
    period_type: 'monthly',
    start_date: '',
    end_date: '',
  });

  const { data, isLoading, isError } = usePayrollPeriods();
  const createMutation = useCreatePayrollPeriod();
  const deleteMutation = useDeletePayrollPeriod();

  const periods = data?.data ?? [];

  const handleCreate = () => {
    createMutation.mutate(formData, {
      onSuccess: () => {
        setShowCreate(false);
        setFormData({ name: '', period_type: 'monthly', start_date: '', end_date: '' });
      },
    });
  };

  if (!canRun) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Payroll Periods</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create and manage payroll periods
          </p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger render={<Button />}>
            <Plus data-icon="inline-start" />
            New Period
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Payroll Period</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData((d) => ({ ...d, name: e.target.value }))}
                  placeholder="e.g. March 2026"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="period_type">Period Type</Label>
                <Select
                  value={formData.period_type}
                  onValueChange={(v) => setFormData((d) => ({ ...d, period_type: v as 'monthly' | 'bi-weekly' | 'weekly' }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="bi-weekly">Bi-Weekly</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="start_date">Start Date</Label>
                  <Input
                    id="start_date"
                    type="date"
                    value={formData.start_date}
                    onChange={(e) => setFormData((d) => ({ ...d, start_date: e.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="end_date">End Date</Label>
                  <Input
                    id="end_date"
                    type="date"
                    value={formData.end_date}
                    onChange={(e) => setFormData((d) => ({ ...d, end_date: e.target.value }))}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              <Button onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="animate-spin" data-icon="inline-start" />}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isError ? (
        <Card><CardContent className="py-8"><p className="text-center text-muted-foreground">Failed to load payroll periods</p></CardContent></Card>
      ) : isLoading ? (
        <Card><CardContent className="p-4"><div className="flex flex-col gap-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div></CardContent></Card>
      ) : periods.length === 0 ? (
        <Card><CardContent className="py-12"><p className="text-center text-muted-foreground">No payroll periods yet. Create one to get started.</p></CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="hidden md:grid md:grid-cols-5 gap-4 px-4 py-2.5 text-xs font-medium text-muted-foreground border-b border-border">
              <span>Name</span>
              <span>Date Range</span>
              <span>Type</span>
              <span>Status</span>
              <span className="text-right">Actions</span>
            </div>
            {periods.map((period, idx) => (
              <div key={period.id}>
                {idx > 0 && <Separator />}
                <div className="grid grid-cols-2 gap-2 px-4 py-3 md:grid-cols-5 md:gap-4 md:items-center">
                  <div className="font-medium text-sm">
                    <Link href={`/hr/payroll/periods/${period.id}`} className="hover:underline text-foreground">
                      {period.name}
                    </Link>
                  </div>
                  <div className="text-xs text-muted-foreground md:text-sm">
                    {formatDate(period.start_date)} &mdash; {formatDate(period.end_date)}
                  </div>
                  <div className="text-sm capitalize">{period.period_type}</div>
                  <div>
                    <Badge variant={period.status === 'approved' || period.status === 'paid' ? 'default' : 'secondary'}>
                      {period.status}
                    </Badge>
                  </div>
                  <div className="flex justify-end col-span-2 md:col-span-1">
                    {period.status === 'draft' && (
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteTarget(period)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Delete Confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Payroll Period</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{deleteTarget?.name}&rdquo;? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteTarget) {
                  deleteMutation.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) });
                }
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="animate-spin" data-icon="inline-start" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
