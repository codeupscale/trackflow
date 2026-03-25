'use client';

import { PostHogProvider } from 'posthog-js/react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { getPostHogClient } from '@/lib/posthog';

// Search params that must NEVER be sent to analytics (tokens, secrets, PII)
const SENSITIVE_PARAMS = new Set([
  'token',
  'refresh',
  'access_token',
  'refresh_token',
  'password',
  'secret',
  'code',
  'key',
]);

function stripSensitiveParams(raw: string): string {
  const params = new URLSearchParams(raw);
  const safe = new URLSearchParams();
  params.forEach((value, key) => {
    if (!SENSITIVE_PARAMS.has(key.toLowerCase())) {
      safe.set(key, value);
    }
  });
  return safe.toString();
}

function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const client = getPostHogClient();
    if (pathname && client) {
      let url = window.origin + pathname;
      const safeParams = stripSensitiveParams(searchParams.toString());
      if (safeParams) {
        url = url + '?' + safeParams;
      }
      client.capture('$pageview', { $current_url: url });
    }
  }, [pathname, searchParams]);

  return null;
}

export function PHProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<ReturnType<typeof getPostHogClient>>(null);

  useEffect(() => {
    setClient(getPostHogClient());
  }, []);

  if (!client) {
    return <>{children}</>;
  }

  return (
    <PostHogProvider client={client}>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      {children}
    </PostHogProvider>
  );
}
