import axios from 'axios';
import { captureError } from '@/lib/posthog';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'https://trackflow.codeupscale.com/api/v1',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
});

// Mutex for token refresh: when a refresh is in-flight, all subsequent
// 401 handlers wait on the same promise instead of issuing duplicate refreshes.
let refreshPromise: Promise<string> | null = null;

const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000; // 24 hours (matches server)
const PROACTIVE_REFRESH_MS = 5 * 60 * 1000; // Refresh 5 minutes before expiry

// Refresh tokens with retry + backoff for transient errors (5xx, network).
// Auth rejections (401/403) fail immediately.
async function refreshWithRetry(token: string): Promise<string> {
  const maxRetries = 2;
  const backoffMs = [1000, 3000];

  try {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await axios.post(
          `${api.defaults.baseURL}/auth/refresh`,
          {},
          { headers: { Authorization: `Bearer ${token}` } }
        );
        localStorage.setItem('access_token', res.data.access_token);
        localStorage.setItem('refresh_token', res.data.refresh_token);
        localStorage.setItem('token_issued_at', Date.now().toString());
        return res.data.access_token as string;
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        const isAuthRejection = status === 401 || status === 403;

        // Auth rejections are permanent — don't retry
        if (isAuthRejection) throw err;

        // Last attempt — give up
        if (attempt === maxRetries) throw err;

        // Transient error — retry after backoff
        await new Promise(r => setTimeout(r, backoffMs[attempt]));
      }
    }
    throw new Error('Token refresh failed');
  } finally {
    refreshPromise = null;
  }
}

api.interceptors.request.use(async (config) => {
  if (typeof window === 'undefined') return config;

  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Proactive refresh — refresh before expiry to avoid 401 round-trips
  const isAuthEndpoint = /\/auth\//.test(config.url || '');
  if (!isAuthEndpoint && token) {
    const issuedAt = parseInt(localStorage.getItem('token_issued_at') || '0', 10);
    const elapsed = Date.now() - issuedAt;
    const nearExpiry = issuedAt > 0 && elapsed > (TOKEN_LIFETIME_MS - PROACTIVE_REFRESH_MS);
    const refreshToken = localStorage.getItem('refresh_token');

    if (nearExpiry && refreshToken && !refreshPromise) {
      try {
        refreshPromise = refreshWithRetry(refreshToken);
        const newToken = await refreshPromise;
        config.headers.Authorization = `Bearer ${newToken}`;
      } catch {
        // Non-fatal — the 401 interceptor will catch it if token is truly expired
      }
    }
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    // Extract structured error message from response
    const errorMessage = error.response?.data?.message || error.message || 'An error occurred';

    // Capture server errors, rate limits, and network failures to PostHog
    const status = error.response?.status;
    if (!status || status >= 500 || status === 429) {
      captureError(
        new Error(errorMessage),
        {
          type: 'api_error',
          status: status ?? 'network_error',
          url: error.config?.url,
          method: error.config?.method,
        }
      );
    }

    // Handle payment required (402) - redirect to billing
    if (error.response?.status === 402) {
      if (typeof window !== 'undefined') {
        window.location.href = '/settings/billing';
      }
      const err402 = new Error(errorMessage);
      (err402 as any).status = 402;
      (err402 as any).data = error.response?.data;
      return Promise.reject(err402);
    }

    // Handle forbidden (403)
    // Do NOT globally redirect on 403 because employees can legitimately hit 403
    // (e.g. trying to start a timer on an unassigned project). Let the caller decide.
    if (error.response?.status === 403) {
      const err403 = new Error(errorMessage);
      (err403 as any).status = 403;
      (err403 as any).data = error.response?.data;
      return Promise.reject(err403);
    }

    // Handle unauthorized (401) - refresh token or redirect to login
    // Skip redirect logic for auth endpoints (login, register, google) — they legitimately
    // return 401/422 for bad credentials and should NOT trigger a page reload.
    const isAuthEndpoint = /\/auth\/(login|register|google|refresh|select-organization)/.test(error.config?.url || '');
    if (error.response?.status === 401 && !isAuthEndpoint) {
      const refreshToken = typeof window !== 'undefined' ? localStorage.getItem('refresh_token') : null;
      if (refreshToken && !error.config._retry) {
        error.config._retry = true;
        try {
          // If a refresh is already in-flight, wait for it instead of
          // issuing a second refresh (which would race and likely fail).
          if (!refreshPromise) {
            refreshPromise = refreshWithRetry(refreshToken);
          }

          const newAccessToken = await refreshPromise;
          error.config.headers.Authorization = `Bearer ${newAccessToken}`;
          return api(error.config);
        } catch (refreshErr: unknown) {
          // Only clear tokens and redirect for genuine auth rejections (401/403).
          // Transient errors (5xx, network) should NOT log the user out —
          // the request simply fails and the user can retry.
          const refreshStatus = (refreshErr as { status?: number })?.status
            ?? (refreshErr as { response?: { status?: number } })?.response?.status;
          const isAuthRejection = refreshStatus === 401 || refreshStatus === 403;

          if (isAuthRejection) {
            localStorage.removeItem('access_token');
            localStorage.removeItem('refresh_token');
            localStorage.removeItem('token_issued_at');
            if (typeof window !== 'undefined') {
              window.location.href = '/login';
            }
          }
          // For transient errors, don't clear tokens — let the original request fail
          // so the caller can show an error message. User stays logged in.
        }
      } else if (!refreshToken) {
        // No refresh token at all — must re-login
        localStorage.removeItem('access_token');
        localStorage.removeItem('token_issued_at');
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
      }
    }
    // Construct a clean error to avoid circular reference issues with Axios error objects
    const finalError = new Error(errorMessage);
    (finalError as any).status = error.response?.status;
    (finalError as any).data = error.response?.data;
    return Promise.reject(finalError);
  }
);

export default api;
