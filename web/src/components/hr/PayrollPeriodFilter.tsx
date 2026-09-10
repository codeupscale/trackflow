'use client';

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Years the picker offers.
 *
 * The last five years UNION whatever the server reports having payslips in —
 * not just the latter. Offering only years that already have data means "did we
 * pay anything in 2025?" is a question the filter cannot be asked, which is the
 * one thing a year filter is for. An empty year is a real answer.
 */
export function yearOptions(years: number[]) {
  const now = new Date().getFullYear();
  const recent = Array.from({ length: 5 }, (_, i) => now - i);
  const all = [...new Set([...recent, ...years])].sort((a, b) => b - a);

  return [
    { value: 'all', label: 'All years' },
    ...all.map((y) => ({ value: String(y), label: String(y) })),
  ];
}

export const monthOptions = [
  { value: 'all', label: 'All months' },
  ...MONTHS.map((m, i) => ({ value: String(i + 1), label: m })),
];

/**
 * What a total covers, in words — "September 2026", "2026", "All-time".
 *
 * Belongs in the figure's own label: a number whose scope is only legible from
 * a dropdown elsewhere on the page invites being read as something it is not.
 */
export function periodLabelFor(year?: number, month?: number): string {
  if (month) return `${MONTHS[month - 1]}${year ? ` ${year}` : ''}`;
  return year ? String(year) : 'All-time';
}

interface Props {
  /** Years the viewer actually has payslips in, from the API. */
  years: number[];
  year: number | undefined;
  month: number | undefined;
  onYearChange: (year: number | undefined) => void;
  onMonthChange: (month: number | undefined) => void;
  label?: string;
}

/**
 * The period a set of payroll figures covers.
 *
 * Shared by My Payslips and the payroll periods tab so the two cannot drift —
 * they ask the same API the same way, and the API scopes the rows by role, so
 * an employee sees their own year and an operator sees the company's from
 * identical code.
 *
 * Always rendered, never hidden for having few options. An earlier version
 * appeared only when the server reported more than one year with data, which
 * meant the filter vanished for anyone with a single year of history.
 */
export function PayrollPeriodFilter({
  years,
  year,
  month,
  onYearChange,
  onMonthChange,
  label = 'Period',
}: Props) {
  const yearItems = yearOptions(years);

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="payroll-period-year" className="text-xs text-muted-foreground">
        {label}
      </Label>

      <Select
        items={yearItems}
        value={year === undefined ? 'all' : String(year)}
        onValueChange={(v) => v && onYearChange(v === 'all' ? undefined : Number(v))}
      >
        <SelectTrigger id="payroll-period-year" className="h-8 w-28 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {yearItems.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        items={monthOptions}
        value={month === undefined ? 'all' : String(month)}
        onValueChange={(v) => v && onMonthChange(v === 'all' ? undefined : Number(v))}
      >
        <SelectTrigger className="h-8 w-32 text-xs" aria-label="Month">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {monthOptions.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
