const axios = require('axios');

jest.mock('../src/main/keychain', () => ({
  getDeviceId: jest.fn(() => 'a'.repeat(64)),
}));

const ApiClient = require('../src/main/api-client');

// Mock axios
jest.mock('axios', () => {
  const mockAxiosInstance = {
    get: jest.fn(),
    post: jest.fn(),
    defaults: { headers: { common: {} } },
    interceptors: {
      response: { use: jest.fn() },
      request: { use: jest.fn() },
    },
  };
  return {
    create: jest.fn(() => mockAxiosInstance),
    post: jest.fn(),
    __mockInstance: mockAxiosInstance,
  };
});

describe('ApiClient', () => {
  let client;
  let mockAxios;

  beforeEach(() => {
    mockAxios = axios.__mockInstance;
    jest.clearAllMocks();
    client = new ApiClient('test-token', 'test-refresh');
  });

  test('should create axios instance with correct config', () => {
    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: 15000,
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Agent-Version': require('../package.json').version,
          'X-TrackFlow-Client': 'desktop',
          'X-Device-Id': 'a'.repeat(64),
        }),
      })
    );
  });

  test('should set auth header on construction', () => {
    expect(mockAxios.defaults.headers.common['Authorization']).toBe('Bearer test-token');
  });

  test('should register response interceptor', () => {
    expect(mockAxios.interceptors.response.use).toHaveBeenCalledTimes(1);
  });

  test('login should set tokens and return data', async () => {
    const mockResponse = {
      data: {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        user: { id: 1, name: 'Test' },
      },
    };
    mockAxios.post.mockResolvedValueOnce(mockResponse);

    const result = await client.login('test@example.com', 'password');
    expect(mockAxios.post).toHaveBeenCalledWith('/auth/login', {
      email: 'test@example.com',
      password: 'password',
    });
    expect(result.access_token).toBe('new-access');
    expect(client.refreshToken).toBe('new-refresh');
  });

  test('getMe should return user', async () => {
    mockAxios.get.mockResolvedValueOnce({ data: { user: { id: 1, name: 'Test' } } });
    const user = await client.getMe();
    expect(user).toEqual({ id: 1, name: 'Test' });
  });

  // startTimer / stopTimer / switchProject / pause / resume / reportIdleTime are gone
  // with their endpoints. Tracked time is written only by syncSessions().

  test('syncSessions should post the batch to the sync endpoint', async () => {
    const sessions = [
      {
        uuid: 'b3f1c2d4-0000-4000-8000-000000000001',
        revision: 2,
        started_at: '2026-07-30T08:00:00.000Z',
        ended_at: '2026-07-30T09:00:00.000Z',
        project_id: null,
        task_id: null,
      },
    ];
    mockAxios.post.mockResolvedValueOnce({
      data: { results: [{ uuid: sessions[0].uuid, status: 'ok' }] },
    });

    const result = await client.syncSessions(sessions);

    expect(mockAxios.post).toHaveBeenCalledWith(
      '/timer/sessions/sync',
      { sessions },
      { timeout: 30000 },
    );
    expect(result.results[0].status).toBe('ok');
  });

  test('checkHealth returns true on 200', async () => {
    mockAxios.get.mockResolvedValueOnce({ status: 200, data: { status: 'ok' } });

    await expect(client.checkHealth()).resolves.toBe(true);
    // The CHEAP liveness endpoint — /health probes S3 and counts failed jobs, far too
    // expensive for every agent to poll every 60s.
    expect(mockAxios.get).toHaveBeenCalledWith(
      '/health/live',
      expect.objectContaining({ timeout: 5000 }),
    );
  });

  test('checkHealth swallows errors and reports offline', async () => {
    // Must never throw: the sync worker treats any failure as "offline", which is
    // always the safe interpretation, and a health probe must never be able to
    // trigger a token refresh or a logout.
    mockAxios.get.mockRejectedValueOnce(new Error('ENOTFOUND'));

    await expect(client.checkHealth()).resolves.toBe(false);
  });

  test('checkHealth reports offline on a non-200 status', async () => {
    mockAxios.get.mockResolvedValueOnce({ status: 503, data: {} });

    await expect(client.checkHealth()).resolves.toBe(false);
  });

  test('getTimerStatus should pass project_id as param', async () => {
    mockAxios.get.mockResolvedValueOnce({
      data: { running: true, entry: { id: 1 }, today_total: 300 },
    });
    await client.getTimerStatus(42);
    expect(mockAxios.get).toHaveBeenCalledWith('/timer/status', {
      params: { project_id: 42 },
      timeout: 10000,
    });
  });

  test('getTimerStatus without project_id should pass empty params', async () => {
    mockAxios.get.mockResolvedValueOnce({
      data: { running: false, today_total: 0 },
    });
    await client.getTimerStatus();
    expect(mockAxios.get).toHaveBeenCalledWith('/timer/status', {
      params: {},
      timeout: 10000,
    });
  });

  test('getTodayTotal should return numeric value', async () => {
    mockAxios.get.mockResolvedValueOnce({ data: { today_total: 1234 } });
    const total = await client.getTodayTotal(5);
    expect(total).toBe(1234);
  });

  test('getTodayTotal should default to 0', async () => {
    mockAxios.get.mockResolvedValueOnce({ data: {} });
    const total = await client.getTodayTotal();
    expect(total).toBe(0);
  });

  test('getProjects should return projects array', async () => {
    const projects = [{ id: 1, name: 'P1' }, { id: 2, name: 'P2' }];
    mockAxios.get.mockResolvedValueOnce({ data: { projects } });
    const result = await client.getProjects();
    expect(result).toEqual(projects);
  });

  test('sendHeartbeat should post data', async () => {
    const data = { keyboard_events: 10, mouse_events: 20 };
    mockAxios.post.mockResolvedValueOnce({ data: { success: true } });
    await client.sendHeartbeat(data);
    expect(mockAxios.post).toHaveBeenCalledWith('/timer/heartbeat', data);
  });

  test('no timer-mutation methods survive on the client', () => {
    // Force-upgrade contract: these endpoints were deleted server-side, so a client
    // still calling them would 404 on every attempt. Assert they are gone rather than
    // leaving a method that silently fails in the field.
    for (const gone of [
      'startTimer',
      'stopTimer',
      'switchProject',
      'pauseTimer',
      'resumeTimer',
      'reportIdleTime',
    ]) {
      expect(typeof client[gone]).toBe('undefined');
    }
    expect(typeof client.syncSessions).toBe('function');
  });

  test('onTokenRefreshed callback should be called on refresh', async () => {
    const callback = jest.fn();
    client.onTokenRefreshed(callback);
    expect(client._onTokenRefreshed).toBe(callback);
  });

  test('getMyShift should return shift data', async () => {
    const shiftData = { shift: { id: 's1', name: 'Morning', start_time: '09:00:00', end_time: '17:00:00' } };
    mockAxios.get.mockResolvedValueOnce({ data: shiftData });
    const result = await client.getMyShift();
    expect(mockAxios.get).toHaveBeenCalledWith('/agent/my-shift', { timeout: 10000 });
    expect(result.shift.name).toBe('Morning');
  });

  test('getMyShift should handle null shift', async () => {
    mockAxios.get.mockResolvedValueOnce({ data: { shift: null } });
    const result = await client.getMyShift();
    expect(result.shift).toBeNull();
  });

  describe('token refresh coalescing', () => {
    test('_doRefresh should coalesce concurrent calls', async () => {
      axios.post.mockResolvedValueOnce({
        data: { access_token: 'refreshed-access', refresh_token: 'refreshed-refresh' },
      });

      // Simulate concurrent calls
      const promise1 = client._doRefresh();
      const promise2 = client._doRefresh();

      const [result1, result2] = await Promise.all([promise1, promise2]);
      expect(result1).toEqual(result2);
      expect(axios.post).toHaveBeenCalledTimes(1);
    });
  });
});
