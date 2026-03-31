'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress, ProgressTrack, ProgressIndicator } from '@/components/ui/progress';
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
  const usedPercent = total_days > 0 ? ((used_days + pending_days) / total_days) * 100 : 0;
  const remainingPercent = total_days > 0 ? (remaining / total_days) * 100 : 0;

  const colorClass =
    remainingPercent > 50
      ? 'text-green-600 dark:text-green-400'
      : remainingPercent > 25
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-red-600 dark:text-red-400';

  const indicatorColor =
    remainingPercent > 50
      ? 'bg-green-500'
      : remainingPercent > 25
        ? 'bg-amber-500'
        : 'bg-red-500';

  return (
    <Card
      className={cn(
        'transition-all',
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
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">{leave_type.name}</CardTitle>
          <span className={cn('text-lg font-bold tabular-nums', colorClass)}>
            {remaining}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          of {total_days} days
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <Progress value={usedPercent}>
          <ProgressTrack>
            <ProgressIndicator className={indicatorColor} />
          </ProgressTrack>
        </Progress>
        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
          <span>{used_days} used</span>
          {pending_days > 0 && (
            <span className="text-amber-600 dark:text-amber-400">
              {pending_days} pending
            </span>
          )}
          <span className="ml-auto">{remaining} remaining</span>
        </div>
      </CardContent>
    </Card>
  );
}
