'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Info, Loader2, LogIn, LogOut } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { CheckInStatusBadge } from '@/components/hr/CheckInStatusBadge';
import { EarlyCheckoutDialog } from '@/components/hr/EarlyCheckoutDialog';
import {
  useTodayStatus,
  useCheckIn,
  useCheckOut,
  type EarlyCheckoutPayload,
} from '@/hooks/hr/use-check-in';
import { useTimerStore } from '@/stores/timer-store';
import {
  computeClockOffset,
  elapsedSeconds,
  formatElapsed,
  formatDuration,
  checkInBadgeTooltip,
  dayPresenceSeconds,
  requiredDayFromPolicy,
} from '@/lib/check-in-time';
import type { CheckInSessionRow } from '@/lib/validations/attendance';

/**
 * The wall clock, read outside the component. Event handlers legitimately need
 * the current instant; going through a module-level helper keeps that out of
 * the render path, which must stay pure and idempotent.
 */
function nowMs(): number {
  return Date.now();
}

function formatClockTime(iso: string | null | undefined, timezone: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }
}

function SessionRow({ session, timezone }: { session: CheckInSessionRow; timezone: string }) {
  return (
    <div className="flex items-center gap-2 text-[0.7rem] text-muted-foreground">
      <span className="font-semibold text-foreground tabular-nums w-4 shrink-0">#{session.seq}</span>
      <span className="tabular-nums">{formatClockTime(session.check_in_at, timezone)}</span>
      <span className="text-muted-foreground/40" aria-hidden>&rarr;</span>
      {session.is_open ? (
        <span className="text-emerald-500 font-medium">in progress</span>
      ) : (
        <>
          <span className="tabular-nums">{formatClockTime(session.check_out_at, timezone)}</span>
          <span className="text-muted-foreground/30" aria-hidden>&middot;</span>
          <span className="font-medium text-foreground tabular-nums">{formatDuration(session.worked_seconds)}</span>
        </>
      )}
    </div>
  );
}

