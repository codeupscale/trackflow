'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';

export function useAuthGuard() {
  const router = useRouter();
  const { isAuthenticated, fetchUser } = useAuthStore();

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
    if (!token) {
      router.push('/login');
      return;
    }
    if (!isAuthenticated) {
      fetchUser().catch((err) => {
        const status = err?.response?.status;
        if (status === 401 || status === 403) {
          router.push('/login');
        }
        // Network errors: do nothing, user stays on page and can retry
      });
    }
  }, [isAuthenticated, fetchUser, router]);

  return { isAuthenticated };
}
