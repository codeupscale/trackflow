'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { SwapStatus } from '@/lib/validations/shift';

const statusConfig: Record<SwapStatus, { label: string; className: string }> = {
  pending: {
    label: 'Pending',
    className:
      'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800',
  },
  approved: {
    label: 'Approved',
    className:
      'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800',
  },
  rejected: {
    label: 'Rejected',
    className:
      'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800',
  },
  cancelled: {
    label: 'Cancelled',
    className:
      'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800/30 dark:text-gray-400 dark:border-gray-700',
  },
};

interface ShiftStatusBadgeProps {
  status: SwapStatus;
}

export function ShiftStatusBadge({ status }: ShiftStatusBadgeProps) {
  const config = statusConfig[status] ?? statusConfig.pending;

  return (
    <Badge variant="outline" className={cn(config.className)}>
      {config.label}
    </Badge>
  );
}
