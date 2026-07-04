'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getEcho } from '@/lib/echo';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Payload broadcast by the backend `ScreenshotUploaded` Reverb event, fired once
 * a screenshot has been fully processed.
 *
 * Mirrors the `TimerStarted` convention: broadcast on the private `org.{id}`
 * channel, listened to as `ScreenshotUploaded` (no leading dot, no broadcastAs).
 *
 * SECURITY: the payload is intentionally minimal. This is an org-wide channel, so
 * broadcasting the signed `thumbnail_url`/`url` or metadata like `window_title`/
 * `app_name` would leak other users' screenshot content to employee-role
 * subscribers. Those fields were removed — the client only uses this event as a
 * signal to refetch the role-scoped REST index (`GET /screenshots`), which
 * re-derives every visible field with proper per-viewer authorization.
 */
export interface ScreenshotUploadedEvent {
  /** Screenshot identifier (used only as an optional signal; not read at runtime). */
  screenshot_id: number | string;
  /** Owner of the screenshot — the ONLY field read at runtime, for role scoping. */
  user_id: number | string;
}

interface ScreenshotViewer {
  id: string;
  role: string;
}

/** The Echo instance type returned by getEcho(). */
type Echo = ReturnType<typeof getEcho>;

/**
 * Decides whether a broadcast screenshot event is relevant to the current viewer,
 * mirroring the REST index role scoping: the channel is org-wide (managers/admins
 * legitimately see the whole team live), but an employee must only ever see their
 * own screenshots. Exported for unit testing.
 */
export function shouldRefetchForScreenshot(
  event: Pick<ScreenshotUploadedEvent, 'user_id'>,
  viewer: ScreenshotViewer | null | undefined,
): boolean {
  if (!viewer) return false;
  // Employees are scoped to their own screenshots only (same as GET /screenshots).
  // Coerce to string: the broadcast user_id may be numeric while the viewer id is
  // always a string UUID, and a bare !== would then never match an employee's own id.
  if (viewer.role === 'employee' && String(event.user_id) !== viewer.id) {
    return false;
  }
  return true;
}

/**
 * Subscribes to the org-wide `ScreenshotUploaded` Reverb event and refreshes the
 * screenshots list in real time, so newly captured screenshots appear without a
 * manual browser refresh.
 *
 * Lifecycle mirrors the timer store's `TimerStarted` subscription:
 * - SSR-safe (`typeof window` guard, plus `getEcho()` returns null on the server).
 * - Subscribes on mount, removes only *this* listener on unmount. The `org.{id}`
 *   channel is shared with the timer store, so we `stopListening` our own handler
 *   rather than `echo.leave()`-ing the whole channel.
 * - Stable effect deps (orgId / userId / role) prevent duplicate re-subscription
 *   on re-render.
 *
 * Cache strategy: invalidate the `['screenshots']` query so it refetches with the
 * page's *current* filters and pagination (date range, member, project). This is
 * the robust, filter-respecting approach per CLAUDE.md — the hourly-grouped,
 * paginated, multi-filter list makes a manual page-1 prepend error-prone.
 */
export function useScreenshotRealtime(): void {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const orgId = user?.organization_id;
  const userId = user?.id;
  const role = user?.role;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!orgId) return;

    let channel: ReturnType<Echo['private']> | null = null;

    const handler = (event: ScreenshotUploadedEvent) => {
      const viewer = userId && role ? { id: userId, role } : null;
      if (!shouldRefetchForScreenshot(event, viewer)) return;
      // Refetches the active query with its current filters/pagination.
      queryClient.invalidateQueries({ queryKey: ['screenshots'] });
    };

    try {
      const echo = getEcho();
      if (!echo) return;
      channel = echo.private(`org.${orgId}`);
      channel.listen('ScreenshotUploaded', handler);
    } catch {
      // Real-time is best-effort; the list still refetches on window focus /
      // interval, so a websocket failure must never break the page.
    }

    return () => {
      // Remove ONLY our listener — the `org.{id}` channel is shared with the
      // timer store's TimerStarted/TimerStopped subscription, so never leave it.
      try {
        channel?.stopListening('ScreenshotUploaded', handler);
      } catch {
        // Ignore cleanup errors.
      }
    };
  }, [orgId, userId, role, queryClient]);
}
