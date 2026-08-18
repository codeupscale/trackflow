'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Trash2,
  Loader2,
  Puzzle,
  ArrowDownCircle,
  ArrowUpCircle,
  Receipt,
  Percent,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
  usePayComponents,
  useCreatePayComponent,
  useDeletePayComponent,
} from '@/hooks/hr/use-pay-components';
import { usePermissionStore } from '@/stores/permission-store';
import { useAuthStore } from '@/stores/auth-store';
import type { PayComponent } from '@/lib/validations/payroll';

const typeDot: Record<string, { dot: string; text: string; label: string }> = {
  allowance: { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', label: 'Allowance' },
  deduction: { dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400', label: 'Deduction' },
  bonus: { dot: 'bg-violet-500', text: 'text-violet-600 dark:text-violet-400', label: 'Bonus' },
  tax: { dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', label: 'Tax' },
};

export default function PayComponentsPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { hasPermission } = usePermissionStore();
  const canManage = hasPermission('payroll.manage_components');

  useEffect(() => {
    if (user && !canManage) {
      router.push('/hr/payroll/my-payslips');
    }
  }, [user, canManage, router]);

  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PayComponent | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    type: 'allowance' as 'allowance' | 'deduction' | 'bonus' | 'tax',
    calculation_type: 'fixed' as 'fixed' | 'percentage',
    value: 0,
    is_taxable: false,
    is_mandatory: false,
    applies_to: 'all' as 'all' | 'specific',
  });

  const { data, isLoading, isError } = usePayComponents();
  const createMutation = useCreatePayComponent();
  const deleteMutation = useDeletePayComponent();

  const components = data?.data ?? [];

  const stats = useMemo(() => {
    const total = components.length;
    const allowances = components.filter((c) => c.type === 'allowance').length;
    const deductions = components.filter((c) => c.type === 'deduction').length;
    const taxAndBonus = components.filter((c) => c.type === 'tax' || c.type === 'bonus').length;
    return { total, allowances, deductions, taxAndBonus };
  }, [components]);

  const handleCreate = () => {
    createMutation.mutate(formData, {
      onSuccess: () => {
        setShowCreate(false);
        setFormData({ name: '', type: 'allowance', calculation_type: 'fixed', value: 0, is_taxable: false, is_mandatory: false, applies_to: 'all' });
      },
    });
  };

  const resetForm = () => {
    setFormData({ name: '', type: 'allowance', calculation_type: 'fixed', value: 0, is_taxable: false, is_mandatory: false, applies_to: 'all' });
  };

  if (!canManage) return null;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Pay Components</h1>
          <p className="text-xs text-muted-foreground">
            Manage allowances, deductions, bonuses, and tax rules
          </p>
        </div>
        <Button size="sm" className="h-8 text-xs" onClick={() => { resetForm(); setShowCreate(true); }}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          New Component
        </Button>
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: stats.total, icon: Puzzle, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Allowances', value: stats.allowances, icon: ArrowUpCircle, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          { label: 'Deductions', value: stats.deductions, icon: ArrowDownCircle, color: 'text-red-500', bg: 'bg-red-500/10' },
          { label: 'Tax & Bonus', value: stats.taxAndBonus, icon: Receipt, color: 'text-amber-500', bg: 'bg-amber-500/10' },
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
              <Puzzle className="h-8 w-8 text-destructive/60" />
              <p className="text-sm text-muted-foreground font-medium">Failed to load pay components</p>
              <p className="text-xs text-muted-foreground">Please try again later.</p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center gap-4 px-4 py-2.5 border-b border-border/50">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-3 w-20" />
              ))}
            </div>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-3.5 w-16" />
                <Skeleton className="h-3.5 w-14" />
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-3.5 w-6" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : components.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center text-center gap-2">
              <Puzzle className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground font-medium">No pay components yet</p>
              <p className="text-xs text-muted-foreground">Create your first component to get started.</p>
              <Button size="sm" className="mt-2 h-7 text-xs" onClick={() => { resetForm(); setShowCreate(true); }}>
                <Plus className="h-3 w-3 mr-1" />
                New Component
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
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Name</th>
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Type</th>
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Calculation</th>
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">Value</th>
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">Flags</th>
                    <th className="text-[0.6rem] uppercase tracking-wider font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {components.map((c) => {
                    const td = typeDot[c.type] ?? typeDot.allowance;
                    return (
                      <tr key={c.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className="text-[0.75rem] font-medium text-foreground">{c.name}</span>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1.5 text-[0.7rem] font-medium ${td.text}`}>
                            <span className={`inline-block w-1.5 h-1.5 rounded-full ${td.dot}`} />
                            {td.label}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 text-[0.75rem] text-muted-foreground">
                            {c.calculation_type === 'percentage' && <Percent className="h-3 w-3 text-muted-foreground/60" />}
                            <span className="capitalize">{c.calculation_type === 'percentage' ? 'Percentage' : 'Fixed'}</span>
                          </span>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-right">
                          <span className="text-[0.75rem] font-medium text-foreground tabular-nums">
                            {c.calculation_type === 'percentage'
                              ? `${Number(c.value)}%`
                              : `$${Number(c.value).toLocaleString('en-AU', { minimumFractionDigits: 2 })}`}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-3">
                            {c.is_taxable && (
                              <span className="inline-flex items-center gap-1 text-[0.65rem] font-medium text-amber-600 dark:text-amber-400">
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
                                Taxable
                              </span>
                            )}
                            {c.is_mandatory && (
                              <span className="inline-flex items-center gap-1 text-[0.65rem] font-medium text-blue-600 dark:text-blue-400">
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500" />
                                Mandatory
                              </span>
                            )}
                            {!c.is_taxable && !c.is_mandatory && (
                              <span className="text-[0.65rem] text-muted-foreground/50">&mdash;</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(c)}
                            aria-label={`Delete ${c.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
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

      {/* Create Component Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                <Puzzle className="h-3.5 w-3.5 text-primary" />
              </div>
              New Pay Component
            </DialogTitle>
            <DialogDescription className="text-xs">
              Add an allowance, deduction, bonus, or tax component.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="name" className="text-xs">Name</Label>
              <Input
                id="name"
                className="h-9 text-sm"
                value={formData.name}
                onChange={(e) => setFormData((d) => ({ ...d, name: e.target.value }))}
                placeholder="e.g. Housing Allowance"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs">Type</Label>
                <Select value={formData.type} onValueChange={(v) => setFormData((d) => ({ ...d, type: v as PayComponent['type'] }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="allowance">Allowance</SelectItem>
                    <SelectItem value="deduction">Deduction</SelectItem>
                    <SelectItem value="bonus">Bonus</SelectItem>
                    <SelectItem value="tax">Tax</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Calculation</Label>
                <Select value={formData.calculation_type} onValueChange={(v) => setFormData((d) => ({ ...d, calculation_type: v as 'fixed' | 'percentage' }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">Fixed Amount</SelectItem>
                    <SelectItem value="percentage">Percentage</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="value" className="text-xs">
                {formData.calculation_type === 'percentage' ? 'Percentage (%)' : 'Amount'}
              </Label>
              <Input
                id="value"
                type="number"
                className="h-9 text-sm"
                min={0}
                step={formData.calculation_type === 'percentage' ? 0.01 : 1}
                value={formData.value}
                onChange={(e) => setFormData((d) => ({ ...d, value: Number(e.target.value) }))}
              />
            </div>

            <div className="rounded-lg border border-border/60 p-3">
              <span className="text-[0.65rem] font-medium text-muted-foreground uppercase tracking-wider">Options</span>
              <div className="flex items-center gap-6 mt-2.5">
                <div className="flex items-center gap-2">
                  <Switch
                    id="is_taxable"
                    checked={formData.is_taxable}
                    onCheckedChange={(checked) => setFormData((d) => ({ ...d, is_taxable: checked }))}
                  />
                  <Label htmlFor="is_taxable" className="text-xs">Taxable</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="is_mandatory"
                    checked={formData.is_mandatory}
                    onCheckedChange={(checked) => setFormData((d) => ({ ...d, is_mandatory: checked }))}
                  />
                  <Label htmlFor="is_mandatory" className="text-xs">Mandatory</Label>
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
              disabled={createMutation.isPending || !formData.name}
            >
              {createMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Create Component
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete Pay Component"
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
