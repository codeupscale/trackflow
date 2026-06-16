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

  test('BUG 3: stopTimer sends time_entry_id to target a specific entry', async () => {
    const startedAt = '2026-06-15T09:00:00.000Z';
    const endedAt = '2026-06-15T11:00:00.000Z';
    const mockResponse = {
      data: { entry: { id: 'old-entry', duration_seconds: 7200 }, today_total: 7200 },
    };
    mockAxios.post.mockResolvedValueOnce(mockResponse);

    await client.stopTimer({
      time_entry_id: 'old-entry',
      started_at: startedAt,
      ended_at: endedAt,
      idempotency_key: 'idem-stop-1',
    });

    // Must pass the SPECIFIC entry id so the server never closes a newer/live session.
    expect(mockAxios.post).toHaveBeenCalledWith(
      '/timer/stop',
      {
        time_entry_id: 'old-entry',
        started_at: startedAt,
        ended_at: endedAt,
        idempotency_key: 'idem-stop-1',
      },
      { timeout: 10000 }
    );
  });

  test('BUG 3: caller treats 404 on stop as already-synced (error surfaces with status 404)', async () => {
    const err = new Error('Not Found');
    err.response = { status: 404 };
    mockAxios.post.mockRejectedValueOnce(err);

    // api-client propagates the error; the caller (stopTimer/syncSessionStop) maps
    // 404 -> already-synced success. Here we assert the status is observable.
    await expect(
      client.stopTimer({ time_entry_id: 'gone-entry' })
    ).rejects.toMatchObject({ response: { status: 404 } });
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
