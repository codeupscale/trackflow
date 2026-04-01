'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Pencil, Loader2, Settings } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';

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

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Leave Types</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure leave types for your organization
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus data-icon="inline-start" />
          Add Leave Type
        </Button>
      </div>

      {/* Leave Types List */}
      {isError ? (
        <Card>
          <CardContent className="py-8">
            <div className="text-center">
              <Settings className="mx-auto mb-2 text-muted-foreground" />
              <p className="text-muted-foreground font-medium">Failed to load leave types</p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : !leaveTypes || leaveTypes.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <Settings className="mx-auto mb-2 text-muted-foreground" />
              <p className="text-muted-foreground font-medium">No leave types configured</p>
              <p className="text-sm text-muted-foreground mt-1">
                Add your first leave type to get started.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            {/* Header row */}
            <div className="hidden md:grid md:grid-cols-7 gap-4 px-4 py-2.5 text-xs font-medium text-muted-foreground border-b border-border">
              <span>Name</span>
              <span>Code</span>
              <span>Type</span>
              <span className="text-center">Days/Year</span>
              <span>Accrual</span>
              <span className="text-center">Carryover</span>
              <span className="text-right">Actions</span>
            </div>

            {leaveTypes.map((lt, idx) => (
              <div key={lt.id}>
                {idx > 0 && <Separator />}
                <div className="grid grid-cols-2 gap-2 px-4 py-3 md:grid-cols-7 md:gap-4 md:items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{lt.name}</span>
                    {!lt.is_active && (
                      <Badge variant="outline" className="text-[10px]">
                        Inactive
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground md:text-sm">
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">{lt.code}</code>
                  </div>
                  <div>
                    <Badge variant={lt.type === 'paid' ? 'default' : 'secondary'}>
                      {lt.type}
                    </Badge>
                  </div>
                  <div className="text-sm text-foreground tabular-nums md:text-center">
                    {lt.days_per_year}
                  </div>
                  <div className="text-xs text-muted-foreground capitalize md:text-sm">
                    {lt.accrual_method}
                  </div>
                  <div className="text-sm text-foreground tabular-nums md:text-center">
                    {lt.max_carry_over}
                  </div>
                  <div className="flex justify-end col-span-2 md:col-span-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEdit(lt)}
                    >
                      <Pencil data-icon="inline-start" />
                      Edit
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Create/Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={(open) => { if (!open) closeSheet(); }}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{editingType ? 'Edit Leave Type' : 'New Leave Type'}</SheetTitle>
            <SheetDescription>
              {editingType
                ? 'Update the details for this leave type.'
                : 'Configure a new leave type for your organization.'}
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-6 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lt-name">Name</Label>
              <Input
                id="lt-name"
                placeholder="e.g., Annual Leave"
                {...form.register('name')}
                aria-invalid={!!form.formState.errors.name}
              />
              {form.formState.errors.name && (
                <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lt-code">Code</Label>
              <Input
                id="lt-code"
                placeholder="e.g., annual"
                {...form.register('code')}
                aria-invalid={!!form.formState.errors.code}
              />
              {form.formState.errors.code && (
                <p className="text-xs text-destructive">{form.formState.errors.code.message}</p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Type</Label>
              <Controller
                control={form.control}
                name="type"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
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
              <Label htmlFor="lt-days">Days Per Year</Label>
              <Input
                id="lt-days"
                type="number"
                min="0"
                max="365"
                {...form.register('days_per_year')}
                aria-invalid={!!form.formState.errors.days_per_year}
              />
              {form.formState.errors.days_per_year && (
                <p className="text-xs text-destructive">{form.formState.errors.days_per_year.message}</p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Accrual Method</Label>
              <Controller
                control={form.control}
                name="accrual_method"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select accrual method" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="annual">Annual (all at once)</SelectItem>
                        <SelectItem value="monthly">Monthly (accrue each month)</SelectItem>
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
              <Label htmlFor="lt-carryover">Max Carry Over (days)</Label>
              <Input
                id="lt-carryover"
                type="number"
                min="0"
                max="365"
                {...form.register('max_carry_over')}
                aria-invalid={!!form.formState.errors.max_carry_over}
              />
              {form.formState.errors.max_carry_over && (
                <p className="text-xs text-destructive">{form.formState.errors.max_carry_over.message}</p>
              )}
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <Label htmlFor="lt-active" className="text-sm">Active</Label>
                <p className="text-xs text-muted-foreground">
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

          <SheetFooter>
            <Button
              variant="outline"
              onClick={closeSheet}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isPending}
            >
              {isPending && <Loader2 className="animate-spin" data-icon="inline-start" />}
              {editingType ? 'Save Changes' : 'Create Type'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
