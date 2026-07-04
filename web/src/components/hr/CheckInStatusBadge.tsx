'use client';

import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type CheckInBadgeStatus =
  | 'on_time'
  | 'late'
  | 'early_checkout'
  | 'missing_checkout'
  | 'on_approved_leave'
  | 'worked_on_off_day';

const statusConfig: Record<CheckInBadgeStatus, { label: string; className: string }> = {
  on_time: {
    label: 'On Time',
    className:
      'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800',
  },
  late: {
    label: 'Late',
    className:
      'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800',
  },
  early_checkout: {
    label: 'Early Checkout',
    className:
      'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800',
  },
  missing_checkout: {
    label: 'Missing Checkout',
    className:
      'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800',
  },
  on_approved_leave: {
    label: 'On Approved Leave',
    className:
      'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800',
  },
  worked_on_off_day: {
    label: 'Worked on Off Day',
    className:
      'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-800',
  },
};

interface CheckInStatusBadgeProps {
  status: CheckInBadgeStatus;
  className?: string;
  /**
   * Optional plain-language explanation. When provided, the badge becomes a tooltip
   * trigger — e.g. an "Early Checkout" badge explaining "Checked out 2h 48m before
   * the 8:30 PM checkout time." Build it with `checkInBadgeTooltip` from
   * `@/lib/check-in-time`. Without it the badge renders as a plain label (unchanged).
   */
  tooltip?: string;
}

export function CheckInStatusBadge({ status, className, tooltip }: CheckInStatusBadgeProps) {
  const config = statusConfig[status] ?? statusConfig.on_time;

  const badge = (
    <Badge
      variant="outline"
      className={cn(config.className, tooltip && 'cursor-help', className)}
    >
      {config.label}
    </Badge>
  );

  if (!tooltip) return badge;

  return (
    <Tooltip>
      <TooltipTrigger
        render={<span />}
        className="inline-flex"
        tabIndex={0}
        aria-label={tooltip}
      >
        {badge}
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
