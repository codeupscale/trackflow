const axios = require('axios');

// Production API — change this when deploying to a new server
const API_BASE = process.env.TRACKFLOW_API_URL || 'https://trackflow.codeupscale.com/api/v1';

class ApiClient {
  constructor(token) {
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
  }

  setToken(token) {
    this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }

  async login(email, password) {
    const res = await this.client.post('/auth/login', { email, password });
    this.setToken(res.data.access_token);
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

  async getTimerStatus() {
    const res = await this.client.get('/timer/status');
    return res.data;
  }

  async sendHeartbeat(data) {
    const res = await this.client.post('/timer/heartbeat', data);
    return res.data;
  }

  async uploadScreenshot(formData) {
    const res = await this.client.post('/screenshots', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
    return res.data;
  }

  async getProjects() {
    const res = await this.client.get('/projects');
    return res.data.projects;
  }

  async bulkUploadLogs(logs) {
    const res = await this.client.post('/agent/logs', { logs });
    return res.data;
  }
}

module.exports = ApiClient;
