'use client';

import { useEffect, useState } from 'react';
import { Info, Loader2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSalaryStructures } from '@/hooks/hr/use-salary-structures';
import { useAssignSalary, type SalaryRosterRow } from '@/hooks/hr/use-salary-roster';

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function money(n: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
}

interface AssignSalaryDialogProps {
  employee: SalaryRosterRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Assign or change an employee's salary.
 *
 * Two fields are all that is required — structure and start date — because the
 * structure carries the base salary. The override is optional and collapsed
 * behind a toggle so the common case stays a two-click operation.
 */
export function AssignSalaryDialog({ employee, open, onOpenChange }: AssignSalaryDialogProps) {
  const { data: structuresData, isLoading: structuresLoading } = useSalaryStructures({ is_active: true });
  const assign = useAssignSalary();

  const structures = structuresData?.data ?? [];

  const [structureId, setStructureId] = useState<string>('');
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [useCustom, setUseCustom] = useState(false);
  const [customSalary, setCustomSalary] = useState('');

  // Reset per employee, pre-filling from the current assignment so "Change"
  // starts from what they are on rather than an empty form.
  useEffect(() => {
    if (!open) return;
    setStructureId(employee?.assignment?.structure.id ?? '');
    setEffectiveFrom(todayIso());
    const custom = employee?.assignment?.custom_base_salary;
    setUseCustom(custom != null);
    setCustomSalary(custom != null ? String(custom) : '');
  }, [open, employee]);

  const selected = structures.find((s) => s.id === structureId);
  const isChanging = Boolean(employee?.assignment);
  const canSubmit = Boolean(structureId && effectiveFrom) && !assign.isPending;

  const handleSubmit = () => {
    if (!employee || !structureId) return;
    assign.mutate(
      {
        employeeId: employee.id,
        salary_structure_id: structureId,
        custom_base_salary: useCustom && customSalary ? Number(customSalary) : null,
        effective_from: effectiveFrom,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">
            {isChanging ? 'Change salary' : 'Assign salary'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {employee?.name}
            {isChanging && ' — the current salary ends the day before the new one starts.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-3">
          <div className="grid gap-1.5">
            <Label className="text-xs">Salary structure</Label>
            <Select
              value={structureId || undefined}
              onValueChange={(v) => setStructureId(v ?? '')}
              disabled={structuresLoading}
            >
              <SelectTrigger className="h-9 text-sm" aria-label="Select salary structure">
                {selected ? (
                  <span className="truncate">
                    {selected.name}
                    <span className="ml-2 text-muted-foreground tabular-nums">{money(Number(selected.base_salary))}</span>
                  </span>
                ) : (
                  <SelectValue placeholder={structuresLoading ? 'Loading...' : 'Choose a structure'} />
                )}
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {structures.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="flex items-center justify-between gap-3 w-full">
                        <span>{s.name}</span>
                        <span className="text-muted-foreground tabular-nums text-xs">
                          {money(Number(s.base_salary))} / {s.type}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {!structuresLoading && structures.length === 0 && (
              <p className="text-[0.65rem] text-amber-600 dark:text-amber-400">
                No salary structures yet — create one first.
              </p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="effective-from" className="text-xs">Effective from</Label>
            <Input
              id="effective-from"
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              className="h-9 text-sm"
            />
          </div>

          {/* The override is the exception, so it stays out of the way until asked for. */}
          <div className="rounded-lg border border-border px-3 py-2.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={useCustom}
                onChange={(e) => setUseCustom(e.target.checked)}
                className="size-3.5 accent-primary"
              />
              <span className="text-xs font-medium">Override the base salary</span>
            </label>
            {useCustom ? (
              <Input
                type="number"
                min={0}
                value={customSalary}
                onChange={(e) => setCustomSalary(e.target.value)}
                placeholder={selected ? String(selected.base_salary) : '0'}
                className="h-9 text-sm mt-2"
                aria-label="Custom base salary"
              />
            ) : (
              <p className="text-[0.65rem] text-muted-foreground mt-1 inline-flex items-center gap-1.5">
                <Info className="h-3 w-3 shrink-0" />
                Uses the structure&apos;s base salary
                {selected && <span className="tabular-nums">({money(Number(selected.base_salary))})</span>}
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={assign.isPending}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!canSubmit}>
            {assign.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            {isChanging ? 'Change salary' : 'Assign salary'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
