'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Pencil, Loader2, Settings, CheckCircle2, XCircle, DollarSign } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useCodeFromName, slugCode } from '@/hooks/use-code-from-name';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectGroup,
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

import { useLeaveTypes } from '@/hooks/hr/use-leave-types';
import { usePermissionStore } from '@/stores/permission-store';
import api from '@/lib/api';
import {
  leaveTypeFormSchema,
  type LeaveTypeFormData,
  type LeaveType,
} from '@/lib/validations/leave';

export default function LeaveTypesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingType, setEditingType] = useState<LeaveType | null>(null);

  const { hasPermission } = usePermissionStore();
  const isAdmin = hasPermission('leave.manage_types');

  const { data: leaveTypes, isLoading, isError } = useLeaveTypes();

  const form = useForm<LeaveTypeFormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- z.coerce input type is `unknown`, resolver output is correct
    resolver: zodResolver(leaveTypeFormSchema) as any,
    defaultValues: {
      name: '',
      code: '',
      type: 'paid',
      days_per_year: 0,
      accrual_method: 'annual',
      max_carry_over: 0,
      is_active: true,
    },
  });

  // Same slug rule as the Leave Types tab in hr/leave/management. Kept in sync
  // deliberately: this page duplicates that form and is still reachable by
  // direct URL even though nothing links to it.
  useCodeFromName({
    form,
    sourceField: 'name',
    codeField: 'code',
    generate: slugCode,
    enabled: !editingType,
  });

  const createMutation = useMutation({
    mutationFn: (data: LeaveTypeFormData) => api.post('/hr/leave-types', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-types'] });
      queryClient.invalidateQueries({ queryKey: ['leave-balance'] });
      toast.success('Leave type created');
      closeSheet();
    },
    onError: (error: unknown) => {
      toast.error(
        (error as { data?: { message?: string } })?.data?.message ?? 'Failed to create leave type'
      );
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: LeaveTypeFormData & { id: string }) =>
      api.put(`/hr/leave-types/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-types'] });
      queryClient.invalidateQueries({ queryKey: ['leave-balance'] });
      toast.success('Leave type updated');
      closeSheet();
    },
    onError: (error: unknown) => {
      toast.error(
        (error as { data?: { message?: string } })?.data?.message ?? 'Failed to update leave type'
      );
    },
  });

  // Role gate
  if (!isAdmin) {
    router.push('/hr/leave');
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="size-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
          Redirecting...
        </div>
      </div>
    );
  }

  const openCreate = () => {
    setEditingType(null);
    form.reset({
      name: '',
      code: '',
      type: 'paid',
      days_per_year: 0,
      accrual_method: 'annual',
      max_carry_over: 0,
      is_active: true,
    });
    setSheetOpen(true);
  };

  const openEdit = (leaveType: LeaveType) => {
    setEditingType(leaveType);
    form.reset({
      name: leaveType.name,
      code: leaveType.code,
      type: leaveType.type,
      days_per_year: leaveType.days_per_year,
      accrual_method: leaveType.accrual_method,
      max_carry_over: leaveType.max_carry_over,
      is_active: leaveType.is_active,
    });
    setSheetOpen(true);
  };

  const closeSheet = () => {
    setSheetOpen(false);
    setEditingType(null);
    form.reset();
  };

  const handleSubmit = form.handleSubmit((data: LeaveTypeFormData) => {
    if (editingType) {
      updateMutation.mutate({ ...data, id: editingType.id });
    } else {
      createMutation.mutate(data);
    }
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const stats = useMemo(() => {
    if (!leaveTypes) return { total: 0, active: 0, inactive: 0, paid: 0 };
    const total = leaveTypes.length;
    const active = leaveTypes.filter((lt) => lt.is_active).length;
    const inactive = total - active;
    const paid = leaveTypes.filter((lt) => lt.type === 'paid').length;
    return { total, active, inactive, paid };
  }, [leaveTypes]);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Leave Types</h1>
          <p className="text-xs text-muted-foreground">
            Configure leave types for your organization
          </p>
        </div>
        <Button size="sm" className="h-8 text-xs" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Leave Type
        </Button>
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Types', value: stats.total, icon: Settings, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Active', value: stats.active, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          { label: 'Inactive', value: stats.inactive, icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10' },
          { label: 'Paid', value: stats.paid, icon: DollarSign, color: 'text-violet-500', bg: 'bg-violet-500/10' },
        ].map((s) => (
          <Card key={s.label} className="border-border">
            <CardContent className="p-3">
              <div className="flex items-center gap-2.5">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${s.bg} shrink-0`}>
                  <s.icon className={`h-4 w-4 ${s.color}`} />
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

      {/* Leave Types Table */}
      {isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center gap-2">
              <Settings className="size-8 text-destructive/60" />
              <p className="text-sm text-muted-foreground font-medium">Failed to load leave types</p>
              <p className="text-xs text-muted-foreground">Please try again later.</p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-col">
              <div className="flex items-center gap-4 px-4 py-2.5 border-b border-border/50">
                {Array.from({ length: 7 }).map((_, i) => (
                  <Skeleton key={i} className="h-3 w-16" />
                ))}
              </div>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3.5 w-14" />
                  <Skeleton className="h-3.5 w-12" />
                  <Skeleton className="h-3.5 w-8" />
                  <Skeleton className="h-3.5 w-16" />
                  <Skeleton className="h-3.5 w-8" />
                  <Skeleton className="h-3.5 w-10 ml-auto" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : !leaveTypes || leaveTypes.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center gap-2">
              <Settings className="size-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">No leave types configured</p>
              <p className="text-xs text-muted-foreground">
                Add your first leave type to get started.
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
                    <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">Name</th>
                    <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">Code</th>
                    <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">Type</th>
                    <th className="text-center text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">Days/Year</th>
                    <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">Accrual</th>
                    <th className="text-center text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">Carryover</th>
                    <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">Status</th>
                    <th className="text-right text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {leaveTypes.map((lt) => (
                    <tr key={lt.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5 text-[0.75rem] font-medium text-foreground">
                        {lt.name}
                      </td>
                      <td className="px-4 py-2.5">
                        <code className="rounded bg-muted px-1.5 py-0.5 text-[0.65rem] font-mono text-muted-foreground">{lt.code}</code>
                      </td>
                      <td className="px-4 py-2.5">
                        {lt.type === 'paid' ? (
                          <span className="inline-flex items-center gap-1.5 text-[0.7rem] font-medium text-emerald-600 dark:text-emerald-400">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Paid
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[0.7rem] font-medium text-amber-600 dark:text-amber-400">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
                            Unpaid
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-[0.75rem] text-foreground tabular-nums text-center">
                        {lt.days_per_year}
                      </td>
                      <td className="px-4 py-2.5 text-[0.75rem] text-muted-foreground capitalize">
                        {lt.accrual_method}
                      </td>
                      <td className="px-4 py-2.5 text-[0.75rem] text-foreground tabular-nums text-center">
                        {lt.max_carry_over}
                      </td>
                      <td className="px-4 py-2.5">
                        {lt.is_active ? (
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
                      <td className="px-4 py-2.5 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={() => openEdit(lt)}
                        >
                          <Pencil className="h-3 w-3" />
                          Edit
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

      {/* Create/Edit Dialog */}
      <Dialog open={sheetOpen} onOpenChange={(open) => { if (!open) closeSheet(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                <Settings className="h-3.5 w-3.5 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-base">{editingType ? 'Edit Leave Type' : 'New Leave Type'}</DialogTitle>
                <DialogDescription className="text-xs">
                  {editingType
                    ? 'Update the details for this leave type.'
                    : 'Configure a new leave type for your organization.'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto py-1 pr-1">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lt-name" className="text-xs">Name</Label>
              <Input
                id="lt-name"
                placeholder="e.g., Annual Leave"
                {...form.register('name')}
                aria-invalid={!!form.formState.errors.name}
                className="h-9 text-sm"
              />
              {form.formState.errors.name && (
                <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lt-code" className="text-xs">Code</Label>
              <Input
                id="lt-code"
                placeholder="e.g., annual"
                {...form.register('code')}
                aria-invalid={!!form.formState.errors.code}
                className="h-9 text-sm"
              />
              {form.formState.errors.code && (
                <p className="text-xs text-destructive">{form.formState.errors.code.message}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Type</Label>
                <Controller
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="h-9 text-sm w-full">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="paid">Paid</SelectItem>
                          <SelectItem value="unpaid">Unpaid</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                />
                {form.formState.errors.type && (
                  <p className="text-xs text-destructive">{form.formState.errors.type.message}</p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lt-days" className="text-xs">Days/Year</Label>
                <Input
                  id="lt-days"
                  type="number"
                  min="0"
                  max="365"
                  {...form.register('days_per_year')}
                  aria-invalid={!!form.formState.errors.days_per_year}
                  className="h-9 text-sm"
                />
                {form.formState.errors.days_per_year && (
                  <p className="text-xs text-destructive">{form.formState.errors.days_per_year.message}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Accrual Method</Label>
                <Controller
                  control={form.control}
                  name="accrual_method"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="h-9 text-sm w-full">
                        <SelectValue placeholder="Accrual method" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="annual">Annual</SelectItem>
                          <SelectItem value="monthly">Monthly</SelectItem>
                          <SelectItem value="none">None</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                />
                {form.formState.errors.accrual_method && (
                  <p className="text-xs text-destructive">{form.formState.errors.accrual_method.message}</p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lt-carryover" className="text-xs">Max Carryover</Label>
                <Input
                  id="lt-carryover"
                  type="number"
                  min="0"
                  max="365"
                  {...form.register('max_carry_over')}
                  aria-invalid={!!form.formState.errors.max_carry_over}
                  className="h-9 text-sm"
                />
                {form.formState.errors.max_carry_over && (
                  <p className="text-xs text-destructive">{form.formState.errors.max_carry_over.message}</p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <Label htmlFor="lt-active" className="text-xs">Active</Label>
                <p className="text-[0.65rem] text-muted-foreground">
                  Inactive types cannot be used for new requests
                </p>
              </div>
              <Controller
                control={form.control}
                name="is_active"
                render={({ field }) => (
                  <Switch
                    id="lt-active"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
            </div>
          </form>

          <DialogFooter>
            <Button
              variant="outline"
              className="h-8 text-xs"
              onClick={closeSheet}
            >
              Cancel
            </Button>
            <Button
              className="h-8 text-xs"
              onClick={handleSubmit}
              disabled={isPending}
            >
              {isPending && <Loader2 className="animate-spin h-3.5 w-3.5 mr-1" />}
              {editingType ? 'Save Changes' : 'Create Type'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
