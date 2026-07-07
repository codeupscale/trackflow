'use client';

import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ApprovalStatus } from '@/lib/validations/time-entry';

const statusConfig: Record<ApprovalStatus, { label: string; className: string }> = {
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
};

interface ApprovalStatusBadgeProps {
  status: ApprovalStatus;
  /** When rejected, surfaced as a tooltip on hover/focus. */
  rejectionReason?: string | null;
}

/**
 * Renders a manual entry's approval state. A rejected badge with a reason exposes
 * the reason via tooltip (keyboard-focusable trigger).
 */
export function ApprovalStatusBadge({ status, rejectionReason }: ApprovalStatusBadgeProps) {
  const config = statusConfig[status] ?? statusConfig.pending;

  const badge = (
    <Badge variant="outline" className={cn(config.className)}>
      {config.label}
    </Badge>
  );

  if (status === 'rejected' && rejectionReason) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={<span />}
          className="inline-flex cursor-help"
          aria-label={`Rejected: ${rejectionReason}`}
        >
          {badge}
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{rejectionReason}</TooltipContent>
      </Tooltip>
    );
  }

  return badge;
}
