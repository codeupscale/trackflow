'use client';

import { Calendar } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LeaveBalance } from '@/lib/validations/leave';

interface LeaveBalanceCardProps {
  balance: LeaveBalance;
  selected?: boolean;
  onClick?: () => void;
}

export function LeaveBalanceCard({ balance, selected, onClick }: LeaveBalanceCardProps) {
  const { total_days, used_days, pending_days, leave_type } = balance;
  const remaining = total_days - used_days - pending_days;
  const usedPercent = total_days > 0 ? (used_days / total_days) * 100 : 0;
  const pendingPercent = total_days > 0 ? (pending_days / total_days) * 100 : 0;

  const accentColor =
    remaining / (total_days || 1) > 0.5
      ? 'emerald'
      : remaining / (total_days || 1) > 0.25
        ? 'amber'
        : 'red';

  const colorMap = {
    emerald: {
      icon: 'bg-emerald-500/10 text-emerald-500',
      bar: 'bg-emerald-500',
      pending: 'bg-amber-500',
      value: 'text-emerald-600 dark:text-emerald-400',
    },
    amber: {
      icon: 'bg-amber-500/10 text-amber-500',
      bar: 'bg-amber-500',
      pending: 'bg-amber-400',
      value: 'text-amber-600 dark:text-amber-400',
    },
    red: {
      icon: 'bg-red-500/10 text-red-500',
      bar: 'bg-red-500',
      pending: 'bg-amber-500',
      value: 'text-red-600 dark:text-red-400',
    },
  };

  const colors = colorMap[accentColor];

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
              <p className="text-[0.6rem] text-muted-foreground">{total_days} days/year</p>
            </div>
          </div>
          <div className="text-right shrink-0 ml-2">
            <p className={cn('text-lg font-bold tabular-nums leading-tight', colors.value)}>
              {remaining}
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
            <span className="tabular-nums">{used_days} used</span>
          ) : (
            <span />
          )}
          <span className="tabular-nums font-medium">{remaining} remaining</span>
        </div>
      </CardContent>
    </Card>
  );
}
