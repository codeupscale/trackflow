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
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Salary Structures</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Define base salary structures for your organization
          </p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger render={<Button />}>
            <Plus data-icon="inline-start" />
            New Structure
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Salary Structure</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData((d) => ({ ...d, name: e.target.value }))}
                  placeholder="e.g. Senior Engineer"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="type">Type</Label>
                  <Select
                    value={formData.type}
                    onValueChange={(v) => setFormData((d) => ({ ...d, type: v as 'monthly' | 'hourly' | 'daily' }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="hourly">Hourly</SelectItem>
                      <SelectItem value="daily">Daily</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="base_salary">Base Salary</Label>
                  <Input
                    id="base_salary"
                    type="number"
                    min={0}
                    step={0.01}
                    value={formData.base_salary}
                    onChange={(e) => setFormData((d) => ({ ...d, base_salary: Number(e.target.value) }))}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="effective_from">Effective From</Label>
                <Input
                  id="effective_from"
                  type="date"
                  value={formData.effective_from}
                  onChange={(e) => setFormData((d) => ({ ...d, effective_from: e.target.value }))}
                />
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
        <Card><CardContent className="py-8"><p className="text-center text-muted-foreground">Failed to load salary structures</p></CardContent></Card>
      ) : isLoading ? (
        <Card><CardContent className="p-4"><div className="flex flex-col gap-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div></CardContent></Card>
      ) : structures.length === 0 ? (
        <Card><CardContent className="py-12"><p className="text-center text-muted-foreground">No salary structures yet.</p></CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="hidden md:grid md:grid-cols-5 gap-4 px-4 py-2.5 text-xs font-medium text-muted-foreground border-b border-border">
              <span>Name</span>
              <span>Type</span>
              <span className="text-right">Base Salary</span>
              <span>Effective</span>
              <span className="text-right">Actions</span>
            </div>
            {structures.map((s, idx) => (
              <div key={s.id}>
                {idx > 0 && <Separator />}
                <div className="grid grid-cols-2 gap-2 px-4 py-3 md:grid-cols-5 md:gap-4 md:items-center">
                  <div className="font-medium text-sm text-foreground">
                    {s.name}
                    {!s.is_active && <Badge variant="secondary" className="ml-2 text-[10px]">Inactive</Badge>}
                  </div>
                  <div className="text-sm capitalize">{s.type}</div>
                  <div className="text-sm tabular-nums text-right">
                    ${Number(s.base_salary).toLocaleString('en-AU', { minimumFractionDigits: 2 })}
                  </div>
                  <div className="text-xs text-muted-foreground md:text-sm">
                    {formatDate(s.effective_from)}
                    {s.effective_to && <> &mdash; {formatDate(s.effective_to)}</>}
                  </div>
                  <div className="flex justify-end col-span-2 md:col-span-1">
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteTarget(s)}>
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
            <DialogTitle>Delete Salary Structure</DialogTitle>
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
