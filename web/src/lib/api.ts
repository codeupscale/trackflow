import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost/api/v1',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
});

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

    // Handle forbidden (403) - insufficient permissions
    if (error.response?.status === 403) {
      if (typeof window !== 'undefined') {
        window.location.href = '/';
      }
      return Promise.reject({ ...error, message: errorMessage });
    }

    // Handle unauthorized (401) - refresh token or redirect to login
    if (error.response?.status === 401) {
      const refreshToken = localStorage.getItem('refresh_token');
      if (refreshToken && !error.config._retry) {
        error.config._retry = true;
        try {
          const res = await axios.post(
            `${api.defaults.baseURL}/auth/refresh`,
            {},
            { headers: { Authorization: `Bearer ${refreshToken}` } }
          );
          localStorage.setItem('access_token', res.data.access_token);
          localStorage.setItem('refresh_token', res.data.refresh_token);
          error.config.headers.Authorization = `Bearer ${res.data.access_token}`;
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
