'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRightLeft, Briefcase, Info, Loader2 } from 'lucide-react';

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
import { SalaryBandIndicator, formatBand } from '@/components/hr/SalaryBandIndicator';
import { useSalaryStructures } from '@/hooks/hr/use-salary-structures';
import { useAssignSalary, type SalaryRosterRow } from '@/hooks/hr/use-salary-roster';
import { cn } from '@/lib/utils';
import { formatMoney, useCurrency } from '@/lib/money';
import { bandStatus, type SalaryStructure } from '@/lib/validations/payroll';

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function money(n: number, currency: string) {
  return formatMoney(n, currency, { symbol: false, compact: true });
}

interface AssignSalaryDialogProps {
  employee: SalaryRosterRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Assign or change an employee's salary grade.
 *
 * Grades are offered by POSITION, but never at the cost of blocking work.
 * Organizations migrate employees long before they finish configuring
 * positions and grades, so every incomplete state degrades to something
 * usable:
 *
 *   position has grades  → offer those, pre-select, show the band
 *   position, no grades  → offer all, explain why
 *   employee has no position → offer all, SILENTLY (nothing actionable here)
 *   grade from another position → confirm at save
 *
 * That third case matters: warning about a position mismatch when there is no
 * position is noise about a problem this dialog cannot fix, and noise is how
 * warnings stop being read.
 */
export function AssignSalaryDialog({ employee, open, onOpenChange }: AssignSalaryDialogProps) {
  const currency = useCurrency();
  const { data: structuresData, isLoading: structuresLoading } = useSalaryStructures({ is_active: true });
  const assign = useAssignSalary();

  const allGrades = useMemo(() => structuresData?.data ?? [], [structuresData]);

  const [structureId, setStructureId] = useState<string>('');
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [useCustom, setUseCustom] = useState(false);
  const [customSalary, setCustomSalary] = useState('');
  const [showAllGrades, setShowAllGrades] = useState(false);
  const [confirmMismatch, setConfirmMismatch] = useState(false);

  const position = employee?.position ?? null;

  const positionGrades = useMemo(
    () => (position ? allGrades.filter((g) => g.position_id === position.id) : []),
    [allGrades, position],
  );

  const hasPositionGrades = positionGrades.length > 0;
  // Show the position's grades when they exist and the user has not opted out.
  const offered = hasPositionGrades && !showAllGrades ? positionGrades : allGrades;

  useEffect(() => {
    if (!open) return;
    const current = employee?.assignment?.structure.id ?? '';
    setStructureId(current);
    setEffectiveFrom(todayIso());
    const custom = employee?.assignment?.custom_base_salary;
    setUseCustom(custom != null);
    setCustomSalary(custom != null ? String(custom) : '');
    setShowAllGrades(false);
    setConfirmMismatch(false);
  }, [open, employee]);

  const selected = allGrades.find((g) => g.id === structureId) as SalaryStructure | undefined;

  // The amount actually being assigned — the override when set, else the
  // grade's base. This is what the band is judged against.
  const effectiveAmount = useCustom && customSalary
    ? Number(customSalary)
    : selected
      ? Number(selected.base_salary)
      : null;

  // Only a real mismatch: a grade belonging to a DIFFERENT position, while this
  // position does have grades of its own. Firing when the position has none
  // would mean warning on every single assignment.
  const isMismatch = Boolean(
    position && hasPositionGrades && selected && selected.position_id !== position.id,
  );

  /**
   * A grade whose band actually contains this amount.
   *
   * An override that lands OUTSIDE the band usually means the wrong grade was
   * picked, not that the pay is exceptional — a grade is a range, and overrides
   * exist to position someone WITHIN it. When a sibling grade fits, offering to
   * switch turns an unfixable warning into a one-click correction, which is the
   * difference between a warning that gets acted on and one that gets ignored.
   *
   * Searched among the same position's grades only: suggesting a grade from
   * another job would fix the number and break the hierarchy.
   */
  const suggestedGrade = useMemo(() => {
    if (!selected || effectiveAmount == null) return null;
    if (bandStatus(effectiveAmount, selected) !== 'above' &&
        bandStatus(effectiveAmount, selected) !== 'below') return null;

    const pool = selected.position_id
      ? allGrades.filter((g) => g.position_id === selected.position_id)
      : positionGrades;

    return (
      pool.find(
        (g) => g.id !== selected.id && bandStatus(effectiveAmount, g) === 'in_band',
      ) ?? null
    );
  }, [selected, effectiveAmount, allGrades, positionGrades]);

  const isChanging = Boolean(employee?.assignment);
  const canSubmit = Boolean(structureId && effectiveFrom) && !assign.isPending;

  const submit = () => {
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

  const handleSubmit = () => {
    if (isMismatch && !confirmMismatch) {
      setConfirmMismatch(true);
      return;
    }
    submit();
  };

  // ── Mismatch confirmation ──────────────────────────────────────────────
  if (confirmMismatch && employee && selected) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Grade not linked to this position
            </DialogTitle>
            <DialogDescription className="text-xs">
              This can cause confusion later when reviewing pay by role.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/5 px-3.5 py-3 my-2">
            <p className="text-xs text-foreground">
              <span className="font-medium">{employee.name}</span> is a{' '}
              <span className="font-medium">{position?.title}</span>, but{' '}
              <span className="font-medium">{selected.name}</span> belongs to{' '}
              <span className="font-medium">{selected.position?.title ?? 'no position'}</span>.
            </p>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmMismatch(false)}>
              <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
              Go back
            </Button>
            <Button size="sm" onClick={submit} disabled={assign.isPending}>
              {assign.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Assign anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

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
          {/* Position is READ from the employee, never re-picked here: it lives
              on their profile, and asking twice lets the two disagree. */}
          <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
            <Briefcase className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            {position ? (
              <span className="text-xs text-foreground">{position.title}</span>
            ) : (
              <span className="text-xs text-muted-foreground">No position set on this employee</span>
            )}
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Salary grade</Label>
              {hasPositionGrades && (
                <button
                  type="button"
                  onClick={() => setShowAllGrades((v) => !v)}
                  className="text-[0.65rem] text-muted-foreground hover:text-foreground underline underline-offset-2"
                >
                  {showAllGrades ? `Show ${position?.title} grades` : 'Show all grades'}
                </button>
              )}
            </div>

            <Select
              value={structureId || undefined}
              onValueChange={(v) => setStructureId(v ?? '')}
              disabled={structuresLoading}
            >
              <SelectTrigger className="h-9 text-sm" aria-label="Select salary grade">
                {selected ? (
                  <span className="flex items-center justify-between gap-2 w-full truncate">
                    <span className="truncate">{selected.name}</span>
                    <span className="text-muted-foreground tabular-nums text-xs shrink-0">
                      {money(Number(selected.base_salary), currency)}
                    </span>
                  </span>
                ) : (
                  <SelectValue placeholder={structuresLoading ? 'Loading...' : 'Choose a grade'} />
                )}
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {offered.map((g) => {
                    const band = formatBand(g);
                    return (
                      <SelectItem key={g.id} value={g.id}>
                        <span className="flex flex-col gap-0.5 py-0.5">
                          <span className="flex items-center gap-2">
                            <span className="font-medium">{g.name}</span>
                            <span className="text-muted-foreground tabular-nums text-xs">
                              {money(Number(g.base_salary), currency)}
                            </span>
                          </span>
                          <span className="text-[0.6rem] text-muted-foreground">
                            {band ? `Band ${band}` : 'No band set'}
                            {showAllGrades && g.position?.title ? ` · ${g.position.title}` : ''}
                          </span>
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectGroup>
              </SelectContent>
            </Select>

            {/* Case 2: the employee HAS a position but it has no grades yet.
                Explain, rather than showing an empty dropdown. Case 3 (no
                position at all) is deliberately silent — the fix is on the
                profile, not here. */}
            {position && !hasPositionGrades && !structuresLoading && (
              <p className="text-[0.7rem] text-amber-600 dark:text-amber-400 inline-flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                <span>
                  No grades configured for {position.title} — showing all grades.
                </span>
              </p>
            )}

            {!structuresLoading && allGrades.length === 0 && (
              <p className="text-[0.7rem] text-amber-600 dark:text-amber-400">
                No salary grades exist yet — create one first.
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

          {/* The override is the exception, so it stays collapsed until asked for. */}
          <div className={cn(
            'rounded-lg border px-3 py-2.5 transition-colors',
            useCustom ? 'border-border' : 'border-border/60',
          )}>
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
                Uses the grade&apos;s base salary
                {selected && <span className="tabular-nums">({money(Number(selected.base_salary), currency)})</span>}
              </p>
            )}
          </div>

          {/* Live band feedback on whatever amount is actually being assigned. */}
          {selected && (
            <div className="flex flex-col gap-2">
              <SalaryBandIndicator amount={effectiveAmount} grade={selected} />

              {/* The fix, not just the complaint: when a sibling grade's band
                  contains this amount, offer to switch to it in one click. */}
              {suggestedGrade && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2">
                  <p className="text-[0.7rem] text-foreground min-w-0">
                    <span className="font-medium">{suggestedGrade.name}</span>{' '}
                    <span className="text-muted-foreground tabular-nums">
                      ({formatBand(suggestedGrade)})
                    </span>{' '}
                    fits this amount.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-[0.7rem] shrink-0"
                    onClick={() => {
                      setStructureId(suggestedGrade.id);
                      // The amount is already right — it is the grade that was
                      // wrong — so the override is deliberately preserved.
                    }}
                  >
                    <ArrowRightLeft className="h-3 w-3 mr-1.5" />
                    Switch
                  </Button>
                </div>
              )}
            </div>
          )}
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
