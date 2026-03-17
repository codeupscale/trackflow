'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import api from '@/lib/api';

function AutoLoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setUser } = useAuthStore();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get('token');
    const refresh = searchParams.get('refresh');
    const redirect = searchParams.get('redirect') || '/dashboard';

    if (!token) {
      // No token in URL — check if already logged in
      const existingToken = localStorage.getItem('access_token');
      if (existingToken) {
        router.replace(redirect);
      } else {
        router.replace('/login');
      }
      return;
    }

    // Store tokens
    localStorage.setItem('access_token', token);
    if (refresh) {
      localStorage.setItem('refresh_token', refresh);
    }

    // Validate token and fetch user
    api.get('/auth/me')
      .then((res) => {
        setUser(res.data.user);
        // Clean URL (remove tokens from browser history)
        router.replace(redirect);
      })
      .catch(() => {
        // Token is invalid
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        setError('Session expired. Redirecting to login...');
        setTimeout(() => router.replace('/login'), 2000);
      });
  }, [searchParams, router, setUser]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <div className="flex items-center gap-2 text-slate-400">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-blue-500" />
        Opening dashboard...
      </div>
    </div>
  );
}

export default function AutoLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-950">
          <div className="flex items-center gap-2 text-slate-400">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-blue-500" />
            Loading...
          </div>
        </div>
      }
    >
      <AutoLoginContent />
    </Suspense>
  );
}
