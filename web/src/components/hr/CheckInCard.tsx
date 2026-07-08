'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Clock, LogIn, LogOut, AlertTriangle, Loader2, Info } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { CheckInStatusBadge } from '@/components/hr/CheckInStatusBadge';
import { useTodayStatus, useCheckIn, useCheckOut } from '@/hooks/hr/use-check-in';
import { useTimerStore } from '@/stores/timer-store';
import {
  computeClockOffset,
  elapsedSeconds,
  formatElapsed,
  formatDuration,
  checkInBadgeTooltip,
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

// The project's shared `destructive` Button variant is a SOFT tint
// (`bg-destructive/10 text-destructive`) — as a large primary CTA it reads as
// disabled. For the Check Out action we want a strong, unmistakably-clickable
// solid fill. This mirrors shadcn's canonical solid-destructive recipe: in dark
// mode `--destructive` is a light coral, so `dark:bg-destructive/60` composites
// it darker and keeps the white label at AA contrast.
const CHECK_OUT_BUTTON_CLASSES =
  'w-full bg-destructive text-white shadow-xs hover:bg-destructive/90 ' +
  'focus-visible:ring-destructive/30 dark:bg-destructive/60 dark:hover:bg-destructive/70';

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

  const actionButton = data.can_check_out ? (
    <Button
      size="lg"
      variant="destructive"
      className={CHECK_OUT_BUTTON_CLASSES}
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
  );

  return (
    // `@container` scopes the two-region breakpoint to the CARD's own width, not
    // the viewport — the card renders in a narrow dashboard slot and a wider HR
    // page, so a viewport `md:` would wrongly split the layout when the card is
    // narrow. Below `@lg` (~512px) the regions stack (button full-width, mobile-safe).
    <Card className={cn('@container/checkin', className)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="size-4 text-muted-foreground" />
          Attendance
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Tracker warning sits ABOVE the two-region row so it never competes for
            flex width with the status text / Check In button (that caused the
            "You haven't checked in today." label to collapse to a character column). */}
        {isTimerRunning && !data.has_open_session && data.can_check_in && (
          <Alert className="border-amber-500/40 bg-amber-500/5">
            <Info className="size-4 text-amber-600" />
            <AlertDescription className="text-sm text-muted-foreground">
              The desktop time tracker is running, but you are not checked in for
              attendance. Check in here when you start work — stopping the tracker
              does not check you out.
            </AlertDescription>
          </Alert>
        )}

        {/* Two-region body: status/total/sessions | action. `@container` scopes the
            breakpoint to the card width so a narrow dashboard slot still stacks. */}
        <div className="flex flex-col gap-4 @lg/checkin:flex-row @lg/checkin:items-stretch @lg/checkin:gap-6">
          {/* LEFT region: status line, day total, session list */}
          <div className="flex min-w-0 flex-1 flex-col gap-4">
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
                  {/* Day-level check-in signal badges (first check-in / last checkout).
                      Each carries a tooltip that converts the raw minute count into
                      "Xh Ym" and anchors it to the org policy time. */}
                  {data.check_in_status === 'late' && (
                    <CheckInStatusBadge
                      status="late"
                      tooltip={checkInBadgeTooltip('late', {
                        lateMinutes: data.check_in_late_minutes,
                        checkInTime: data.policy?.check_in_time,
                      })}
                    />
                  )}
                  {!isLive && data.is_early_checkout && (
                    <CheckInStatusBadge
                      status="early_checkout"
                      tooltip={checkInBadgeTooltip('early_checkout', {
                        earlyMinutes: data.check_out_early_minutes,
                        checkoutTime: data.policy?.checkout_time,
                      })}
                    />
                  )}
                  {!isLive && data.missing_checkout && (
                    <CheckInStatusBadge
                      status="missing_checkout"
                      tooltip={checkInBadgeTooltip('missing_checkout')}
                    />
                  )}
                </div>
              )}

              {/* Advisory / warning flags */}
              {(flags.on_approved_leave || flags.worked_on_off_day) && (
                <div className="flex flex-wrap items-center gap-2">
                  {flags.on_approved_leave && (
                    <CheckInStatusBadge
                      status="on_approved_leave"
                      tooltip={checkInBadgeTooltip('on_approved_leave')}
                    />
                  )}
                  {flags.worked_on_off_day && (
                    <CheckInStatusBadge
                      status="worked_on_off_day"
                      tooltip={checkInBadgeTooltip('worked_on_off_day')}
                    />
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
          </div>

          {/* RIGHT region: the primary action, visually separated from the session
              list and vertically centred. On @lg+ it sits in its own column with a
              divider; below that it stacks under the list as a full-width button. */}
          <div className="flex flex-col justify-center @lg/checkin:w-52 @lg/checkin:shrink-0 @lg/checkin:border-l @lg/checkin:border-border @lg/checkin:pl-6">
            {actionButton}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
