const axios = require('axios');

// Production API — change this when deploying to a new server
const API_BASE = process.env.TRACKFLOW_API_URL || 'https://trackflow.codeupscale.com/api/v1';

class ApiClient {
  constructor(token, refreshToken = null) {
    this.refreshToken = refreshToken;
    this._isRefreshing = false;
    this._refreshPromise = null;
    this._onTokenRefreshed = null; // Callback to persist new tokens
    this._onAuthFailed = null; // Callback when token refresh fails (force logout)

    this.client = axios.create({
      baseURL: API_BASE,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Agent-Version': '1.0.0',
      },
      timeout: 30000,
    });

    if (token) {
      this.setToken(token);
    }

    // Auto-refresh on 401
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;

        // Only attempt refresh once per request, skip refresh endpoint itself
        if (
          error.response?.status === 401 &&
          !originalRequest._retry &&
          this.refreshToken &&
          !originalRequest.url?.includes('/auth/refresh')
        ) {
          originalRequest._retry = true;

          try {
            const tokens = await this._doRefresh();
            originalRequest.headers['Authorization'] = `Bearer ${tokens.access_token}`;
            return this.client(originalRequest);
          } catch (refreshErr) {
            // Refresh failed — token is truly expired (e.g. password changed)
            if (this._onAuthFailed) {
              this._onAuthFailed(refreshErr);
            }
            return Promise.reject(refreshErr);
          }
        }

        return Promise.reject(error);
      }
    );
  }

  // Coalesce concurrent refresh requests into one
  async _doRefresh() {
    if (this._isRefreshing) {
      return this._refreshPromise;
    }

    this._isRefreshing = true;
    this._refreshPromise = this._refreshTokens();

    try {
      const result = await this._refreshPromise;
      return result;
    } finally {
      this._isRefreshing = false;
      this._refreshPromise = null;
    }
  }

  async _refreshTokens() {
    const res = await axios.post(`${API_BASE}/auth/refresh`, {}, {
      headers: {
        'Authorization': `Bearer ${this.refreshToken}`,
        'Accept': 'application/json',
      },
      timeout: 15000,
    });

    const { access_token, refresh_token } = res.data;

    this.setToken(access_token);
    this.refreshToken = refresh_token;

    // Persist new tokens via callback
    if (this._onTokenRefreshed) {
      await this._onTokenRefreshed(access_token, refresh_token);
    }

    return res.data;
  }

  // Register callback to persist refreshed tokens to keychain
  onTokenRefreshed(callback) {
    this._onTokenRefreshed = callback;
  }

  // Register callback for when token refresh fails (password changed, tokens revoked)
  onAuthFailed(callback) {
    this._onAuthFailed = callback;
  }

  setToken(token) {
    this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }

  async login(email, password) {
    const res = await this.client.post('/auth/login', { email, password });
    this.setToken(res.data.access_token);
    this.refreshToken = res.data.refresh_token;
    return res.data;
  }

  async getMe() {
    const res = await this.client.get('/auth/me');
    return res.data.user;
  }

  async getConfig() {
    const res = await this.client.get('/agent/config');
    return res.data;
  }

  async startTimer(projectId = null) {
    const res = await this.client.post('/timer/start', {
      project_id: projectId,
    });
    return res.data;
  }

  async stopTimer() {
    const res = await this.client.post('/timer/stop');
    return res.data;
  }

  /** Get timer status. Optional projectId scopes today_total to that project (for per-project display). */
  async getTimerStatus(projectId = null) {
    const params = projectId ? { project_id: projectId } : {};
    const res = await this.client.get('/timer/status', { params });
    return res.data;
  }

  /** Get today's total tracked seconds, optionally for a specific project. */
  async getTodayTotal(projectId = null) {
    const params = projectId ? { project_id: projectId } : {};
    const res = await this.client.get('/timer/today-total', { params });
    return res.data.today_total ?? 0;
  }

  async sendHeartbeat(data) {
    const res = await this.client.post('/timer/heartbeat', data);
    return res.data;
  }

  async uploadScreenshot(formData) {
    // Use FormData's own headers (includes correct boundary for multipart)
    const res = await this.client.post('/screenshots', formData, {
      headers: {
        ...formData.getHeaders(),
      },
      timeout: 60000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    return res.data;
  }

  async getProjects() {
    const res = await this.client.get('/projects');
    // Backend returns paginated response: { data: [...], current_page, ... }
    // or legacy format: { projects: [...] }
    return res.data.data || res.data.projects || res.data || [];
  }

  async reportIdleTime(data) {
    const res = await this.client.post('/timer/idle', data);
    return res.data;
  }

  async deleteTimeEntry(entryId) {
    const res = await this.client.delete(`/time-entries/${entryId}`);
    return res.data;
  }

  async bulkUploadLogs(logs) {
    const res = await this.client.post('/agent/logs', { logs });
    return res.data;
  }
}

module.exports = ApiClient;
