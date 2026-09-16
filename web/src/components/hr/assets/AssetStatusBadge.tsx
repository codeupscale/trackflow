import { cn } from '@/lib/utils';
import { statusLabel, type AssetStatus } from '@/hooks/hr/use-assets';

/**
 * Status as a dot + label, matching the payroll period list.
 *
 * Colour follows what the status asks of the reader: green is ready to hand
 * out, blue is in use, amber needs attention soon, red needs attention now,
 * and grey is finished with.
 */
const LOOK: Record<AssetStatus, { dot: string; text: string }> = {
  available: { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  assigned: { dot: 'bg-blue-500', text: 'text-blue-600 dark:text-blue-400' },
  in_repair: { dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  lost: { dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
  retired: { dot: 'bg-slate-400', text: 'text-muted-foreground' },
};

export function AssetStatusBadge({ status, className }: { status: AssetStatus; className?: string }) {
  const look = LOOK[status] ?? LOOK.retired;

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[0.7rem] font-medium', look.text, className)}>
      <span className={cn('inline-block h-1.5 w-1.5 rounded-full', look.dot)} />
      {statusLabel(status)}
    </span>
  );
}
