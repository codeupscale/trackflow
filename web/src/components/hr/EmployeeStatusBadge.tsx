'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { EmploymentStatus } from '@/lib/validations/employee';
import { employmentStatusLabels } from '@/lib/validations/employee';

const statusConfig: Record<
  EmploymentStatus,
  { className: string }
> = {
  active: {
    className:
      'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800',
  },
  probation: {
    className:
      'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800',
  },
  notice_period: {
    className:
      'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800',
  },
  terminated: {
    className:
      'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800',
  },
  resigned: {
    className:
      'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800/30 dark:text-gray-400 dark:border-gray-700',
  },
};

interface EmployeeStatusBadgeProps {
  status: EmploymentStatus;
}

export function EmployeeStatusBadge({ status }: EmployeeStatusBadgeProps) {
  const config = statusConfig[status];
  const label = employmentStatusLabels[status] ?? status;

  return (
    <Badge variant="outline" className={cn(config?.className)}>
      {label}
    </Badge>
  );
}
