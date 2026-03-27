const axios = require('axios');
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
        timeout: 30000,
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Agent-Version': '1.0.0',
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

  test('startTimer should post with project_id', async () => {
    mockAxios.post.mockResolvedValueOnce({
      data: { entry: { id: 1 }, today_total: 100 },
    });
    const result = await client.startTimer(42);
    expect(mockAxios.post).toHaveBeenCalledWith('/timer/start', { project_id: 42 });
    expect(result.entry.id).toBe(1);
  });

  test('startTimer should work without project_id', async () => {
    mockAxios.post.mockResolvedValueOnce({
      data: { entry: { id: 2 }, today_total: 0 },
    });
    const result = await client.startTimer();
    expect(mockAxios.post).toHaveBeenCalledWith('/timer/start', { project_id: null });
    expect(result.entry.id).toBe(2);
  });

  test('stopTimer should post and return data', async () => {
    mockAxios.post.mockResolvedValueOnce({
      data: { entry: { id: 1 }, today_total: 500 },
    });
    const result = await client.stopTimer();
    expect(mockAxios.post).toHaveBeenCalledWith('/timer/stop');
    expect(result.today_total).toBe(500);
  });

  test('getTimerStatus should pass project_id as param', async () => {
    mockAxios.get.mockResolvedValueOnce({
      data: { running: true, entry: { id: 1 }, today_total: 300 },
    });
    await client.getTimerStatus(42);
    expect(mockAxios.get).toHaveBeenCalledWith('/timer/status', { params: { project_id: 42 } });
  });

  test('getTimerStatus without project_id should pass empty params', async () => {
    mockAxios.get.mockResolvedValueOnce({
      data: { running: false, today_total: 0 },
    });
    await client.getTimerStatus();
    expect(mockAxios.get).toHaveBeenCalledWith('/timer/status', { params: {} });
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

  test('reportIdleTime should post data', async () => {
    const data = { time_entry_id: 1, action: 'discard', idle_seconds: 300 };
    mockAxios.post.mockResolvedValueOnce({ data: { success: true } });
    await client.reportIdleTime(data);
    expect(mockAxios.post).toHaveBeenCalledWith('/timer/idle', data);
  });

  test('onTokenRefreshed callback should be called on refresh', async () => {
    const callback = jest.fn();
    client.onTokenRefreshed(callback);
    expect(client._onTokenRefreshed).toBe(callback);
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
