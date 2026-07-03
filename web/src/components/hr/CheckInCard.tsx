'use client';

import { useEffect, useRef, useState } from 'react';
import { Clock, LogIn, LogOut, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckInStatusBadge } from '@/components/hr/CheckInStatusBadge';
import { useTodayStatus, useCheckIn, useCheckOut } from '@/hooks/hr/use-check-in';
import {
  computeClockOffset,
  elapsedSeconds,
  formatElapsed,
} from '@/lib/check-in-time';
import { cn } from '@/lib/utils';

// Format a UTC ISO instant as a wall-clock time in the org policy timezone.
// Falls back to the browser locale time if the timezone is invalid/unknown.
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

export function CheckInCard({ className }: { className?: string }) {
  const { data, isLoading, isError } = useTodayStatus();
  const checkIn = useCheckIn();
  const checkOut = useCheckOut();

  // Mounted guard: never read wall-clock time during SSR / first render, so the
  // live clock can't cause a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Clock skew between server and client. Recomputed whenever a fresh server_now
  // arrives (initial load + window-focus refetch), so the elapsed clock re-anchors
  // instead of drifting.
  const offsetRef = useRef(0);
  useEffect(() => {
    if (data?.server_now) {
      offsetRef.current = computeClockOffset(data.server_now, Date.now());
    }
  }, [data?.server_now]);

  const isLive = Boolean(data?.checked_in && !data?.checked_out);

  // The interval ONLY forces a re-render. Elapsed is derived from wall-clock on
  // every render (below) — a slow or dropped tick can never accumulate drift.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => forceTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isLive]);

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-11 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center gap-3 py-6">
          <AlertTriangle className="size-5 text-destructive shrink-0" />
          <p className="text-sm text-muted-foreground">
            Failed to load your check-in status. Please refresh.
          </p>
        </CardContent>
      </Card>
    );
  }

  const timezone = data.policy?.timezone ?? 'UTC';
  const flags = data.check_in_flags ?? {};

  // Live elapsed (checked in, not out) is derived; after checkout we show the
  // server's frozen worked_hhmm. Before mount we render a stable placeholder.
  const liveElapsed =
    mounted && isLive
      ? formatElapsed(elapsedSeconds(data.check_in_at, offsetRef.current, Date.now()))
      : '00:00:00';

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="size-4 text-muted-foreground" />
          Attendance
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Status line */}
        <div className="flex flex-col gap-2">
          {!data.checked_in ? (
            <p className="text-sm text-muted-foreground">
              You haven&apos;t checked in today.
            </p>
          ) : data.checked_out ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-foreground">
                Checked in at{' '}
                <span className="font-medium tabular-nums">
                  {formatClockTime(data.check_in_at, timezone)}
                </span>
                {data.check_out_at && (
                  <>
                    {' '}
                    · out at{' '}
                    <span className="font-medium tabular-nums">
                      {formatClockTime(data.check_out_at, timezone)}
                    </span>
                  </>
                )}
              </span>
              {data.check_in_status === 'late' && (
                <CheckInStatusBadge status="late" />
              )}
              {data.is_early_checkout && (
                <CheckInStatusBadge status="early_checkout" />
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-foreground">
                Checked in at{' '}
                <span className="font-medium tabular-nums">
                  {formatClockTime(data.check_in_at, timezone)}
                </span>
              </span>
              {data.check_in_status === 'late' && (
                <CheckInStatusBadge status="late" />
              )}
            </div>
          )}

          {/* Advisory / warning flags */}
          {(flags.on_approved_leave ||
            flags.worked_on_off_day ||
            data.missing_checkout) && (
            <div className="flex flex-wrap items-center gap-2">
              {flags.on_approved_leave && (
                <CheckInStatusBadge status="on_approved_leave" />
              )}
              {flags.worked_on_off_day && (
                <CheckInStatusBadge status="worked_on_off_day" />
              )}
              {data.missing_checkout && (
                <CheckInStatusBadge status="missing_checkout" />
              )}
            </div>
          )}
        </div>

        {/* Live elapsed clock (only while an open session is running) */}
        {isLive && (
          <div
            className="text-3xl font-bold tabular-nums text-foreground"
            aria-live="off"
            aria-label="Elapsed time since check-in"
          >
            {liveElapsed}
          </div>
        )}

        {/* Frozen worked total after checkout */}
        {data.checked_out && data.worked_hhmm && (
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums text-foreground">
              {data.worked_hhmm}
            </span>
            <span className="text-xs text-muted-foreground">worked</span>
          </div>
        )}

        {/* Primary action */}
        {!data.checked_in ? (
          <Button
            size="lg"
            className="w-full"
            disabled={checkIn.isPending}
            onClick={() => checkIn.mutate()}
          >
            {checkIn.isPending ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <LogIn data-icon="inline-start" />
            )}
            Check In
          </Button>
        ) : !data.checked_out ? (
          <Button
            size="lg"
            variant="destructive"
            className="w-full"
            disabled={checkOut.isPending}
            onClick={() => checkOut.mutate()}
          >
            {checkOut.isPending ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <LogOut data-icon="inline-start" />
            )}
            Check Out
          </Button>
        ) : (
          <Button
            size="lg"
            variant="outline"
            className={cn('w-full', 'pointer-events-none')}
            disabled
          >
            <CheckCircle2 data-icon="inline-start" />
            Completed for today
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
