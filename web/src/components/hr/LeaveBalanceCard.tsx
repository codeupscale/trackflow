'use client';

import { Calendar } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn, formatLeaveDays, type LeaveTypeColor } from '@/lib/utils';
import type { LeaveBalance } from '@/lib/validations/leave';

interface LeaveBalanceCardProps {
  balance: LeaveBalance;
  selected?: boolean;
  onClick?: () => void;
  /**
   * Identity colour for this leave type, assigned by the parent via
   * `assignLeaveTypeColors()` so every card in the list is visually distinct.
   * Omitted, the card falls back to a neutral primary bar.
   */
  color?: LeaveTypeColor;
}

const FALLBACK: LeaveTypeColor = {
  icon: 'bg-primary/10 text-primary',
  bar: 'bg-primary',
  value: 'text-foreground',
};

export function LeaveBalanceCard({ balance, selected, onClick, color }: LeaveBalanceCardProps) {
  const { leave_type } = balance;
  // The API sends decimal(5,1) as strings ("20.0"), so coerce before any maths
  // or the subtraction below silently concatenates.
  const total_days = Number(balance.total_days);
  const used_days = Number(balance.used_days);
  const pending_days = Number(balance.pending_days);
  const remaining = total_days - used_days - pending_days;

  // The BAR carries the leave type's identity, so the cards read as different
  // charts rather than four identical green ones. Colouring the bar by
  // remaining-percentage (the old rule) made every full balance look the same,
  // which is exactly what hid one type from another.
  const colors = color ?? FALLBACK;

  // The "running low" signal survives on the remaining figure, keeping the
  // original thresholds. Identity swatches never use red or amber, so the two
  // readings — which type this is, and how little is left — can't be confused.
  const ratio = total_days > 0 ? remaining / total_days : 1;
  const lowClass =
    ratio <= 0.25
      ? 'text-red-600 dark:text-red-400'
      : ratio <= 0.5
        ? 'text-amber-600 dark:text-amber-400'
        : null;

  return (
    <Card
      className={cn(
        'transition-all border-border',
        onClick && 'cursor-pointer hover:border-primary/50',
        selected && 'border-primary ring-2 ring-primary/20'
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      aria-label={`${leave_type.name}: ${remaining} days remaining`}
      aria-pressed={onClick ? selected : undefined}
    >
      <CardContent className="p-3">
        <div className="flex items-start justify-between mb-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <div className={cn('flex h-7 w-7 items-center justify-center rounded-lg shrink-0', colors.icon)}>
              <Calendar className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium truncate">{leave_type.name}</p>
              <p className="text-[0.6rem] text-muted-foreground">{formatLeaveDays(total_days)} days/year</p>
            </div>
          </div>
          <div className="text-right shrink-0 ml-2">
            <p className={cn('text-lg font-bold tabular-nums leading-tight', lowClass ?? colors.value)}>
              {formatLeaveDays(remaining)}
            </p>
            <p className="text-[0.55rem] text-muted-foreground uppercase tracking-wider">left</p>
          </div>
        </div>

        {/* Progress bar — shows remaining (full when no leave used, shrinks as leave is consumed) */}
        <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-2">
          <div
            className={cn('h-full rounded-full transition-all', colors.bar)}
            style={{ width: `${total_days > 0 ? Math.max((remaining / total_days) * 100, 0) : 0}%` }}
          />
        </div>

        {/* Stats row */}
        <div className="flex items-center justify-between text-[0.6rem] text-muted-foreground">
          {used_days > 0 ? (
            <span className="tabular-nums">{formatLeaveDays(used_days)} used</span>
          ) : (
            <span />
          )}
          <span className="tabular-nums font-medium">{formatLeaveDays(remaining)} remaining</span>
        </div>
      </CardContent>
    </Card>
  );
}
