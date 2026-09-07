'use client';

import { useShifts } from '@/hooks/hr/use-shifts';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Switch a people list between shifts — "show me the sales team".
 *
 * Each team works its own shift, so the shift IS the team as far as anyone
 * reading these screens is concerned. Rendered as always-visible tabs rather
 * than a dropdown inside a Filters panel: switching between two teams is the
 * main thing these screens are used for, and a filter you have to go and find
 * reads as though the feature is missing.
 *
 * Tabs stop working somewhere past four options, so beyond that it falls back
 * to the same dropdown automatically. Nothing to configure — it follows however
 * many shifts the org has created.
 */
const MAX_TABS = 4;

interface ShiftTabsProps {
  /** null = All shifts. */
  value: string | null;
  onChange: (shiftId: string | null) => void;
  className?: string;
}

export function ShiftTabs({ value, onChange, className }: ShiftTabsProps) {
  const { data, isLoading } = useShifts({ is_active: true });
  const shifts = data?.data ?? [];

  // Nothing to switch between until a second shift exists.
  if (isLoading || shifts.length < 2) return null;

  if (shifts.length > MAX_TABS) {
    return (
      <Select
        items={[
          { value: 'all', label: 'All shifts' },
          ...shifts.map((s) => ({ value: s.id, label: s.name })),
        ]}
        value={value ?? 'all'}
        onValueChange={(v) => onChange(!v || v === 'all' ? null : v)}
      >
        <SelectTrigger className={cn('h-8 w-[170px] text-xs', className)}>
          <SelectValue placeholder="All shifts" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" className="text-xs">All shifts</SelectItem>
          {shifts.map((s) => (
            <SelectItem key={s.id} value={s.id} className="text-xs">
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  const tabs = [{ id: null as string | null, name: 'All', color: null as string | null }, ...shifts.map((s) => ({ id: s.id, name: s.name, color: s.color }))];

  return (
    <div
      role="tablist"
      aria-label="Filter by shift"
      className={cn(
        // A bordered track rather than a bare grey block: it reads as a control
        // sitting beside the other inputs instead of a stripe of background.
        'inline-flex h-8 items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5 shrink-0',
        className,
      )}
    >
      {tabs.map((tab) => {
        const active = value === tab.id;
        return (
          <button
            key={tab.id ?? 'all'}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[0.7rem] font-medium',
              'transition-all whitespace-nowrap focus-visible:outline-none',
              'focus-visible:ring-2 focus-visible:ring-ring/40',
              active
                ? 'bg-background shadow-sm'
                : 'text-muted-foreground hover:bg-background/50 hover:text-foreground',
            )}
            // The SELECTED tab is tinted with the shift's own colour, so
            // "Sales Shift" selected looks like Sales Shift rather than like a
            // generic active pill — the same colour that marks that shift in
            // the table's Shift column and on the shift cards.
            style={
              active && tab.color
                ? { color: tab.color, boxShadow: `inset 0 0 0 1px ${tab.color}55` }
                : undefined
            }
          >
            {tab.color && (
              <span
                className={cn(
                  'inline-block h-2 w-2 rounded-full shrink-0 transition-opacity',
                  // Muted until chosen, so the row of dots does not compete
                  // for attention when nothing is filtered.
                  active ? 'opacity-100' : 'opacity-50',
                )}
                style={{ backgroundColor: tab.color }}
              />
            )}
            {tab.name}
          </button>
        );
      })}
    </div>
  );
}
