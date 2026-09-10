'use client';

import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DEFAULT_CURRENCY, formatMoney } from '@/lib/money';
import { bandStatus, type SalaryStructure } from '@/lib/validations/payroll';

/**
 * A band figure, grouped the way the currency's own locale groups.
 *
 * `currency` is optional because `formatBand` is a pure helper called from
 * render bodies that do not all have the org in hand; the default keeps those
 * readable rather than forcing a hook where a plain function belongs.
 */
function money(n: number | null | undefined, currency?: string) {
  if (n == null || Number.isNaN(n)) return '—';
  return formatMoney(n, currency ?? DEFAULT_CURRENCY, { symbol: false, compact: true });
}

/** "120,000 – 150,000", or null when the grade has no band. */
export function formatBand(
  grade: Pick<SalaryStructure, 'min_salary' | 'max_salary'> | null | undefined,
  currency?: string,
): string | null {
  if (!grade) return null;
  const min = grade.min_salary != null ? Number(grade.min_salary) : null;
  const max = grade.max_salary != null ? Number(grade.max_salary) : null;
  if (min == null && max == null) return null;
  if (min != null && max != null) return `${money(min, currency)} – ${money(max, currency)}`;
  return min != null
    ? `${money(min, currency)} and above`
    : `up to ${money(max, currency)}`;
}

interface SalaryBandIndicatorProps {
  amount: number | null | undefined;
  grade: Pick<SalaryStructure, 'min_salary' | 'max_salary'> | null | undefined;
  className?: string;
}

/**
 * Where a salary sits against its grade's approved band.
 *
 * Out-of-band WARNS, it never blocks. Real exceptions exist — retention offers,
 * market adjustments, negotiated pay — and a hard block does not prevent them,
 * it just pushes HR into widening the band, which destroys the signal for
 * everyone.
 *
 * A grade with no band renders a neutral note, never a violation: "no band
 * configured" is the normal state for an org still setting pay up, and styling
 * it as an error would train people to ignore the real warnings.
 */
export function SalaryBandIndicator({ amount, grade, className }: SalaryBandIndicatorProps) {
  const status = bandStatus(amount, grade);
  const band = formatBand(grade);

  if (status === 'no_band') {
    return (
      <p className={cn('inline-flex items-center gap-1.5 text-[0.7rem] text-muted-foreground', className)}>
        <Info className="h-3.5 w-3.5 shrink-0" />
        No approved band set for this grade
      </p>
    );
  }

  if (status === 'in_band') {
    return (
      <p className={cn('inline-flex items-center gap-1.5 text-[0.7rem] text-emerald-600 dark:text-emerald-400', className)}>
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        Within approved range
        <span className="text-muted-foreground tabular-nums">({band})</span>
      </p>
    );
  }

  return (
    <p className={cn('inline-flex items-center gap-1.5 text-[0.7rem] text-amber-600 dark:text-amber-400', className)}>
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      {status === 'above' ? 'Above' : 'Below'} the approved range
      <span className="text-muted-foreground tabular-nums">({band})</span>
    </p>
  );
}
