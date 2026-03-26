import Echo from 'laravel-echo';
import Pusher from 'pusher-js';

declare global {
  interface Window {
    Pusher: typeof Pusher;
    Echo: Echo<'reverb'>;
  }
}

let echo: Echo<'reverb'> | null = null;

/**
 * Singleton Echo instance for real-time broadcasting.
 *
 * Auth headers are resolved dynamically on every request so that
 * token refreshes (handled by the axios interceptor in api.ts) are
 * picked up automatically without needing to recreate the Echo instance.
 */
export function getEcho(): Echo<'reverb'> {
  if (echo) return echo;

  if (typeof window === 'undefined') return null as unknown as Echo<'reverb'>;

  window.Pusher = Pusher;

  echo = new Echo({
    broadcaster: 'reverb',
    key: process.env.NEXT_PUBLIC_REVERB_APP_KEY || '',
    wsHost: process.env.NEXT_PUBLIC_REVERB_HOST || 'trackflow.codeupscale.com',
    wsPort: 443,
    wssPort: 443,
    forceTLS: true,
    enabledTransports: ['ws', 'wss'],
    authEndpoint: `${process.env.NEXT_PUBLIC_API_URL || 'https://trackflow.codeupscale.com/api/v1'}/broadcasting/auth`,
    auth: {
      headers: {
        // Dynamic getter: reads the current token on every auth request
        // so refreshed tokens are picked up automatically.
        get Authorization() {
          const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : '';
          return `Bearer ${token || ''}`;
        },
      },
    },
  });

  return echo;
}

/**
 * Destroy the Echo instance (e.g. on logout) so a fresh one is
 * created with new credentials on next login.
 */
export function destroyEcho(): void {
  if (echo) {
    try {
      echo.disconnect();
    } catch {
      // Ignore cleanup errors
    }
    echo = null;
  }
}
