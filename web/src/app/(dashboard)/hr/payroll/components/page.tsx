'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

import {
  usePayComponents,
  useCreatePayComponent,
  useDeletePayComponent,
} from '@/hooks/hr/use-pay-components';
import { usePermissionStore } from '@/stores/permission-store';
import { useAuthStore } from '@/stores/auth-store';
import type { PayComponent } from '@/lib/validations/payroll';

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

  const handleCreate = () => {
    createMutation.mutate(formData, {
      onSuccess: () => {
        setShowCreate(false);
        setFormData({ name: '', type: 'allowance', calculation_type: 'fixed', value: 0, is_taxable: false, is_mandatory: false, applies_to: 'all' });
      },
    });
  };

  if (!canManage) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Pay Components</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage allowances, deductions, bonuses, and tax rules
          </p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger render={<Button />}>
            <Plus data-icon="inline-start" />
            New Component
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Pay Component</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData((d) => ({ ...d, name: e.target.value }))}
                  placeholder="e.g. Housing Allowance"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Type</Label>
                  <Select value={formData.type} onValueChange={(v) => setFormData((d) => ({ ...d, type: v as PayComponent['type'] }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="allowance">Allowance</SelectItem>
                      <SelectItem value="deduction">Deduction</SelectItem>
                      <SelectItem value="bonus">Bonus</SelectItem>
                      <SelectItem value="tax">Tax</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Calculation</Label>
                  <Select value={formData.calculation_type} onValueChange={(v) => setFormData((d) => ({ ...d, calculation_type: v as 'fixed' | 'percentage' }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fixed">Fixed Amount</SelectItem>
                      <SelectItem value="percentage">Percentage</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="value">
                  {formData.calculation_type === 'percentage' ? 'Percentage (%)' : 'Amount'}
                </Label>
                <Input
                  id="value"
                  type="number"
                  min={0}
                  step={formData.calculation_type === 'percentage' ? 0.01 : 1}
                  value={formData.value}
                  onChange={(e) => setFormData((d) => ({ ...d, value: Number(e.target.value) }))}
                />
              </div>
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <Switch
                    id="is_taxable"
                    checked={formData.is_taxable}
                    onCheckedChange={(checked) => setFormData((d) => ({ ...d, is_taxable: checked }))}
                  />
                  <Label htmlFor="is_taxable">Taxable</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="is_mandatory"
                    checked={formData.is_mandatory}
                    onCheckedChange={(checked) => setFormData((d) => ({ ...d, is_mandatory: checked }))}
                  />
                  <Label htmlFor="is_mandatory">Mandatory</Label>
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
        <Card><CardContent className="py-8"><p className="text-center text-muted-foreground">Failed to load pay components</p></CardContent></Card>
      ) : isLoading ? (
        <Card><CardContent className="p-4"><div className="flex flex-col gap-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div></CardContent></Card>
      ) : components.length === 0 ? (
        <Card><CardContent className="py-12"><p className="text-center text-muted-foreground">No pay components yet.</p></CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="hidden md:grid md:grid-cols-6 gap-4 px-4 py-2.5 text-xs font-medium text-muted-foreground border-b border-border">
              <span>Name</span>
              <span>Type</span>
              <span>Calculation</span>
              <span className="text-right">Value</span>
              <span>Flags</span>
              <span className="text-right">Actions</span>
            </div>
            {components.map((c, idx) => (
              <div key={c.id}>
                {idx > 0 && <Separator />}
                <div className="grid grid-cols-2 gap-2 px-4 py-3 md:grid-cols-6 md:gap-4 md:items-center">
                  <div className="font-medium text-sm text-foreground">{c.name}</div>
                  <div className="text-sm capitalize">{c.type}</div>
                  <div className="text-sm capitalize">{c.calculation_type}</div>
                  <div className="text-sm tabular-nums text-right">
                    {c.calculation_type === 'percentage'
                      ? `${Number(c.value)}%`
                      : `$${Number(c.value).toLocaleString('en-AU', { minimumFractionDigits: 2 })}`}
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {c.is_taxable && <Badge variant="outline" className="text-[10px]">Taxable</Badge>}
                    {c.is_mandatory && <Badge variant="secondary" className="text-[10px]">Mandatory</Badge>}
                  </div>
                  <div className="flex justify-end col-span-2 md:col-span-1">
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteTarget(c)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Pay Component</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{deleteTarget?.name}&rdquo;?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) });
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
