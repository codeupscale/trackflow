'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Lock, Minus, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { usePayComponents } from '@/hooks/hr/use-pay-components';
import { useUpdatePayslipLines } from '@/hooks/hr/use-payslip-template';
import { cn } from '@/lib/utils';
import {
  EARNING_CATEGORIES,
  LINE_CATEGORY_LABELS,
  type PayComponent,
  type Payslip,
  type PayslipLineCategory,
} from '@/lib/validations/payroll';

interface Props {
  payslip: Payslip | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface DraftLine {
  label: string;
  category: PayslipLineCategory;
  amount: string;
}

const EARNING_OPTIONS: PayslipLineCategory[] = ['basic', 'allowance', 'bonus', 'overtime'];
const DEDUCTION_OPTIONS: PayslipLineCategory[] = ['tax', 'deduction', 'other'];

/** Every category, as Base UI needs them to render a selected label. */
const CATEGORY_ITEMS = [...EARNING_OPTIONS, ...DEDUCTION_OPTIONS].map((c) => ({
  value: c,
  label: LINE_CATEGORY_LABELS[c],
}));

/**
 * A pay component's type, as a line category.
 *
 * They are separate vocabularies on purpose: a component is `allowance |
 * deduction | bonus | tax`, while a line also distinguishes basic pay and
 * overtime, which no component describes.
 */
const COMPONENT_TYPE_TO_CATEGORY: Record<PayComponent['type'], PayslipLineCategory> = {
  allowance: 'allowance',
  bonus: 'bonus',
  deduction: 'deduction',
  tax: 'tax',
};

function isEarning(category: PayslipLineCategory) {
  return EARNING_CATEGORIES.includes(category);
}

function money(value: number) {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Edit one payslip's earnings and deductions.
 *
 * Split into two sections rather than one flat list: a payslip IS two columns,
 * and grouping them means the type of a line is given by where it sits instead
 * of being read off a dropdown on every row. Each side carries its own
 * subtotal, so the arithmetic is checkable without adding anything up.
 *
 * Amounts are always entered POSITIVE — the section decides the sign. Letting
 * someone type a negative deduction is how a deduction becomes a payment.
 */
export function PayslipLinesDialog({ payslip, open, onOpenChange }: Props) {
  const [lines, setLines] = useState<DraftLine[]>([]);
  const updateLines = useUpdatePayslipLines();

  // The org's configured components, offered as suggestions on the label.
  // Nothing is applied automatically any more — a component describes what a
  // line is called and what it is normally worth, and a person decides whether
  // this payslip gets one.
  const { data: components } = usePayComponents({ per_page: 200 });

  const componentsByName = useMemo(() => {
    const map = new Map<string, { category: PayslipLineCategory; amount: string | null }>();
    for (const c of components?.data ?? []) {
      map.set(c.name.trim().toLowerCase(), {
        category: COMPONENT_TYPE_TO_CATEGORY[c.type] ?? 'other',
        amount: c.calculation_type === 'fixed' ? String(Number(c.value)) : null,
      });
    }
    return map;
  }, [components]);

  const locked = payslip?.status === 'approved' || payslip?.status === 'paid';

  useEffect(() => {
    if (!payslip) return;
    setLines(
      (payslip.line_items ?? []).map((item) => ({
        label: item.label,
        // Rows written before categories existed fall back to their side.
        category: (item.category ??
          (item.type === 'earning' ? 'allowance' : 'deduction')) as PayslipLineCategory,
        amount: String(item.amount ?? '0'),
      })),
    );
  }, [payslip]);

  const totals = useMemo(() => {
    let earnings = 0;
    let deductions = 0;
    for (const line of lines) {
      const amount = Number(line.amount) || 0;
      if (isEarning(line.category)) earnings += amount;
      else deductions += amount;
    }
    return { earnings, deductions, net: earnings - deductions };
  }, [lines]);

  // Index into `lines` is kept alongside each row so edits address the real
  // entry, not its position within a filtered view.
  const rows = lines.map((line, index) => ({ line, index }));
  const earningRows = rows.filter((r) => isEarning(r.line.category));
  const deductionRows = rows.filter((r) => !isEarning(r.line.category));

  const update = (index: number, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  const addLine = (category: PayslipLineCategory) =>
    setLines((prev) => [...prev, { label: '', category, amount: '' }]);

  const removeLine = (index: number) =>
    setLines((prev) => prev.filter((_, i) => i !== index));

  const save = async () => {
    if (!payslip) return;
    const payload = lines
      .filter((l) => l.label.trim() !== '')
      .map((l) => ({
        label: l.label.trim(),
        category: l.category,
        amount: Number(l.amount) || 0,
      }));

    try {
      await updateLines.mutateAsync({ id: payslip.id, lines: payload });
      onOpenChange(false);
    } catch {
      // onError surfaced the reason; keep the dialog open so it can be fixed.
    }
  };

  const unnamed = lines.some((l) => l.label.trim() === '' && l.amount.trim() !== '');

  const renderSection = (
    title: string,
    subtitle: string,
    sectionRows: { line: DraftLine; index: number }[],
    options: PayslipLineCategory[],
    subtotal: number,
    tone: 'earning' | 'deduction',
  ) => (
    <section className="rounded-lg border border-border/70">
      <header
        className={cn(
          'flex items-center justify-between gap-3 rounded-t-lg border-b border-border/70 px-3 py-2',
          tone === 'earning' ? 'bg-emerald-500/[0.06]' : 'bg-red-500/[0.05]',
        )}
      >
        <div className="flex items-center gap-2">
          {tone === 'earning' ? (
            <Plus className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <Minus className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
          )}
          <div>
            <h3 className="text-xs font-semibold">{title}</h3>
            <p className="text-[0.62rem] text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <span
          className={cn(
            'text-sm font-semibold tabular-nums',
            tone === 'earning'
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-red-600 dark:text-red-400',
          )}
        >
          {money(subtotal)}
        </span>
      </header>

      <div className="p-2">
        {sectionRows.length === 0 ? (
          <p className="py-3 text-center text-[0.68rem] text-muted-foreground">
            Nothing here yet.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-[minmax(0,1fr)_136px_132px_32px] gap-2 px-1 pb-1">
              <span className="text-[0.58rem] font-medium uppercase tracking-wider text-muted-foreground">
                Description
              </span>
              <span className="text-[0.58rem] font-medium uppercase tracking-wider text-muted-foreground">
                Type
              </span>
              <span className="text-right text-[0.58rem] font-medium uppercase tracking-wider text-muted-foreground">
                Amount
              </span>
              <span />
            </div>

            <div className="space-y-1.5">
              {sectionRows.map(({ line, index }) => (
                <div
                  key={index}
                  className="grid grid-cols-[minmax(0,1fr)_136px_132px_32px] items-center gap-2"
                >
                  {/* Free text, but the org's own components are offered.
                      The label is not just a caption: a payslip design
                      addresses a box by `component.<label-slug>`, so
                      "Overtime" typed where the component is called "Over
                      Time" leaves that box blank on the PDF with nothing to
                      say why. Picking one fills the amount it is configured
                      with, which is the whole point of having configured it. */}
                  <Input
                    value={line.label}
                    disabled={locked}
                    list="payslip-component-labels"
                    placeholder="Pick or type a name"
                    onChange={(e) => {
                      const label = e.target.value;
                      const match = componentsByName.get(label.trim().toLowerCase());
                      update(
                        index,
                        match
                          ? {
                              label,
                              category: match.category,
                              // A percentage component is a rate, not an
                              // amount, and the base it applies to is this
                              // payslip's — so it is left for the operator
                              // rather than guessed at here.
                              ...(match.amount !== null ? { amount: match.amount } : {}),
                            }
                          : { label },
                      );
                    }}
                    className="h-9 text-xs"
                  />

                  {/* `items` maps the value back to its label — without it
                      Base UI's Select shows the raw category key. */}
                  <Select
                    items={CATEGORY_ITEMS}
                    value={line.category}
                    onValueChange={(v) =>
                      update(index, { category: (v ?? 'other') as PayslipLineCategory })
                    }
                    disabled={locked}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {/* Every category is offered, so moving a line from
                          earnings to deductions is a change of type rather
                          than a delete and re-add. */}
                      {[...EARNING_OPTIONS, ...DEDUCTION_OPTIONS].map((c) => (
                        <SelectItem key={c} value={c} className="text-xs">
                          {LINE_CATEGORY_LABELS[c]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={line.amount}
                    disabled={locked}
                    onChange={(e) => update(index, { amount: e.target.value })}
                    className="h-9 text-right text-xs tabular-nums"
                  />

                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={locked}
                    aria-label={`Remove ${line.label || 'line'}`}
                    onClick={() => removeLine(index)}
                    className="h-9 w-8 p-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </>
        )}

        {!locked && (
          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border/50 pt-2">
            {options.map((c) => (
              <Button
                key={c}
                variant="ghost"
                size="sm"
                onClick={() => addLine(c)}
                className="h-7 text-[0.68rem] text-muted-foreground hover:text-foreground"
              >
                <Plus className="mr-1 h-3 w-3" />
                {LINE_CATEGORY_LABELS[c]}
              </Button>
            ))}
          </div>
        )}
      </div>
    </section>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-[780px]">
        {/* Shared by every label input in the dialog — one list, referenced by
            id, rather than a copy per row. */}
        <datalist id="payslip-component-labels">
          {(components?.data ?? []).map((c) => (
            <option key={c.id} value={c.name} />
          ))}
        </datalist>

        <DialogHeader className="border-b border-border/70 px-5 py-4">
          <DialogTitle className="text-sm">
            {payslip?.user?.name ?? 'Payslip'}
            {payslip?.payroll_period?.name ? (
              <span className="font-normal text-muted-foreground">
                {' '}
                · {payslip.payroll_period.name}
              </span>
            ) : null}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {locked ? (
              <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <Lock className="h-3.5 w-3.5" />
                This payslip has been {payslip?.status} — its figures are a record of what was
                paid and can no longer be edited.
              </span>
            ) : (
              'Enter every amount as a positive number — the section decides whether it adds or subtracts. Saving resets verification, so the payslip needs checking again.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[52vh] space-y-3 overflow-y-auto px-5 py-4">
          {renderSection(
            'Earnings',
            'Basic pay, allowances, bonuses and overtime',
            earningRows,
            EARNING_OPTIONS,
            totals.earnings,
            'earning',
          )}
          {renderSection(
            'Deductions',
            'Tax, loans and anything withheld',
            deductionRows,
            DEDUCTION_OPTIONS,
            totals.deductions,
            'deduction',
          )}
        </div>

        <div className="border-t border-border/70 bg-muted/30 px-5 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-5 text-xs">
              <div>
                <p className="text-[0.6rem] uppercase tracking-wider text-muted-foreground">
                  Gross
                </p>
                <p className="font-semibold tabular-nums">{money(totals.earnings)}</p>
              </div>
              <span className="text-muted-foreground">−</span>
              <div>
                <p className="text-[0.6rem] uppercase tracking-wider text-muted-foreground">
                  Deductions
                </p>
                <p className="font-semibold tabular-nums text-red-600 dark:text-red-400">
                  {money(totals.deductions)}
                </p>
              </div>
              <span className="text-muted-foreground">=</span>
              <div>
                <p className="text-[0.6rem] uppercase tracking-wider text-muted-foreground">
                  Net pay
                </p>
                <p className="text-base font-bold tabular-nums">{money(totals.net)}</p>
              </div>
            </div>

            {totals.net < 0 && (
              <p className="text-[0.68rem] font-medium text-amber-600 dark:text-amber-400">
                Deductions exceed earnings — net pay is negative.
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 border-t border-border/70 px-5 py-3">
          {unnamed && (
            <p className="mr-auto text-[0.68rem] text-amber-600 dark:text-amber-400">
              Lines without a description are dropped when you save.
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs"
            disabled={locked || updateLines.isPending}
            onClick={save}
          >
            {updateLines.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
