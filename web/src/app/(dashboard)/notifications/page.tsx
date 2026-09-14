'use client';

import { useState } from 'react';
import { Bell, BellOff, CheckCheck, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useDeleteNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from '@/hooks/use-notifications';
import { NotificationItem } from '@/components/notifications/NotificationItem';
import { NotificationPreferences } from '@/components/notifications/NotificationPreferences';

type Filter = 'all' | 'unread' | 'preferences';

const PER_PAGE = 25;

/**
 * The full history, paged.
 *
 * The panel in the navbar is for triage — the newest few, acted on and
 * dismissed. This page is where someone goes to find the notification they
 * remember seeing last Tuesday, so it pages rather than truncating.
 *
 * No permission gate: a notification is addressed to a user, and the API only
 * ever returns that user's own rows. Every role has this page.
 */
export default function NotificationsPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);

  const showingPreferences = filter === 'preferences';

  const { data, isLoading, isError } = useNotifications({
    unread: filter === 'unread',
    perPage: PER_PAGE,
    page,
  });

  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const remove = useDeleteNotification();

  const notifications = data?.data ?? [];
  const unreadCount = data?.meta.unread_count ?? 0;
  const lastPage = data?.meta.last_page ?? 1;
  const total = data?.meta.total ?? 0;

  const changeFilter = (next: Filter) => {
    setFilter(next);
    // Page 3 of "all" is rarely page 3 of "unread", and landing on an empty
    // page reads as "nothing here" rather than "you moved".
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Notifications</h1>
          <p className="text-xs text-muted-foreground">
            {unreadCount > 0
              ? `${unreadCount} unread of ${total}`
              : `${total} ${total === 1 ? 'notification' : 'notifications'}`}
          </p>
        </div>

        {!showingPreferences && unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending}
          >
            {markAll.isPending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCheck className="mr-1 h-3.5 w-3.5" />
            )}
            Mark all as read
          </Button>
        )}
      </div>

      <Tabs value={filter} onValueChange={(v) => changeFilter((v as Filter) ?? 'all')}>
        <TabsList>
          <TabsTrigger value="all" className="text-xs">
            All
          </TabsTrigger>
          <TabsTrigger value="unread" className="text-xs">
            Unread{unreadCount > 0 ? ` (${unreadCount})` : ''}
          </TabsTrigger>
          {/* Settings live beside the list rather than on a separate page: the
              moment someone decides a category is noise is the moment they
              are looking at it. */}
          <TabsTrigger value="preferences" className="text-xs">
            Preferences
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {showingPreferences && <NotificationPreferences />}

      {showingPreferences ? null : isError ? (
        <Card className="border-destructive/50">
          <CardContent className="py-12">
            <div className="flex flex-col items-center gap-2 text-center">
              <BellOff className="h-8 w-8 text-destructive/60" />
              <p className="text-sm font-medium text-muted-foreground">
                Failed to load notifications
              </p>
              <p className="text-xs text-muted-foreground">Please try again later.</p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-0">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-3 border-b border-border/50 px-4 py-3 last:border-0">
                <div className="h-8 w-8 shrink-0 animate-pulse rounded-lg bg-muted" />
                <div className="flex-1 space-y-2 py-0.5">
                  <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                  <div className="h-2.5 w-2/3 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : notifications.length === 0 ? (
        <Card>
          <CardContent className="py-16">
            <div className="flex flex-col items-center gap-2 text-center">
              <Bell className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm font-medium text-muted-foreground">
                {filter === 'unread' ? 'Nothing unread' : 'No notifications yet'}
              </p>
              <p className="text-xs text-muted-foreground">
                {filter === 'unread'
                  ? 'Everything here has been read.'
                  : 'Check-ins, payslips and approvals will appear here.'}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-border/60">
              {notifications.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onRead={(id) => markRead.mutate(id)}
                  onDelete={(id) => remove.mutate(id)}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {!showingPreferences && lastPage > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-[0.7rem] text-muted-foreground tabular-nums">
            Page {page} of {lastPage}
          </p>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[0.7rem]"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="mr-0.5 h-3.5 w-3.5" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[0.7rem]"
              disabled={page >= lastPage}
              onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
            >
              Next
              <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
