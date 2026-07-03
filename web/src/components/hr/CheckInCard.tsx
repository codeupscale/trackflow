'use client';

import { useEffect, useRef, useState } from 'react';
import { Clock, LogIn, LogOut, AlertTriangle, Loader2 } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckInStatusBadge } from '@/components/hr/CheckInStatusBadge';
import { useTodayStatus, useCheckIn, useCheckOut } from '@/hooks/hr/use-check-in';
import {
  computeClockOffset,
  elapsedSeconds,
  formatElapsed,
  formatDuration,
} from '@/lib/check-in-time';
import type { CheckInSessionRow } from '@/lib/validations/attendance';

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

// One line per session. Closed: "#1  11:40 AM → 2:34 PM · 2h 54m".
// Open:            "#2  3:00 PM → in progress".
function SessionRow({
  session,
  timezone,
}: {
  session: CheckInSessionRow;
  timezone: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground tabular-nums">#{session.seq}</span>
      <span className="tabular-nums">
        {formatClockTime(session.check_in_at, timezone)}
      </span>
      <span aria-hidden>→</span>
      {session.is_open ? (
        <span className="italic">in progress</span>
      ) : (
        <>
          <span className="tabular-nums">
            {formatClockTime(session.check_out_at, timezone)}
          </span>
          <span aria-hidden>·</span>
          <span className="font-medium text-foreground tabular-nums">
            {formatDuration(session.worked_seconds)}
          </span>
        </>
      )}
    </div>
  );
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

  const isLive = Boolean(data?.has_open_session);

  // The interval ONLY forces a re-render. Elapsed is derived from wall-clock on
  // every render (below) — a slow or dropped tick can never accumulate drift.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => forceTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isLive]);

  // The session list is capped (~5 rows) and scrolls. Sessions render oldest-first
  // (#1 at top), so pin the scroll to the bottom whenever a session is added or the
  // open/closed state flips — keeping the most recent / open session visible by default.
  const sessionListRef = useRef<HTMLUListElement>(null);
  const sessionsCount = data?.sessions?.length ?? 0;
  useEffect(() => {
    const el = sessionListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sessionsCount, isLive]);

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
  const sessions = data.sessions ?? [];

  // ── State machine ──────────────────────────────────────────────────
  // not_checked_in : sessions_count === 0
  // live           : has_open_session
  // idle_can_recheck : sessions_count > 0 && !has_open_session
  // Transitions loop: not_checked_in → live → idle_can_recheck → live → …
  // Next org-local day → payload returns sessions_count 0 → not_checked_in.
  const notCheckedIn = data.sessions_count === 0;

  // Day-total LIVE ticker (HH:MM:SS). Derived every render from closed sessions +
  // the currently-open session's elapsed — NEVER an accumulating counter. Before
  // mount we render a stable placeholder to avoid hydration mismatch.
  const tickerSeconds =
    data.closed_worked_seconds +
    elapsedSeconds(data.open_check_in_at, offsetRef.current, Date.now());
  const liveTotal = mounted && isLive ? formatElapsed(tickerSeconds) : '00:00:00';

  // Frozen day total after checkout — unambiguous "Xh Ym" scheme (not a clock).
  const frozenTotal = formatDuration(data.worked_seconds);

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
          {notCheckedIn ? (
            <p className="text-sm text-muted-foreground">
              You haven&apos;t checked in today.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-foreground">
                {isLive ? 'Currently checked in' : 'Checked out'}
                {' · '}
                <span className="tabular-nums">
                  {data.sessions_count}{' '}
                  {data.sessions_count === 1 ? 'session' : 'sessions'}
                </span>
              </span>
              {/* Day-level check-in signal badges (first check-in / last checkout). */}
              {data.check_in_status === 'late' && (
                <CheckInStatusBadge status="late" />
              )}
              {!isLive && data.is_early_checkout && (
                <CheckInStatusBadge status="early_checkout" />
              )}
              {!isLive && data.missing_checkout && (
                <CheckInStatusBadge status="missing_checkout" />
              )}
            </div>
          )}

          {/* Advisory / warning flags */}
          {(flags.on_approved_leave || flags.worked_on_off_day) && (
            <div className="flex flex-wrap items-center gap-2">
              {flags.on_approved_leave && (
                <CheckInStatusBadge status="on_approved_leave" />
              )}
              {flags.worked_on_off_day && (
                <CheckInStatusBadge status="worked_on_off_day" />
              )}
            </div>
          )}
        </div>

        {/* Day total — LIVE ticker (HH:MM:SS) while a session is open, otherwise
            the frozen total as "Xh Ym". One consistent scheme: clock while live,
            duration when idle. */}
        {isLive ? (
          <div
            className="text-3xl font-bold tabular-nums text-foreground"
            aria-live="off"
            aria-label="Total time worked today"
          >
            {liveTotal}
          </div>
        ) : (
          data.sessions_count > 0 && (
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums text-foreground">
                {frozenTotal}
              </span>
              <span className="text-xs text-muted-foreground">worked today</span>
            </div>
          )
        )}

        {/* Session list (live + idle_can_recheck). Capped at ~5 rows; scrolls
            (pinned to bottom so the newest / open session is visible by default). */}
        {sessions.length > 0 && (
          <ul
            ref={sessionListRef}
            className="flex max-h-40 flex-col gap-1.5 overflow-y-auto pr-1"
          >
            {sessions.map((session, idx) => (
              <li key={session.seq} className="flex flex-col gap-1.5">
                {idx > 0 && <Separator />}
                <SessionRow session={session} timezone={timezone} />
              </li>
            ))}
          </ul>
        )}

        {/* Primary action */}
        {data.can_check_out ? (
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
            className="w-full"
            disabled={checkIn.isPending || !data.can_check_in}
            onClick={() => checkIn.mutate()}
          >
            {checkIn.isPending ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <LogIn data-icon="inline-start" />
            )}
            {notCheckedIn ? 'Check In' : 'Check In again'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
