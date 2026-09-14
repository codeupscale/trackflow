import { useCallback, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { getEcho } from '@/lib/echo';
import { useAuthStore } from '@/stores/auth-store';

export interface AppNotification {
  id: string;
  /** Machine-readable kind, e.g. 'attendance.checked_in'. Safe to switch on. */
  category: string;
  title: string;
  body: string;
  /** Where clicking it goes. Null when the notification has no destination. */
  url: string | null;
  meta: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface NotificationPage {
  data: AppNotification[];
  meta: {
    current_page: number;
    last_page: number;
    total: number;
    unread_count: number;
  };
}

interface Options {
  /** Show only unread. The panel and the page both offer this as a tab. */
  unread?: boolean;
  perPage?: number;
  page?: number;
  /** Hold the request — e.g. for a user without notifications.view, whose
   *  every fetch would come back 403. */
  enabled?: boolean;
}

/**
 * The page size the bell's panel loads.
 *
 * Exported because the sidebar badge must ask for EXACTLY the same page: the
 * query key includes it, and a badge that asked for a different size would be a
 * second cache entry — a second request, and two numbers that can disagree for
 * the few hundred milliseconds between their refetches.
 */
export const BELL_PAGE_SIZE = 20;

/**
 * The bell's data.
 *
 * Polls on a slow interval as a SAFETY NET, not as the delivery mechanism —
 * live arrival comes over Reverb (see useNotificationStream). A minute is long
 * enough to be nearly free, and short enough that a websocket that dropped
 * silently still self-heals without a page reload.
 */
export function useNotifications(options: Options = {}) {
  const { unread = false, perPage = 15, page = 1, enabled = true } = options;
  const userId = useAuthStore((s) => s.user?.id);

  return useQuery<NotificationPage>({
    // The USER is part of the key, and that is the whole fix for one person
    // seeing another's bell. Logging out does not empty the query cache, so
    // with a key of just ['notifications', …] the next person to sign in on
    // the same tab was handed the previous person's list from memory — the
    // owner's eighteen org-activity rows rendered straight into an employee's
    // panel — until a refetch happened to replace it. The API was right the
    // whole time; the cache was answering a question for the wrong user.
    queryKey: ['notifications', userId, { unread, perPage, page }],
    enabled: !!userId && enabled,
    queryFn: async () => {
      const res = await api.get('/notifications', {
        params: {
          ...(unread ? { unread: 1 } : {}),
          per_page: perPage,
          page,
        },
      });

      return res.data;
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * The unread count, for anything that shows it outside the panel.
 *
 * Reads the bell's own query — same key, same page size — so the sidebar badge
 * and the header bell are ONE number from one source. They update in the same
 * render when a notification arrives or everything is marked read, and cannot
 * drift apart. TanStack dedupes the request: mounting both costs one fetch.
 */
export function useUnreadNotificationCount(enabled = true): number {
  const { data } = useNotifications({ perPage: BELL_PAGE_SIZE, enabled });

  return data?.meta.unread_count ?? 0;
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/notifications/${id}/read`);

      return res.data;
    },
    // Deliberately silent — no toast. Reading a notification is not an event
    // worth announcing with another notification.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await api.post('/notifications/read-all');

      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useDeleteNotification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.delete(`/notifications/${id}`);

      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

/**
 * Live arrival over Reverb.
 *
 * Laravel broadcasts notifications on the private `App.Models.User.{id}`
 * channel, which routes/channels.php already authorizes. We do not merge the
 * pushed payload into the cache by hand — we invalidate and let the query
 * refetch, so the list has exactly one shape and one source. The websocket
 * says "something changed"; the API still says what.
 *
 * Mounted ONCE, in the dashboard layout. Mounting it per-component would open
 * a subscription per bell and deliver the same notification several times.
 */
export function useNotificationStream(enabled = true) {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);

  const onArrival = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }, [queryClient]);

  useEffect(() => {
    if (!userId || !enabled) return;

    let channel: ReturnType<ReturnType<typeof getEcho>['private']> | null = null;

    try {
      const echo = getEcho();
      if (!echo) return;

      channel = echo.private(`App.Models.User.${userId}`);
      channel.notification(onArrival);
    } catch {
      // Reverb unreachable, or running without websocket config. The polling
      // interval above still delivers, a minute later — degraded, not broken.
      return;
    }

    return () => {
      try {
        getEcho()?.leave(`App.Models.User.${userId}`);
      } catch {
        /* already gone */
      }
    };
  }, [userId, enabled, onArrival]);
}

export interface NotificationPreferenceGroup {
  key: string;
  label: string;
  description: string;
  /** 'org' groups are only returned to people who receive org activity. */
  audience: 'org' | 'personal';
  muted: boolean;
}

/**
 * The groups this person can mute. The server only returns groups that apply
 * to the caller, so the screen never offers a switch that would change nothing.
 */
export function useNotificationPreferences(enabled = true) {
  const userId = useAuthStore((s) => s.user?.id);

  return useQuery<NotificationPreferenceGroup[]>({
    queryKey: ['notification-preferences', userId],
    queryFn: async () => {
      const res = await api.get('/notifications/preferences');

      return res.data.data;
    },
    enabled: !!userId && enabled,
  });
}

/**
 * Save the full muted list.
 *
 * Optimistic: a switch that waits for the round trip before moving feels
 * broken. The cache is updated at once and rolled back if the save fails, so
 * the switch never shows a state the server did not accept.
 */
export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);
  const key = ['notification-preferences', userId];

  return useMutation({
    mutationFn: async (muted: string[]) => {
      const res = await api.put('/notifications/preferences', { muted });

      return res.data.data as NotificationPreferenceGroup[];
    },
    onMutate: async (muted) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<NotificationPreferenceGroup[]>(key);

      queryClient.setQueryData<NotificationPreferenceGroup[]>(key, (groups) =>
        groups?.map((g) => ({ ...g, muted: muted.includes(g.key) })),
      );

      return { previous };
    },
    onError: (_err, _muted, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSuccess: (groups) => {
      queryClient.setQueryData(key, groups);
    },
  });
}
