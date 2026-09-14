'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, BellOff, CheckCheck, Loader2, Volume2, VolumeX, X } from 'lucide-react';

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  BELL_PAGE_SIZE,
  useDeleteNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from '@/hooks/use-notifications';
import {
  isNotificationSoundMuted,
  playNotificationChime,
  setNotificationSoundMuted,
} from '@/lib/notification-sound';
import { NotificationItem } from './NotificationItem';

type Filter = 'all' | 'unread';

/**
 * The bell in the navbar, and the panel it opens.
 *
 * The panel is a right-hand Sheet rather than a dropdown: notifications are a
 * list people scan and act on one by one, and a dropdown that closes on the
 * first outside click makes "read three of these" take three openings.
 *
 * Only the first page is loaded here — the panel is for triage, and the full
 * page at /notifications is for history.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const { data, isLoading, isError } = useNotifications({
    unread: filter === 'unread',
    perPage: BELL_PAGE_SIZE,
  });

  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const remove = useDeleteNotification();

  const notifications = data?.data ?? [];
  const unreadCount = data?.meta.unread_count ?? 0;

  // ── Arrival: ring and shake ──────────────────────────────────────────
  //
  // Driven by the unread COUNT rising, not by the websocket callback, so it
  // fires whichever way the notification reached us — the Reverb push or the
  // 60s poll that covers a dropped socket. One signal, one place.
  //
  // `previous` starts null and the first reading only seeds it: arriving on a
  // page with eleven unread notifications is not eleven arrivals, and greeting
  // someone with a chime for mail they already had is how a sound gets muted
  // on day one. A count going DOWN is a read, never an arrival.
  const previousUnread = useRef<number | null>(null);
  const [ringing, setRinging] = useState(false);
  const [muted, setMuted] = useState(false);

  // Read after mount: localStorage during render makes server and client
  // markup disagree and React throws the tree away.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMuted(isNotificationSoundMuted());
  }, []);

  useEffect(() => {
    if (data === undefined) return;

    const previous = previousUnread.current;
    previousUnread.current = unreadCount;

    if (previous === null || unreadCount <= previous) return;

    playNotificationChime();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRinging(true);
  }, [data, unreadCount]);

  // The shake is one pass, then off — leaving the class on would animate again
  // on any unrelated re-render.
  useEffect(() => {
    if (!ringing) return;

    const timer = setTimeout(() => setRinging(false), 900);

    return () => clearTimeout(timer);
  }, [ringing]);

  const toggleMuted = () => {
    const next = !muted;
    setMuted(next);
    setNotificationSoundMuted(next);
    // Play on UNMUTE so the choice is audible immediately — a silent toggle
    // gives no way to tell it worked without waiting for a notification.
    if (!next) playNotificationChime();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        className="relative flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Bell
          className={cn(
            'h-[1.05rem] w-[1.05rem] origin-top',
            ringing && 'animate-bell-ring text-foreground',
          )}
        />
        {unreadCount > 0 && (
          <span
            className={cn(
              'absolute -right-0.5 -top-0.5 flex items-center justify-center rounded-full bg-orange-500 font-bold text-white tabular-nums ring-2 ring-card',
              ringing && 'animate-badge-pop',
              // A count past 99 would stretch the badge wider than the bell.
              unreadCount > 9 ? 'h-4 min-w-4 px-1 text-[0.55rem]' : 'h-3.5 w-3.5 text-[0.55rem]',
            )}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
        >
          <SheetHeader className="border-b border-border px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <SheetTitle className="text-sm font-semibold">Notifications</SheetTitle>
                <SheetDescription className="text-[0.7rem]">
                  {unreadCount > 0
                    ? `${unreadCount} unread`
                    : 'You are all caught up'}
                </SheetDescription>
              </div>

              <div className="flex shrink-0 items-center gap-0.5">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={() => markAll.mutate()}
                    disabled={markAll.isPending}
                    aria-label="Mark all as read"
                    title="Mark all as read"
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    {markAll.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCheck className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}

                <button
                  type="button"
                  onClick={toggleMuted}
                  aria-pressed={muted}
                  aria-label={muted ? 'Unmute notification sound' : 'Mute notification sound'}
                  title={muted ? 'Sound off' : 'Sound on'}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                </button>

                {/* A separator earns its place here: the first two act ON the
                    notifications, the last one dismisses the panel. */}
                <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />

                <SheetClose
                  render={
                    <button
                      type="button"
                      aria-label="Close notifications"
                      title="Close"
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    />
                  }
                >
                  <X className="h-3.5 w-3.5" />
                </SheetClose>
              </div>
            </div>

            {/* Two filters, as a segmented control rather than a dropdown —
                with only two options a menu costs an extra click to show what
                would fit on screen anyway. */}
            <div className="mt-2 flex w-fit items-center gap-1 rounded-lg bg-muted p-0.5">
              {(['all', 'unread'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  aria-pressed={filter === key}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-[0.7rem] font-medium capitalize transition-colors',
                    filter === key
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {key}
                  {key === 'unread' && unreadCount > 0 ? ` (${unreadCount})` : ''}
                </button>
              ))}
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex flex-col">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex gap-3 px-4 py-3">
                    <div className="h-8 w-8 shrink-0 animate-pulse rounded-lg bg-muted" />
                    <div className="flex-1 space-y-2 py-0.5">
                      <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
                      <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted" />
                    </div>
                  </div>
                ))}
              </div>
            ) : isError ? (
              <div className="flex flex-col items-center gap-1.5 px-6 py-16 text-center">
                <BellOff className="h-7 w-7 text-destructive/50" />
                <p className="text-sm font-medium text-foreground">
                  Could not load notifications
                </p>
                <p className="text-xs text-muted-foreground">
                  Check your connection and try again.
                </p>
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 px-6 py-16 text-center">
                <Bell className="h-7 w-7 text-muted-foreground/40" />
                <p className="text-sm font-medium text-foreground">
                  {filter === 'unread' ? 'Nothing unread' : 'No notifications yet'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {filter === 'unread'
                    ? 'Everything here has been read.'
                    : 'Check-ins, payslips and approvals will appear here.'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {notifications.map((n) => (
                  <NotificationItem
                    key={n.id}
                    notification={n}
                    onRead={(id) => markRead.mutate(id)}
                    onDelete={(id) => remove.mutate(id)}
                    onNavigate={() => setOpen(false)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-border p-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-full text-[0.72rem]"
              nativeButton={false}
              render={<Link href="/notifications" />}
              onClick={() => setOpen(false)}
            >
              View all notifications
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
