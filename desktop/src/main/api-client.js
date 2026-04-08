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
    this._tokenIssuedAt = Date.now(); // Track when current access token was issued
    this._tokenLifetimeMs = 24 * 60 * 60 * 1000; // 24 hours (matches server)
    this._proactiveRefreshMs = 5 * 60 * 1000; // Refresh 5 minutes before expiry

    // Dynamically resolve agent version from Electron app or package.json
    let agentVersion = '1.0.0';
    try {
      const { app } = require('electron');
      agentVersion = app.getVersion();
    } catch {
      // Fallback: read from package.json if Electron app not available
      try {
        agentVersion = require('../../package.json').version;
      } catch {}
    }

    this.client = axios.create({
      baseURL: API_BASE,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Agent-Version': agentVersion,
      },
      timeout: 15000, // Default timeout; overridden per-call where needed
    });

    if (token) {
      this.setToken(token);
    }

    // Proactive token refresh — refresh before expiry to avoid 401 round-trips
    this.client.interceptors.request.use(async (config) => {
      // Skip refresh endpoint itself and auth endpoints
      if (config.url?.includes('/auth/')) return config;

      const elapsed = Date.now() - this._tokenIssuedAt;
      const nearExpiry = elapsed > (this._tokenLifetimeMs - this._proactiveRefreshMs);

      if (nearExpiry && this.refreshToken && !this._isRefreshing) {
        try {
          console.log('[Auth] Access token near expiry — proactively refreshing');
          await this._doRefresh();
        } catch (err) {
          // Non-fatal — the 401 interceptor will catch it if token is truly expired
          console.warn('[Auth] Proactive refresh failed:', err.message);
        }
      }

      return config;
    });

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
            // LOGOUT-FIX: Only trigger auth failure callback for genuine auth
            // rejections (401/403 from the refresh endpoint). Network errors,
            // timeouts, and 5xx responses are transient — the user should NOT
            // be logged out for those.
            const refreshStatus = refreshErr.response?.status;
            const isAuthRejection = refreshStatus === 401 || refreshStatus === 403;

            if (isAuthRejection && this._onAuthFailed) {
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
    // Retry with exponential backoff for transient errors (5xx, network, timeout).
    // Auth rejections (401/403) fail immediately — no point retrying.
    const maxRetries = 3;
    const backoffMs = [1000, 3000, 6000]; // 1s, 3s, 6s

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
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
        this._tokenIssuedAt = Date.now();

        // Persist new tokens via callback
        if (this._onTokenRefreshed) {
          await this._onTokenRefreshed(access_token, refresh_token);
        }

        return res.data;
      } catch (err) {
        const status = err.response?.status;
        const isAuthRejection = status === 401 || status === 403;

        // Auth rejections are permanent — don't retry
        if (isAuthRejection) throw err;

        // Last attempt — give up
        if (attempt === maxRetries) {
          console.error(`[Auth] Token refresh failed after ${maxRetries + 1} attempts:`, err.message);
          throw err;
        }

        // Transient error — retry after backoff
        console.warn(`[Auth] Token refresh attempt ${attempt + 1} failed (${status || 'network'}), retrying in ${backoffMs[attempt]}ms...`);
        await new Promise(r => setTimeout(r, backoffMs[attempt]));
      }
    }
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
    // Multi-org: if requires_org_selection, don't set tokens yet
    if (res.data.requires_org_selection) {
      return res.data;
    }
    this.setToken(res.data.access_token);
    this.refreshToken = res.data.refresh_token;
    this._tokenIssuedAt = Date.now();
    return res.data;
  }

  async googleAuth(idToken) {
    const res = await this.client.post('/auth/google', { id_token: idToken });
    // Multi-org: if requires_org_selection, don't set tokens yet
    if (res.data.requires_org_selection) {
      return res.data;
    }
    this.setToken(res.data.access_token);
    this.refreshToken = res.data.refresh_token;
    this._tokenIssuedAt = Date.now();
    return res.data;
  }

  async selectOrganization(payload) {
    const res = await this.client.post('/auth/select-organization', payload);
    this.setToken(res.data.access_token);
    this.refreshToken = res.data.refresh_token;
    this._tokenIssuedAt = Date.now();
    return res.data;
  }

  async getMe() {
    const res = await this.client.get('/auth/me');
    return res.data.user;
  }

  async getConfig() {
    const res = await this.client.get('/agent/config', {
      timeout: 10000,
    });
    return res.data;
  }

  async startTimer(projectId = null, idempotencyKey = null) {
    const payload = { project_id: projectId };
    if (idempotencyKey) payload.idempotency_key = idempotencyKey;
    const res = await this.client.post('/timer/start', payload, {
      timeout: 10000, // Timer operations: 10s timeout
    });
    return res.data;
  }

  async stopTimer(data = {}) {
    const res = await this.client.post('/timer/stop', data, {
      timeout: 10000, // Timer operations: 10s timeout
    });
    return res.data;
  }

  /**
   * Atomically switch the running timer to a different project.
   * Stops the current entry and starts a new one in a single server transaction.
   */
  async switchProject(projectId, taskId = null) {
    const payload = { project_id: projectId };
    if (taskId) payload.task_id = taskId;
    const res = await this.client.post('/timer/switch', payload);
    return res.data;
  }

  /** Get timer status. Optional projectId scopes today_total to that project (for per-project display). */
  async getTimerStatus(projectId = null) {
    const params = projectId ? { project_id: projectId } : {};
    const res = await this.client.get('/timer/status', {
      params,
      timeout: 10000, // Same budget as timer start/stop — avoids hanging on default 15s
    });
    return res.data;
  }

  /** Get today's total tracked seconds, optionally for a specific project. */
  async getTodayTotal(projectId = null) {
    const params = projectId ? { project_id: projectId } : {};
    const res = await this.client.get('/timer/today-total', {
      params,
      timeout: 10000,
    });
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
      timeout: 30000, // Screenshot uploads: 30s timeout
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
