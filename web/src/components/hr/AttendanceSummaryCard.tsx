'use client';

import { Info, type LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface AttendanceSummaryCardProps {
  label: string;
  value: number | string;
  subtext?: string;
  icon: LucideIcon;
  variant?: 'green' | 'red' | 'amber' | 'blue' | 'purple' | 'default';
  /** Optional 1-2 line explanation shown behind an info icon in the top-right. */
  tooltip?: string;
}

const variantStyles: Record<string, { icon: string; bg: string }> = {
  green: {
    icon: 'text-green-600 dark:text-green-400',
    bg: 'bg-green-100 dark:bg-green-900/30',
  },
  red: {
    icon: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-100 dark:bg-red-900/30',
  },
  amber: {
    icon: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-100 dark:bg-amber-900/30',
  },
  blue: {
    icon: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-100 dark:bg-blue-900/30',
  },
  purple: {
    icon: 'text-purple-600 dark:text-purple-400',
    bg: 'bg-purple-100 dark:bg-purple-900/30',
  },
  default: {
    icon: 'text-muted-foreground',
    bg: 'bg-muted',
  },
};

export function AttendanceSummaryCard({
  label,
  value,
  subtext,
  icon: Icon,
  variant = 'default',
  tooltip,
}: AttendanceSummaryCardProps) {
  const styles = variantStyles[variant] ?? variantStyles.default;

  return (
    <Card>
      <CardContent className="relative flex items-center gap-3 p-4">
        {tooltip && (
          <Tooltip>
            <TooltipTrigger
              render={<span />}
              className="absolute right-3 top-3 inline-flex text-muted-foreground/60 transition-colors hover:text-foreground"
              aria-label={`How ${label} is calculated`}
            >
              <Info className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>{tooltip}</TooltipContent>
          </Tooltip>
        )}
        <div
          className={cn(
            'flex items-center justify-center rounded-lg size-10 shrink-0',
            styles.bg
          )}
        >
          <Icon className={cn('size-5', styles.icon)} />
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-bold text-foreground tabular-nums">
            {value}
          </p>
          <p className="text-xs text-muted-foreground truncate">{label}</p>
          {subtext && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {subtext}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
