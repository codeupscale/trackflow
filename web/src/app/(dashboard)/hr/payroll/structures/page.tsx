'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Landmark,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Briefcase,
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
  useUpdateSalaryStructure,
  useDeleteSalaryStructure,
} from '@/hooks/hr/use-salary-structures';
import { usePermissionStore } from '@/stores/permission-store';
import { useAuthStore } from '@/stores/auth-store';
import { formatDate } from '@/lib/utils';
import { useMoney } from '@/lib/money';
import { PositionSelect } from '@/components/hr/PositionSelect';
import { formatBand } from '@/components/hr/SalaryBandIndicator';
import type { SalaryStructure } from '@/lib/validations/payroll';

export default function SalaryStructuresPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { hasPermission } = usePermissionStore();
  const canManage = hasPermission('payroll.manage_structures');
  const money = useMoney();

  useEffect(() => {
    if (user && !canManage) {
      router.push('/hr/payroll/my-payslips');
    }
  }, [user, canManage, router]);

  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SalaryStructure | null>(null);
  // The grade being edited. Null means the dialog is in create mode, so both
  // share one form rather than duplicating every field and its validation.
  const [editTarget, setEditTarget] = useState<SalaryStructure | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    type: 'monthly' as 'monthly' | 'hourly' | 'daily',
    // String, not 0: a numeric 0 renders a literal "0" the user must delete
    // before typing. Converted on submit.
    base_salary: '' as string,
    currency: 'AUD',
    effective_from: '',
    is_active: true,
    // A grade belongs to a position ("Engineer L1" under "Software Engineer").
    // Optional: grades can exist before positions are configured.
    position_id: null as string | null,
    // The approved band. Warns on breach, never blocks.
    min_salary: '' as string,
    max_salary: '' as string,
  });

  const { data, isLoading, isError } = useSalaryStructures();
  const createMutation = useCreateSalaryStructure();
  const updateMutation = useUpdateSalaryStructure();
  const deleteMutation = useDeleteSalaryStructure();

  const structures = data?.data ?? [];

  const stats = useMemo(() => {
    const total = structures.length;
    const active = structures.filter((s) => s.is_active).length;
    const inactive = total - active;
    const monthly = structures.filter((s) => s.type === 'monthly').length;
    return { total, active, inactive, monthly };
  }, [structures]);

  /**
   * Duplicate grade name, caught while typing.
   *
   * Scoped to the POSITION, mirroring the server rule: "L1" under two different
   * jobs is two different grades, so only a clash within the same position (or
   * among unlinked grades) is a duplicate. Case-insensitive, to match.
   */
  const nameError = useMemo(() => {
    const name = formData.name.trim().toLowerCase();
    if (!name) return null;

    const clash = structures.some(
      (s) =>
        // The grade being edited must not clash with itself.
        s.id !== editTarget?.id &&
        s.name.trim().toLowerCase() === name &&
        (s.position_id ?? null) === (formData.position_id ?? null),
    );
    if (!clash) return null;

    return formData.position_id
      ? 'A grade with this name already exists for this position.'
      : 'A grade with this name already exists. Link it to a position, or choose another name.';
  }, [formData.name, formData.position_id, structures, editTarget]);

  /**
   * Range problems, surfaced INLINE while typing.
   *
   * Previously only caught by the API and shown as a toast in the corner after
   * submitting — far from the fields, and phrased in API terms ("max_salary
   * must be >= 800000") rather than saying the obvious thing: the two values
   * are the wrong way round.
   */
  const rangeError = useMemo(() => {
    const min = formData.min_salary === '' ? null : Number(formData.min_salary);
    const max = formData.max_salary === '' ? null : Number(formData.max_salary);
    if (min == null || max == null) return null;
    if (min > max) return 'Range from is higher than Range to — they look swapped.';
    return null;
  }, [formData.min_salary, formData.max_salary]);

  /**
   * A grade whose base pay sits outside its OWN band is incoherent — every
   * assignment on it would warn immediately. Nothing checked this before.
   */
  const baseWarning = useMemo(() => {
    const min = formData.min_salary === '' ? null : Number(formData.min_salary);
    const max = formData.max_salary === '' ? null : Number(formData.max_salary);
    const base = Number(formData.base_salary);
    if (!base || (min == null && max == null) || rangeError) return null;
    if (min != null && base < min) return 'Base salary is below this range.';
    if (max != null && base > max) return 'Base salary is above this range.';
    return null;
  }, [formData.base_salary, formData.min_salary, formData.max_salary, rangeError]);

  const emptyForm = {
    name: '', type: 'monthly' as const, base_salary: '', currency: 'AUD',
    effective_from: '', is_active: true, position_id: null as string | null,
    min_salary: '', max_salary: '',
  };

  const openCreate = () => {
    setEditTarget(null);
    setFormData(emptyForm);
    setShowCreate(true);
  };

  const openEdit = (s: SalaryStructure) => {
    setEditTarget(s);
    setFormData({
      name: s.name,
      type: s.type,
      base_salary: String(s.base_salary ?? ''),
      currency: s.currency ?? 'AUD',
      effective_from: s.effective_from?.slice(0, 10) ?? '',
      is_active: s.is_active,
      position_id: s.position_id ?? null,
      // Numeric nulls become '' so the inputs render empty rather than "null".
      min_salary: s.min_salary != null ? String(s.min_salary) : '',
      max_salary: s.max_salary != null ? String(s.max_salary) : '',
    });
    setShowCreate(true);
  };

  const handleSave = () => {
    if (rangeError || nameError) return;

    const payload = {
      ...formData,
      base_salary: Number(formData.base_salary),
      min_salary: formData.min_salary === '' ? null : Number(formData.min_salary),
      max_salary: formData.max_salary === '' ? null : Number(formData.max_salary),
    };

    const done = () => {
      setShowCreate(false);
      setEditTarget(null);
      setFormData(emptyForm);
    };

    if (editTarget) {
      updateMutation.mutate({ id: editTarget.id, data: payload }, { onSuccess: done });
      return;
    }
    createMutation.mutate(payload, { onSuccess: done });
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
        {/* Controlled rather than trigger-driven: the same dialog opens for
            create and edit, and edit is launched from a row. */}
        <Button size="sm" className="h-8 text-xs" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          New Structure
        </Button>
        <Dialog
          open={showCreate}
          onOpenChange={(open) => {
            setShowCreate(open);
            if (!open) setEditTarget(null);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                  <Landmark className="h-3.5 w-3.5 text-primary" />
                </div>
                {editTarget ? 'Edit Salary Grade' : 'Create Salary Structure'}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {editTarget
                  ? 'Update this grade. Existing salary assignments keep pointing at it.'
                  : 'Add a new salary structure to your organization&apos;s payroll configuration.'}
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
                  aria-invalid={!!nameError}
                />
                {/* Beside the field while typing, not a toast after submit. */}
                {nameError && (
                  <p className="text-[0.7rem] text-destructive inline-flex items-start gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                    {nameError}
                  </p>
                )}
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
                    placeholder="e.g. 150000"
                    value={formData.base_salary}
                    onChange={(e) => setFormData((d) => ({ ...d, base_salary: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label className="text-xs">Position</Label>
                <PositionSelect
                  value={formData.position_id}
                  onChange={(v) => setFormData((d) => ({ ...d, position_id: v }))}
                  placeholder="Not linked to a position"
                />
                <p className="text-[0.65rem] text-muted-foreground">
                  Linking lets this grade be offered automatically when assigning salaries for that role.
                </p>
              </div>

              {/* The approved band. Both optional — a grade with no band simply
                  has no range check, which is normal during setup. */}
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="min_salary" className="text-xs">Range from <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input
                    id="min_salary"
                    className="h-9 text-sm"
                    type="number"
                    min={0}
                    placeholder="Optional"
                    value={formData.min_salary}
                    onChange={(e) => setFormData((d) => ({ ...d, min_salary: e.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="max_salary" className="text-xs">Range to <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input
                    id="max_salary"
                    className="h-9 text-sm"
                    type="number"
                    min={0}
                    placeholder="Optional"
                    value={formData.max_salary}
                    onChange={(e) => setFormData((d) => ({ ...d, max_salary: e.target.value }))}
                    aria-invalid={!!rangeError}
                  />
                </div>
              </div>

              {/* One line explaining how the three amounts relate. Without it,
                  "base" vs "range" reads as two names for the same thing. */}
              {!rangeError && !baseWarning && (
                <p className="-mt-1 text-[0.65rem] text-muted-foreground leading-relaxed">
                  <span className="text-foreground">Base salary</span> is what someone on this grade is
                  paid by default. The <span className="text-foreground">range</span> is the approved
                  minimum and maximum — pay outside it is flagged for review, never blocked. Leave the
                  range empty if this grade has no approved band.
                </p>
              )}

              {/* Inline, beside the fields, while typing — not a toast in the
                  corner after submitting. */}
              {rangeError && (
                <div className="flex items-start justify-between gap-3 -mt-1 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
                  <p className="text-[0.7rem] text-destructive inline-flex items-start gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                    {rangeError}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 text-[0.65rem] shrink-0"
                    onClick={() =>
                      setFormData((d) => ({ ...d, min_salary: d.max_salary, max_salary: d.min_salary }))
                    }
                  >
                    Swap them
                  </Button>
                </div>
              )}

              {baseWarning && (
                <p className="-mt-1 text-[0.7rem] text-amber-600 dark:text-amber-400 inline-flex items-start gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                  {baseWarning} Every salary on this grade would be flagged out of range.
                </p>
              )}

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
              <Button
                className="h-8 text-xs"
                onClick={handleSave}
                disabled={createMutation.isPending || updateMutation.isPending || !!rangeError || !!nameError}
              >
                {(createMutation.isPending || updateMutation.isPending) && (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                )}
                {editTarget ? 'Save Changes' : 'Create'}
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
                    <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Grade</th>
                    <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Position</th>
                    <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Type</th>
                    <th className="text-right text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Base Salary</th>
                    <th className="text-right text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Approved Range</th>
                    <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Effective</th>
                    <th className="text-left text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Status</th>
                    {/* Centred over the icon pair, and visible rather than
                        screen-reader-only — a column of icons with no header
                        reads as unexplained. */}
                    <th className="text-center text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap w-[90px]">
                      Actions
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
                        {s.position ? (
                          <span className="inline-flex items-center gap-1.5 text-[0.75rem] text-foreground">
                            <Briefcase className="h-3 w-3 text-muted-foreground shrink-0" />
                            {s.position.title}
                          </span>
                        ) : (
                          // Not an error: unlinked grades are normal mid-setup.
                          <span className="text-[0.65rem] text-muted-foreground">Not linked</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="text-[0.75rem] text-muted-foreground capitalize">{s.type}</span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-right">
                        <span className="text-[0.75rem] text-foreground tabular-nums">
                          {money(s.base_salary)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-right">
                        {formatBand(s) ? (
                          <span className="text-[0.75rem] text-muted-foreground tabular-nums">{formatBand(s)}</span>
                        ) : (
                          <span className="text-[0.65rem] text-muted-foreground/60">No range</span>
                        )}
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
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                            onClick={() => openEdit(s)}
                            aria-label={`Edit ${s.name}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => setDeleteTarget(s)}
                            aria-label={`Delete ${s.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
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
