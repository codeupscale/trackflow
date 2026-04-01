'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { AttendanceStatus } from '@/lib/validations/attendance';

const statusConfig: Record<AttendanceStatus, { label: string; className: string }> = {
  present: {
    label: 'Present',
    className:
      'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800',
  },
  absent: {
    label: 'Absent',
    className:
      'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800',
  },
  half_day: {
    label: 'Half Day',
    className:
      'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800',
  },
  on_leave: {
    label: 'On Leave',
    className:
      'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800',
  },
  holiday: {
    label: 'Holiday',
    className:
      'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-800',
  },
  weekend: {
    label: 'Weekend',
    className:
      'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800/30 dark:text-gray-400 dark:border-gray-700',
  },
};

interface AttendanceStatusBadgeProps {
  status: AttendanceStatus;
}

export function AttendanceStatusBadge({ status }: AttendanceStatusBadgeProps) {
  const config = statusConfig[status] ?? statusConfig.absent;

  return (
    <Badge variant="outline" className={cn(config.className)}>
      {config.label}
    </Badge>
  );
}
