import { useEffect } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Empty the query cache whenever the signed-in USER changes.
 *
 * Every screen caches under keys that do not include who is asking —
 * ['payslips', …], ['employees', …], ['dashboard'] — so the cache is only safe
 * while one person is using the tab. Logging out navigates inside the app
 * rather than reloading it, so the cache survived: the next person to sign in
 * on the same tab was served the previous person's data from memory until each
 * query happened to refetch. The notification bell showed it first, because
 * owner and employee see very different lists, but every screen had the bug.
 *
 * Keyed on the user id rather than hooked into logout(), because logout is only
 * one of the ways the user changes. Signing straight in as someone else, or a
 * path added later, is covered without anyone remembering to call clear().
 *
 * Deliberately NOT cleared on:
 *  - the first load, going from "no user yet" to the stored user — that is the
 *    same person the cache (empty on load anyway) belongs to;
 *  - a refresh of the same user's profile, where the object changes but the id
 *    does not. Clearing then would blank every screen after each /auth/me.
 */
export function useClearCacheOnUserChange(queryClient: QueryClient): void {
  useEffect(() => {
    let previous = useAuthStore.getState().user?.id ?? null;

    return useAuthStore.subscribe((state) => {
      const next = state.user?.id ?? null;

      if (next === previous) return;

      // Leaving a known user — to nobody (logout) or to a different person.
      if (previous !== null) {
        queryClient.clear();
      }

      previous = next;
    });
  }, [queryClient]);
}
