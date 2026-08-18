'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Trash2,
  Loader2,
  Landmark,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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
  useSalaryStructures,
  useCreateSalaryStructure,
  useDeleteSalaryStructure,
} from '@/hooks/hr/use-salary-structures';
import { usePermissionStore } from '@/stores/permission-store';
import { useAuthStore } from '@/stores/auth-store';
import { formatDate } from '@/lib/utils';
import type { SalaryStructure } from '@/lib/validations/payroll';

export default function SalaryStructuresPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { hasPermission } = usePermissionStore();
  const canManage = hasPermission('payroll.manage_structures');

  useEffect(() => {
    if (user && !canManage) {
      router.push('/hr/payroll/my-payslips');
    }
  }, [user, canManage, router]);

  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SalaryStructure | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    type: 'monthly' as 'monthly' | 'hourly' | 'daily',
    base_salary: 0,
    currency: 'AUD',
    effective_from: '',
    is_active: true,
  });

  const { data, isLoading, isError } = useSalaryStructures();
  const createMutation = useCreateSalaryStructure();
  const deleteMutation = useDeleteSalaryStructure();

  const structures = data?.data ?? [];

  const stats = useMemo(() => {
    const total = structures.length;
    const active = structures.filter((s) => s.is_active).length;
    const inactive = total - active;
    const monthly = structures.filter((s) => s.type === 'monthly').length;
    return { total, active, inactive, monthly };
  }, [structures]);

  const handleCreate = () => {
    createMutation.mutate(formData, {
      onSuccess: () => {
        setShowCreate(false);
        setFormData({ name: '', type: 'monthly', base_salary: 0, currency: 'AUD', effective_from: '', is_active: true });
      },
    });
  };

  if (!canManage) return null;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Salary Structures</h1>
          <p className="text-xs text-muted-foreground">
            Define base salary structures for your organization
          </p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger render={<Button size="sm" className="h-8 text-xs" />}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            New Structure
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                  <Landmark className="h-3.5 w-3.5 text-primary" />
                </div>
                Create Salary Structure
              </DialogTitle>
              <DialogDescription className="text-xs">
                Add a new salary structure to your organization&apos;s payroll configuration.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name" className="text-xs">Name</Label>
                <Input
                  id="name"
                  className="h-9 text-sm"
                  value={formData.name}
                  onChange={(e) => setFormData((d) => ({ ...d, name: e.target.value }))}
                  placeholder="e.g. Senior Engineer"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="type" className="text-xs">Type</Label>
                  <Select
                    value={formData.type}
                    onValueChange={(v) => setFormData((d) => ({ ...d, type: v as 'monthly' | 'hourly' | 'daily' }))}
                  >
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="hourly">Hourly</SelectItem>
                      <SelectItem value="daily">Daily</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="base_salary" className="text-xs">Base Salary</Label>
                  <Input
                    id="base_salary"
                    className="h-9 text-sm"
                    type="number"
                    min={0}
                    step={0.01}
                    value={formData.base_salary}
                    onChange={(e) => setFormData((d) => ({ ...d, base_salary: Number(e.target.value) }))}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="effective_from" className="text-xs">Effective From</Label>
                <Input
                  id="effective_from"
                  className="h-9 text-sm"
                  type="date"
                  value={formData.effective_from}
                  onChange={(e) => setFormData((d) => ({ ...d, effective_from: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" className="h-8 text-xs" />}>Cancel</DialogClose>
              <Button className="h-8 text-xs" onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: stats.total, icon: Landmark, color: 'blue' },
          { label: 'Active', value: stats.active, icon: CheckCircle2, color: 'emerald' },
          { label: 'Inactive', value: stats.inactive, icon: XCircle, color: 'red' },
          { label: 'Monthly', value: stats.monthly, icon: Clock, color: 'violet' },
        ].map((s) => (
          <Card key={s.label} className="border-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-2.5">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-${s.color}-500/10 shrink-0`}>
                  <s.icon className={`h-4 w-4 text-${s.color}-500`} />
                </div>
                <div className="min-w-0">
                  <p className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">{s.label}</p>
                  <p className="text-base font-bold text-foreground tabular-nums leading-tight">{isLoading ? '--' : s.value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Content */}
      {isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-16">
            <div className="flex flex-col items-center text-center gap-3">
              <AlertTriangle className="h-10 w-10 text-destructive/60" />
              <p className="text-sm text-muted-foreground font-medium">Failed to load salary structures</p>
              <p className="text-xs text-muted-foreground">Please try again later.</p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-col">
              <div className="flex items-center gap-4 px-4 py-2.5 border-b border-border/50">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-3 w-20" />
                ))}
              </div>
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 px-4 py-3 border-b border-border/30 last:border-0"
                >
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3.5 w-16" />
                  <Skeleton className="h-3.5 w-20" />
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-5 w-12" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : structures.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center gap-2">
              <Landmark className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">No salary structures yet</p>
              <p className="text-xs text-muted-foreground">
                Create your first salary structure to start configuring payroll.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Name</th>
                    <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Type</th>
                    <th className="text-right text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Base Salary</th>
                    <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Effective</th>
                    <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Status</th>
                    <th className="text-right text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {structures.map((s) => (
                    <tr key={s.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="text-[0.75rem] font-medium text-foreground">{s.name}</span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="text-[0.75rem] text-muted-foreground capitalize">{s.type}</span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-right">
                        <span className="text-[0.75rem] text-foreground tabular-nums">
                          ${Number(s.base_salary).toLocaleString('en-AU', { minimumFractionDigits: 2 })}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="text-[0.75rem] text-muted-foreground">
                          {formatDate(s.effective_from)}
                          {s.effective_to && <> &mdash; {formatDate(s.effective_to)}</>}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {s.is_active ? (
                          <span className="inline-flex items-center gap-1.5 text-[0.7rem] font-medium text-emerald-600 dark:text-emerald-400">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[0.7rem] font-medium text-red-600 dark:text-red-400">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteTarget(s)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span className="sr-only">Delete {s.name}</span>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-destructive/10">
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </div>
              Delete Salary Structure
            </DialogTitle>
            <DialogDescription className="text-xs">
              Are you sure you want to delete &ldquo;{deleteTarget?.name}&rdquo;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" className="h-8 text-xs" />}>Cancel</DialogClose>
            <Button
              variant="destructive"
              className="h-8 text-xs"
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) });
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
