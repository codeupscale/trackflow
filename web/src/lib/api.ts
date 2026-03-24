import axios from 'axios';

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

api.interceptors.request.use((config) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    // Extract structured error message from response
    const errorMessage = error.response?.data?.message || error.message || 'An error occurred';

    // Handle payment required (402) - redirect to billing
    if (error.response?.status === 402) {
      if (typeof window !== 'undefined') {
        window.location.href = '/settings/billing';
      }
      return Promise.reject({ ...error, message: errorMessage });
    }

    // Handle forbidden (403)
    // Do NOT globally redirect on 403 because employees can legitimately hit 403
    // (e.g. trying to start a timer on an unassigned project). Let the caller decide.
    if (error.response?.status === 403) {
      return Promise.reject({ ...error, message: errorMessage });
    }

    // Handle unauthorized (401) - refresh token or redirect to login
    if (error.response?.status === 401) {
      const refreshToken = localStorage.getItem('refresh_token');
      if (refreshToken && !error.config._retry) {
        error.config._retry = true;
        try {
          // If a refresh is already in-flight, wait for it instead of
          // issuing a second refresh (which would race and likely fail).
          if (!refreshPromise) {
            refreshPromise = axios
              .post(
                `${api.defaults.baseURL}/auth/refresh`,
                {},
                { headers: { Authorization: `Bearer ${refreshToken}` } }
              )
              .then((res) => {
                localStorage.setItem('access_token', res.data.access_token);
                localStorage.setItem('refresh_token', res.data.refresh_token);
                return res.data.access_token as string;
              })
              .finally(() => {
                refreshPromise = null;
              });
          }

          const newAccessToken = await refreshPromise;
          error.config.headers.Authorization = `Bearer ${newAccessToken}`;
          return api(error.config);
        } catch {
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          if (typeof window !== 'undefined') {
            window.location.href = '/login';
          }
        }
      } else {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject({ ...error, message: errorMessage });
  }
);

export default api;
