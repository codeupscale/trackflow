'use client';

import { useRouter } from 'next/navigation';
import {
  AlarmClock,
  BadgeCheck,
  Bell,
  Building2,
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  CalendarX,
  Check,
  ClipboardCheck,
  ClipboardX,
  Clock,
  LogIn,
  LogOut,
  Megaphone,
  PartyPopper,
  Receipt,
  Send,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { AppNotification } from '@/hooks/use-notifications';

/**
 * How each kind of notification looks.
 *
 * Keyed by CATEGORY, never by the notification's PHP class — the API sends a
 * category precisely so a class can be renamed without every stored row
 * losing its icon. An unknown category falls back to a plain bell rather than
 * rendering nothing, so a notification added on the server is never invisible
 * on a frontend that has not shipped yet.
 */
const LOOKS: Record<string, { icon: LucideIcon; tint: string; bg: string }> = {
  'attendance.checked_in': {
    icon: LogIn,
    tint: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-500/10',
  },
  'attendance.checked_in_late': {
    icon: AlarmClock,
    tint: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-500/10',
  },
  'payroll.payslip_sent': {
    icon: Receipt,
    tint: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-500/10',
  },
  'leave.approved': {
    icon: CalendarCheck,
    tint: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-500/10',
  },
  'leave.rejected': {
    icon: CalendarX,
    tint: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-500/10',
  },
  'leave.requested': {
    icon: CalendarCheck,
    tint: 'text-violet-600 dark:text-violet-400',
    bg: 'bg-violet-500/10',
  },
  'holiday.announced': {
    icon: PartyPopper,
    tint: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-500/10',
  },
  'shift.timing_updated': {
    icon: Clock,
    tint: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-500/10',
  },
  'shift.assigned_to_you': {
    icon: CalendarClock,
    tint: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-500/10',
  },
  'shift.assigned': {
    icon: CalendarClock,
    tint: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-500/10',
  },
  'attendance.checked_out': {
    icon: LogOut,
    tint: 'text-slate-600 dark:text-slate-400',
    bg: 'bg-slate-500/10',
  },
  'leave.applied': {
    icon: CalendarPlus,
    tint: 'text-violet-600 dark:text-violet-400',
    bg: 'bg-violet-500/10',
  },
  'time_entry.approved': {
    icon: ClipboardCheck,
    tint: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-500/10',
  },
  'time_entry.rejected': {
    icon: ClipboardX,
    tint: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-500/10',
  },
  'employee.added': {
    icon: UserPlus,
    tint: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-500/10',
  },
  'department.created': {
    icon: Building2,
    tint: 'text-indigo-600 dark:text-indigo-400',
    bg: 'bg-indigo-500/10',
  },
  'job_posting.created': {
    icon: Megaphone,
    tint: 'text-orange-600 dark:text-orange-400',
    bg: 'bg-orange-500/10',
  },
  'payroll.run': {
    icon: Wallet,
    tint: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-500/10',
  },
  'payroll.payslip_released': {
    icon: Send,
    tint: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-500/10',
  },
  'payroll.completed': {
    icon: BadgeCheck,
    tint: 'text-violet-600 dark:text-violet-400',
    bg: 'bg-violet-500/10',
  },
};

const FALLBACK = { icon: Bell, tint: 'text-muted-foreground', bg: 'bg-muted' };

/**
 * "3m ago" / "2h ago" / "Mon" / "12 Mar".
 *
 * Deliberately not a library: this is the only relative-time display in the
 * app, and the whole rule is four branches long.
 */
export function relativeTime(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';

  const seconds = Math.floor((Date.now() - then.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d ago`;

  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

interface Props {
  notification: AppNotification;
  onRead: (id: string) => void;
  onDelete?: (id: string) => void;
  /** Called after navigation, so the panel can close itself. */
  onNavigate?: () => void;
}

export function NotificationItem({ notification, onRead, onDelete, onNavigate }: Props) {
  const router = useRouter();
  const isUnread = notification.read_at === null;

  // A late check-in is the same category with a different meaning, and the
  // amber clock is the whole point of the distinction on a busy morning.
  const lookKey =
    notification.category === 'attendance.checked_in' &&
    (notification.meta as { status?: string })?.status === 'late'
      ? 'attendance.checked_in_late'
      : notification.category;

  const look = LOOKS[lookKey] ?? FALLBACK;
  const Icon = look.icon;

  const open = () => {
    // Read on open, not on hover or on render: a notification is read when the
    // person acted on it, and marking on render silently empties the badge for
    // someone who only glanced at the panel.
    if (isUnread) onRead(notification.id);

    if (notification.url) {
      router.push(notification.url);
      onNavigate?.();
    }
  };

  return (
    <div
      className={cn(
        'group relative flex gap-3 px-4 py-3 transition-colors',
        notification.url && 'cursor-pointer',
        isUnread ? 'bg-primary/[0.04] hover:bg-primary/[0.07]' : 'hover:bg-muted/50',
      )}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      role={notification.url ? 'link' : undefined}
      tabIndex={notification.url ? 0 : undefined}
    >
      <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', look.bg)}>
        <Icon className={cn('h-4 w-4', look.tint)} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p
            className={cn(
              'text-[0.8rem] leading-snug',
              isUnread ? 'font-semibold text-foreground' : 'font-medium text-foreground/80',
            )}
          >
            {notification.title}
          </p>
          {isUnread && (
            <span
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
              aria-label="Unread"
            />
          )}
        </div>

        {notification.body && (
          <p className="mt-0.5 text-[0.72rem] leading-snug text-muted-foreground">
            {notification.body}
          </p>
        )}

        <p className="mt-1 text-[0.65rem] tabular-nums text-muted-foreground/70">
          {relativeTime(notification.created_at)}
        </p>
      </div>

      {/* Row actions. Hidden until hover so a list of twenty does not read as a
          wall of buttons, but always reachable by keyboard. */}
      <div className="flex shrink-0 items-start gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {isUnread && (
          <button
            type="button"
            aria-label="Mark as read"
            title="Mark as read"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onRead(notification.id);
            }}
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            aria-label="Remove"
            title="Remove"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(notification.id);
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
