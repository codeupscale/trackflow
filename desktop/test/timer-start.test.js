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

describe('Timer Start', () => {
  let client;
  let mockAxios;

  beforeEach(() => {
    mockAxios = axios.__mockInstance;
    jest.clearAllMocks();
    client = new ApiClient('test-token', 'test-refresh');
  });

  test('startTimer sends idempotency_key when provided', async () => {
    const mockResponse = {
      data: {
        entry: { id: 'entry-1', started_at: new Date().toISOString(), project_id: 'proj-1' },
        today_total: 3600,
      },
    };
    mockAxios.post.mockResolvedValueOnce(mockResponse);

    const result = await client.startTimer('proj-1', 'idem-key-123');

    expect(mockAxios.post).toHaveBeenCalledWith(
      '/timer/start',
      { project_id: 'proj-1', idempotency_key: 'idem-key-123' },
      { timeout: 10000 }
    );
    expect(result.entry.id).toBe('entry-1');
  });

  test('startTimer works without idempotency_key (backward compat)', async () => {
    const mockResponse = {
      data: {
        entry: { id: 'entry-2', started_at: new Date().toISOString() },
        today_total: 0,
      },
    };
    mockAxios.post.mockResolvedValueOnce(mockResponse);

    await client.startTimer('proj-1');

    expect(mockAxios.post).toHaveBeenCalledWith(
      '/timer/start',
      { project_id: 'proj-1' },
      { timeout: 10000 }
    );
  });

  test('startTimer without project sends null project_id', async () => {
    const mockResponse = {
      data: {
        entry: { id: 'entry-3', started_at: new Date().toISOString() },
        today_total: 0,
      },
    };
    mockAxios.post.mockResolvedValueOnce(mockResponse);

    await client.startTimer(null, 'idem-key-456');

    expect(mockAxios.post).toHaveBeenCalledWith(
      '/timer/start',
      { project_id: null, idempotency_key: 'idem-key-456' },
      { timeout: 10000 }
    );
  });

  test('startTimer uses 10 second timeout', async () => {
    const mockResponse = {
      data: {
        entry: { id: 'entry-4', started_at: new Date().toISOString() },
        today_total: 0,
      },
    };
    mockAxios.post.mockResolvedValueOnce(mockResponse);

    await client.startTimer();

    const callArgs = mockAxios.post.mock.calls[0];
    expect(callArgs[2]).toEqual({ timeout: 10000 });
  });

  test('startTimer propagates network errors', async () => {
    const networkError = new Error('Network Error');
    networkError.code = 'ECONNREFUSED';
    mockAxios.post.mockRejectedValueOnce(networkError);

    await expect(client.startTimer('proj-1', 'key-1')).rejects.toThrow('Network Error');
  });

  test('startTimer propagates timeout errors', async () => {
    const timeoutError = new Error('timeout of 10000ms exceeded');
    timeoutError.code = 'ECONNABORTED';
    mockAxios.post.mockRejectedValueOnce(timeoutError);

    await expect(client.startTimer('proj-1', 'key-1')).rejects.toThrow('timeout');
  });

  test('idempotency key returns existing entry on 200 (server has it)', async () => {
    // Server returns 200 (not 201) when idempotency key matches existing entry
    const mockResponse = {
      data: {
        entry: { id: 'existing-entry-1', started_at: '2026-01-01T00:00:00Z' },
        today_total: 7200,
      },
      status: 200,
    };
    mockAxios.post.mockResolvedValueOnce(mockResponse);

    const result = await client.startTimer('proj-1', 'existing-key');
    expect(result.entry.id).toBe('existing-entry-1');
  });
});
