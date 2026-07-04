'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';

export function useAuthGuard() {
  const router = useRouter();
  const { isAuthenticated, fetchUser } = useAuthStore(); // isAuthenticated used for return value only

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
    if (!token) {
      router.push('/login');
      return;
    }
    // Always refresh user + permissions from the server on mount so the
    // persisted Zustand store never serves stale permission data.
    fetchUser().catch((err) => {
      const status = err?.response?.status;
      if (status === 401 || status === 403) {
        router.push('/login');
      }
      // Network errors: do nothing, user stays on page and can retry
    });
  }, [fetchUser, router]);

  return { isAuthenticated };
}
