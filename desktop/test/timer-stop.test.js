const axios = require('axios');
const ApiClient = require('../src/main/api-client');

// Mock axios
jest.mock('axios', () => {
  const mockAxiosInstance = {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
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

describe('Timer Stop', () => {
  let client;
  let mockAxios;

  beforeEach(() => {
    mockAxios = axios.__mockInstance;
    jest.clearAllMocks();
    client = new ApiClient('test-token', 'test-refresh');
  });

  test('stopTimer sends without data by default (backward compat)', async () => {
    const mockResponse = {
      data: {
        entry: { id: 'entry-1', ended_at: new Date().toISOString(), duration_seconds: 3600 },
        today_total: 3600,
      },
    };
    mockAxios.post.mockResolvedValueOnce(mockResponse);

    const result = await client.stopTimer();

    expect(mockAxios.post).toHaveBeenCalledWith(
      '/timer/stop',
      {},
      { timeout: 10000 }
    );
    expect(result.entry.duration_seconds).toBe(3600);
  });

  test('stopTimer sends started_at and ended_at for offline sync', async () => {
    const startedAt = '2026-04-06T10:00:00.000Z';
    const endedAt = '2026-04-06T11:00:00.000Z';

    const mockResponse = {
      data: {
        entry: { id: 'entry-1', started_at: startedAt, ended_at: endedAt, duration_seconds: 3600 },
        today_total: 3600,
      },
    };
    mockAxios.post.mockResolvedValueOnce(mockResponse);

    const result = await client.stopTimer({ started_at: startedAt, ended_at: endedAt });

    expect(mockAxios.post).toHaveBeenCalledWith(
      '/timer/stop',
      { started_at: startedAt, ended_at: endedAt },
      { timeout: 10000 }
    );
    expect(result.entry.started_at).toBe(startedAt);
    expect(result.entry.ended_at).toBe(endedAt);
  });

  test('stopTimer uses 10 second timeout', async () => {
    const mockResponse = {
      data: { entry: { id: 'e1' }, today_total: 0 },
    };
    mockAxios.post.mockResolvedValueOnce(mockResponse);

    await client.stopTimer();

    const callArgs = mockAxios.post.mock.calls[0];
    expect(callArgs[2]).toEqual({ timeout: 10000 });
  });

  test('stopTimer propagates network errors', async () => {
    const networkError = new Error('Network Error');
    mockAxios.post.mockRejectedValueOnce(networkError);

    await expect(client.stopTimer()).rejects.toThrow('Network Error');
  });

  test('stopTimer propagates timeout errors', async () => {
    const timeoutError = new Error('timeout of 10000ms exceeded');
    timeoutError.code = 'ECONNABORTED';
    mockAxios.post.mockRejectedValueOnce(timeoutError);

    await expect(client.stopTimer()).rejects.toThrow('timeout');
  });

  test('stopTimer with partial data (only ended_at)', async () => {
    const endedAt = '2026-04-06T11:00:00.000Z';
    const mockResponse = {
      data: { entry: { id: 'e1', ended_at: endedAt }, today_total: 100 },
    };
    mockAxios.post.mockResolvedValueOnce(mockResponse);

    await client.stopTimer({ ended_at: endedAt });

    expect(mockAxios.post).toHaveBeenCalledWith(
      '/timer/stop',
      { ended_at: endedAt },
      { timeout: 10000 }
    );
  });
});
