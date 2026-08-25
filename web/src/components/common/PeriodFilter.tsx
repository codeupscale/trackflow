'use client';

import { useState } from 'react';
import {
  endOfMonth,
  endOfQuarter,
  endOfYear,
  format,
  getQuarter,
  parseISO,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  subMonths,
  subQuarters,
} from 'date-fns';
import { CalendarRange, ChevronLeft, ChevronRight, ChevronsUpDown, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

/**
 * Period selection for list filters — the Stripe/Linear pattern: smart presets
 * for the common cases ("this month" covers most real queries), a year-navigable
 * month grid for any specific month of any year, and a custom range escape
 * hatch. Replaces the flat last-12-months dropdown, which hard-capped history
 * and only got worse as years passed.
 */
export type Period =
  | { kind: 'all' }
  | { kind: 'preset'; preset: PresetKey }
  | { kind: 'month'; month: string }; // yyyy-MM

type PresetKey = 'this_month' | 'last_month' | 'this_quarter' | 'last_quarter' | 'this_year';

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'this_quarter', label: 'This quarter' },
  { key: 'last_quarter', label: 'Last quarter' },
  { key: 'this_year', label: 'This year' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const iso = (d: Date) => format(d, 'yyyy-MM-dd');

/** Resolve a Period to API date bounds. */
export function periodToRange(p: Period): { start_date?: string; end_date?: string } {
  const now = new Date();
  switch (p.kind) {
    case 'all':
      return {};
    case 'preset': {
      switch (p.preset) {
        case 'this_month':
          return { start_date: iso(startOfMonth(now)), end_date: iso(endOfMonth(now)) };
        case 'last_month': {
          const d = subMonths(now, 1);
          return { start_date: iso(startOfMonth(d)), end_date: iso(endOfMonth(d)) };
        }
        case 'this_quarter':
          return { start_date: iso(startOfQuarter(now)), end_date: iso(endOfQuarter(now)) };
        case 'last_quarter': {
          const d = subQuarters(now, 1);
          return { start_date: iso(startOfQuarter(d)), end_date: iso(endOfQuarter(d)) };
        }
        case 'this_year':
          return { start_date: iso(startOfYear(now)), end_date: iso(endOfYear(now)) };
      }
      return {};
    }
    case 'month': {
      const first = parseISO(`${p.month}-01`);
      return { start_date: iso(first), end_date: iso(endOfMonth(first)) };
    }
  }
}

/** Human label for the trigger — reads as the ACTIVE filter, not the menu name. */
export function periodLabel(p: Period): string {
  const now = new Date();
  switch (p.kind) {
    case 'all':
      return 'All time';
    case 'preset':
      switch (p.preset) {
        case 'this_month': return 'This month';
        case 'last_month': return format(subMonths(now, 1), 'MMM yyyy');
        case 'this_quarter': return `Q${getQuarter(now)} ${format(now, 'yyyy')}`;
        case 'last_quarter': {
          const d = subQuarters(now, 1);
          return `Q${getQuarter(d)} ${format(d, 'yyyy')}`;
        }
        case 'this_year': return format(now, 'yyyy');
      }
      return 'Period';
    case 'month':
      return format(parseISO(`${p.month}-01`), 'MMM yyyy');
  }
}

interface PeriodFilterProps {
  value: Period;
  onChange: (p: Period) => void;
  className?: string;
}

export function PeriodFilter({ value, onChange, className }: PeriodFilterProps) {
  const [open, setOpen] = useState(false);
  // Year shown in the month grid — starts at the selection's year so reopening
  // lands where the user left off.
  const [gridYear, setGridYear] = useState(() =>
    value.kind === 'month' ? Number(value.month.slice(0, 4)) : new Date().getFullYear(),
  );

  const pick = (p: Period) => {
    onChange(p);
    setOpen(false);
  };

  const selectedMonth = value.kind === 'month' ? value.month : null;
  const nowMonth = format(new Date(), 'yyyy-MM');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            aria-label="Filter by period"
            className={cn('h-8 justify-between gap-2 text-xs font-normal min-w-36', className)}
          />
        }
      >
        <span className="inline-flex items-center gap-1.5 truncate">
          <CalendarRange className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          {periodLabel(value)}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {/* Clear back to All time — same affordance as the employee filter
              beside it. stopPropagation so clearing doesn't also open the
              panel. */}
          {value.kind !== 'all' && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear period filter"
              className="rounded-sm opacity-70 hover:opacity-100"
              onClick={(e) => { e.stopPropagation(); onChange({ kind: 'all' }); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  e.preventDefault();
                  onChange({ kind: 'all' });
                }
              }}
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
        </span>
      </PopoverTrigger>

      <PopoverContent className="w-64 p-2" align="start">
        <div className="flex flex-col gap-2">
          {/* Presets */}
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => pick({ kind: 'all' })}
              className={cn(
                'rounded-md px-2 py-1.5 text-[0.7rem] text-left transition-colors hover:bg-muted',
                value.kind === 'all' && 'bg-primary/10 text-primary font-medium',
              )}
            >
              All time
            </button>
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => pick({ kind: 'preset', preset: p.key })}
                className={cn(
                  'rounded-md px-2 py-1.5 text-[0.7rem] text-left transition-colors hover:bg-muted',
                  value.kind === 'preset' && value.preset === p.key && 'bg-primary/10 text-primary font-medium',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="h-px bg-border" />

          {/* Specific month — year-navigable grid, any year reachable */}
          <div className="flex items-center justify-between px-1">
            <button
              type="button"
              aria-label="Previous year"
              onClick={() => setGridYear((y) => y - 1)}
              className="rounded-md p-1 hover:bg-muted text-muted-foreground"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="text-xs font-semibold tabular-nums">{gridYear}</span>
            <button
              type="button"
              aria-label="Next year"
              onClick={() => setGridYear((y) => y + 1)}
              className="rounded-md p-1 hover:bg-muted text-muted-foreground"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {MONTHS.map((label, i) => {
              const key = `${gridYear}-${String(i + 1).padStart(2, '0')}`;
              // Future months stay selectable — leave is future-dated by
              // nature (next month's approved holiday is the normal case).
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => pick({ kind: 'month', month: key })}
                  className={cn(
                    'rounded-md py-1.5 text-[0.7rem] transition-colors hover:bg-muted',
                    selectedMonth === key && 'bg-primary text-primary-foreground font-medium hover:bg-primary',
                    key === nowMonth && selectedMonth !== key && 'ring-1 ring-primary/40',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>

        </div>
      </PopoverContent>
    </Popover>
  );
}