export function CheckInCard({ className }: { className?: string }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useTodayStatus();
  const checkIn = useCheckIn();
  const checkOut = useCheckOut();
  const isTimerRunning = useTimerStore((s) => s.isRunning);
  const prevTimerRunningRef = useRef(isTimerRunning);

  useEffect(() => {
    if (prevTimerRunningRef.current && !isTimerRunning) {
      queryClient.invalidateQueries({ queryKey: ['attendance', 'today'] });
    }
    prevTimerRunningRef.current = isTimerRunning;
  }, [isTimerRunning, queryClient]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Non-null only while the early-checkout dialog is up, holding the shortfall
  // measured at the instant the button was pressed. Kept in state rather than
  // recomputed each render: the shortfall is a fact about one moment, and
  // reading the clock during render is neither pure nor stable.
  const [earlyCheckout, setEarlyCheckout] = useState<{ shortfall: number } | null>(null);

  const offsetRef = useRef(0);
  useEffect(() => {
    if (data?.server_now) {
      offsetRef.current = computeClockOffset(data.server_now, Date.now());
    }
  }, [data?.server_now]);

  const isLive = Boolean(data?.has_open_session);

  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => forceTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isLive]);

  const sessionListRef = useRef<HTMLUListElement>(null);
  const sessionsCount = data?.sessions?.length ?? 0;
  useEffect(() => {
    const el = sessionListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sessionsCount, isLive]);

  if (isLoading) {
    return (
      <Card className={className}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-8 w-36" />
            </div>
            <Skeleton className="h-9 w-28 rounded-lg" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center gap-3 p-4">
          <AlertTriangle className="size-4 text-destructive shrink-0" />
          <p className="text-xs text-muted-foreground">Failed to load check-in status. Please refresh.</p>
        </CardContent>
      </Card>
    );
  }

  const timezone = data.policy?.timezone ?? 'UTC';
  const flags = data.check_in_flags ?? {};
  const sessions = data.sessions ?? [];
  const notCheckedIn = data.sessions_count === 0;

  const tickerSeconds =
    data.closed_worked_seconds +
    elapsedSeconds(data.open_check_in_at, offsetRef.current, Date.now());
  const liveTotal = mounted && isLive ? formatElapsed(tickerSeconds) : '00:00:00';
  const frozenTotal = formatDuration(data.worked_seconds);

  // Presence for the day (first in → last out, break included), non-null only
  // when it falls short of the required 9 hours. Sessions carry the day's
  // boundaries; an open day is never judged (the badge is gated on !isLive too).
  const firstIn = sessions[0]?.check_in_at ?? data.check_in_at ?? null;
  const lastOut = sessions.length
    ? sessions[sessions.length - 1]?.check_out_at ?? null
    : data.check_out_at ?? null;
  const presence = dayPresenceSeconds({
    check_in_at: firstIn,
    check_out_at: lastOut,
    worked_seconds: data.worked_seconds,
  });
  // Requirement comes from the user's own schedule (shift end − start, minus the
  // grace window), so using the grace the policy grants never reads as short.
  const requiredSeconds = requiredDayFromPolicy(data.policy);
  const shortDaySeconds =
    presence !== null && presence < requiredSeconds ? presence : null;

  // The server sends the day's own requirement, so the dialog and the badge are
  // judged on one number rather than two that can disagree.
  const requiredToday = data.required_day_seconds ?? requiredSeconds;
  // Asked once a day. A second early checkout cannot overwrite the first answer
  // server-side, so asking again would collect something that is thrown away.
  const alreadyExplained = data.early_checkout?.reason_given ?? false;

  const handleCheckOutClick = () => {
    // What the day comes to if they leave right now — measured from the FIRST
    // check-in, because the requirement is presence across the day (breaks
    // included), not the sum of the sessions. Read through nowMs so the clock
    // is touched in the click, never during a render.
    const presenceIfLeavingNow = elapsedSeconds(firstIn, offsetRef.current, nowMs());
    const shortfall = Math.max(0, requiredToday - presenceIfLeavingNow);

    if (shortfall > 0 && !alreadyExplained) {
      setEarlyCheckout({ shortfall });
      return;
    }
    checkOut.mutate(undefined);
  };

  const confirmCheckOut = (payload?: EarlyCheckoutPayload) => {
    checkOut.mutate(payload, { onSuccess: () => setEarlyCheckout(null) });
  };

  return (
    <>
    <Card className={cn('overflow-hidden', className)}>
      {/* Tracker warning */}
      {isTimerRunning && !data.has_open_session && data.can_check_in && (
        <Alert className="border-0 border-b border-amber-500/20 rounded-none bg-amber-500/5">
          <Info className="size-3.5 text-amber-600" />
          <AlertDescription className="text-[0.7rem] text-muted-foreground">
            Desktop tracker is running but you haven&apos;t checked in for attendance.
          </AlertDescription>
        </Alert>
      )}

      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-4">
          {/* Left: status + timer */}
          <div className="flex items-center gap-4 min-w-0">
            {/* Live pulse / status indicator */}
            <div className="relative shrink-0">
              <div className={cn(
                'flex h-12 w-12 items-center justify-center rounded-xl',
                isLive ? 'bg-emerald-500/10' : notCheckedIn ? 'bg-muted' : 'bg-blue-500/10',
              )}>
                {isLive ? (
                  <div className="relative">
                    <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/30" style={{ animationDuration: '2s' }} />
                    <span className="relative block h-3 w-3 rounded-full bg-emerald-500" />
                  </div>
                ) : notCheckedIn ? (
                  <LogIn className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <span className="block h-3 w-3 rounded-full bg-blue-500" />
                )}
              </div>
            </div>

            <div className="min-w-0 flex flex-col">
              {/* Status line */}
              <div className="flex items-center gap-2 flex-wrap">
                {notCheckedIn ? (
                  <p className="text-xs text-muted-foreground">Not checked in today</p>
                ) : (
                  <>
                    <span className="text-xs font-medium text-foreground">
                      {isLive ? 'Checked in' : 'Checked out'}
                    </span>
                    <span className="text-[0.6rem] text-muted-foreground tabular-nums">
                      {data.sessions_count} {data.sessions_count === 1 ? 'session' : 'sessions'}
                    </span>
                  </>
                )}
                {/* No Late badge — retired. Short-day is judged on presence
                    against the 9-hour requirement, and only once the day is
                    closed, so someone still working is never flagged. */}
                {/* Same rule as the attendance rows: a reason changes WHICH badge
                    the short day gets, never whether it gets one. Reading the
                    reason off the today payload keeps the card and the row for
                    one day from telling two different stories. */}
                {!isLive && shortDaySeconds !== null && (
                  <CheckInStatusBadge
                    status={data.early_checkout_reason ? 'early_explained' : 'early_checkout'}
                    tooltip={checkInBadgeTooltip(
                      data.early_checkout_reason ? 'early_explained' : 'early_checkout',
                      {
                        presenceSeconds: shortDaySeconds,
                        requiredSeconds,
                        earlyReason: data.early_checkout_reason,
                      },
                    )}
                  />
                )}
                {!isLive && data.missing_checkout && (
                  <CheckInStatusBadge status="missing_checkout" tooltip={checkInBadgeTooltip('missing_checkout')} />
                )}
              </div>

              {/* Advisory flags */}
              {(flags.on_approved_leave || flags.worked_on_off_day) && (
                <div className="flex items-center gap-2 mt-0.5">
                  {flags.on_approved_leave && (
                    <CheckInStatusBadge status="on_approved_leave" tooltip={checkInBadgeTooltip('on_approved_leave')} />
                  )}
                  {flags.worked_on_off_day && (
                    <CheckInStatusBadge status="worked_on_off_day" tooltip={checkInBadgeTooltip('worked_on_off_day')} />
                  )}
                </div>
              )}

              {/* Timer */}
              {isLive ? (
                <p className="text-2xl font-bold tabular-nums text-foreground tracking-tight leading-tight mt-0.5" aria-live="off" aria-label="Total time worked today">
                  {liveTotal}
                </p>
              ) : data.sessions_count > 0 ? (
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className="text-2xl font-bold tabular-nums text-foreground tracking-tight leading-tight">{frozenTotal}</span>
                  <span className="text-[0.6rem] text-muted-foreground">today</span>
                </div>
              ) : null}
            </div>
          </div>

          {/* Right: action button */}
          <div className="shrink-0">
            {data.can_check_out ? (
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-4 text-xs border-red-500/30 text-red-500 hover:bg-red-500/10 hover:text-red-600 dark:border-red-500/20 dark:text-red-400 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                disabled={checkOut.isPending}
                onClick={handleCheckOutClick}
              >
                {checkOut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <LogOut className="h-3.5 w-3.5 mr-1.5" />
                )}
                Check Out
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-9 px-4 text-xs"
                disabled={checkIn.isPending || !data.can_check_in}
                onClick={() => checkIn.mutate()}
              >
                {checkIn.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <LogIn className="h-3.5 w-3.5 mr-1.5" />
                )}
                {notCheckedIn ? 'Check In' : 'Check In Again'}
              </Button>
            )}
          </div>
        </div>

        {/* Sessions list */}
        {sessions.length > 0 && (
          <>
            <Separator className="my-3 opacity-50" />
            <ul
              ref={sessionListRef}
              className="flex max-h-28 flex-col gap-1 overflow-y-auto pr-1"
            >
              {sessions.map((session, idx) => (
                <li key={session.seq}>
                  <SessionRow session={session} timezone={timezone} />
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>

    <EarlyCheckoutDialog
      open={earlyCheckout !== null}
      onOpenChange={(open) => !open && setEarlyCheckout(null)}
      shortfallSeconds={earlyCheckout?.shortfall ?? 0}
      requiredSeconds={requiredToday}
      categories={data.early_checkout?.categories}
      approvers={data.early_checkout?.approvers}
      minNoteLength={data.early_checkout?.min_note_length}
      isPending={checkOut.isPending}
      onConfirm={confirmCheckOut}
    />
    </>
  );
}
