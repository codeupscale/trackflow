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
 * Usage: Import getEcho() in components that need real-time updates:
 *
 * const echo = getEcho();
 * echo.channel(`user.${userId}`).listen('TimerStarted', (data) => {
 *   // handle real-time timer updates
 * });
 *
 * TODO: Integrate this into:
 * - Timer dashboard for live timer status updates
 * - Activity dashboard for real-time activity logs
 * - Timesheet review components for live submission notifications
 */
export function getEcho(): Echo<'reverb'> {
  if (echo) return echo;

  if (typeof window === 'undefined') return null as unknown as Echo<'reverb'>;

  window.Pusher = Pusher;

  echo = new Echo({
    broadcaster: 'reverb',
    key: process.env.NEXT_PUBLIC_REVERB_APP_KEY || '',
    wsHost: process.env.NEXT_PUBLIC_REVERB_HOST || 'localhost',
    wsPort: Number(process.env.NEXT_PUBLIC_REVERB_PORT || 8080),
    wssPort: Number(process.env.NEXT_PUBLIC_REVERB_PORT || 8080),
    forceTLS: false,
    enabledTransports: ['ws', 'wss'],
    authEndpoint: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost/api/v1'}/broadcasting/auth`,
    auth: {
      headers: {
        Authorization: `Bearer ${typeof window !== 'undefined' ? localStorage.getItem('access_token') : ''}`,
      },
    },
  });

  return echo;
}
