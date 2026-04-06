/**
 * Auth & Logout Flow Tests
 *
 * Tests the critical auth interceptor behavior in api-client.js:
 * - Token refresh on 401 should retry the original request
 * - Network errors during refresh should NOT trigger logout
 * - Genuine auth failures (401/403 from refresh) SHOULD trigger logout
 * - Timeouts during refresh should NOT trigger logout
 * - 5xx errors during refresh should NOT trigger logout
 */

const axios = require('axios');
const ApiClient = require('../src/main/api-client');

// Mock axios with full interceptor support
jest.mock('axios', () => {
  // Store interceptor callbacks so we can invoke them manually
  let responseInterceptorSuccess = null;
  let responseInterceptorError = null;

  const mockAxiosInstance = {
    get: jest.fn(),
    post: jest.fn(),
    defaults: { headers: { common: {} } },
    interceptors: {
      response: {
        use: jest.fn((success, error) => {
          responseInterceptorSuccess = success;
          responseInterceptorError = error;
        }),
      },
      request: { use: jest.fn() },
    },
    // Allow calling the instance as a function (for retrying requests)
    __call: jest.fn(),
  };

  const axiosModule = {
    create: jest.fn(() => {
      // Make the instance callable (axios interceptors call this.client(originalRequest))
      const callable = jest.fn((...args) => mockAxiosInstance.__call(...args));
      Object.assign(callable, mockAxiosInstance);
      return callable;
    }),
    post: jest.fn(),
    __mockInstance: mockAxiosInstance,
    __getResponseInterceptor: () => ({
      success: responseInterceptorSuccess,
      error: responseInterceptorError,
    }),
  };

  return axiosModule;
});

describe('ApiClient Auth Interceptor', () => {
  let client;
  let mockAxios;
  let interceptor;
  let onAuthFailed;

  beforeEach(() => {
    jest.clearAllMocks();
    onAuthFailed = jest.fn();
    client = new ApiClient('test-token', 'test-refresh');
    client.onAuthFailed(onAuthFailed);
    mockAxios = axios.__mockInstance;
    interceptor = axios.__getResponseInterceptor();
  });

  function make401Error(url = '/timer/status') {
    return {
      response: { status: 401 },
      config: { url, headers: {}, _retry: false },
    };
  }

  function makeNetworkError(url = '/timer/status') {
    const err = new Error('Network Error');
    err.code = 'ERR_NETWORK';
    err.config = { url, headers: {}, _retry: false };
    // No .response property — this is key for network errors
    return err;
  }

  function makeTimeoutError(url = '/timer/status') {
    const err = new Error('timeout of 30000ms exceeded');
    err.code = 'ECONNABORTED';
    err.config = { url, headers: {}, _retry: false };
    return err;
  }

  function make500Error(url = '/timer/status') {
    return {
      response: { status: 500, data: { message: 'Internal Server Error' } },
      config: { url, headers: {}, _retry: false },
    };
  }

  // ── Happy path: 401 → refresh succeeds → retry original request ──

  test('should refresh token and retry on 401', async () => {
    // Mock successful refresh
    axios.post.mockResolvedValueOnce({
      data: { access_token: 'new-access', refresh_token: 'new-refresh' },
    });

    // Mock successful retry of original request
    const retryResponse = { data: { running: true } };
    // The callable instance is used for retry
    const callableClient = axios.create.mock.results[0].value;
    callableClient.mockResolvedValueOnce(retryResponse);

    const error = make401Error();
    const result = await interceptor.error(error);

    expect(result).toEqual(retryResponse);
    expect(axios.post).toHaveBeenCalledTimes(1); // refresh call
    expect(onAuthFailed).not.toHaveBeenCalled(); // should NOT logout
  });

  // ── CRITICAL: Network error during refresh should NOT logout ──

  test('should NOT call onAuthFailed when refresh fails due to network error', async () => {
    const networkErr = new Error('Network Error');
    networkErr.code = 'ERR_NETWORK';
    // No .response property
    axios.post.mockRejectedValueOnce(networkErr);

    const error = make401Error();
    await expect(interceptor.error(error)).rejects.toThrow('Network Error');

    // CRITICAL assertion: onAuthFailed must NOT be called for network errors
    expect(onAuthFailed).not.toHaveBeenCalled();
  });

  test('should NOT call onAuthFailed when refresh fails due to timeout', async () => {
    const timeoutErr = new Error('timeout of 15000ms exceeded');
    timeoutErr.code = 'ECONNABORTED';
    // No .response property
    axios.post.mockRejectedValueOnce(timeoutErr);

    const error = make401Error();
    await expect(interceptor.error(error)).rejects.toThrow('timeout');

    expect(onAuthFailed).not.toHaveBeenCalled();
  });

  test('should NOT call onAuthFailed when refresh fails due to DNS error', async () => {
    const dnsErr = new Error('getaddrinfo ENOTFOUND trackflow.codeupscale.com');
    dnsErr.code = 'ENOTFOUND';
    axios.post.mockRejectedValueOnce(dnsErr);

    const error = make401Error();
    await expect(interceptor.error(error)).rejects.toThrow('ENOTFOUND');

    expect(onAuthFailed).not.toHaveBeenCalled();
  });

  test('should NOT call onAuthFailed when refresh fails due to 500 server error', async () => {
    const serverErr = new Error('Request failed with status code 500');
    serverErr.response = { status: 500 };
    axios.post.mockRejectedValueOnce(serverErr);

    const error = make401Error();
    await expect(interceptor.error(error)).rejects.toThrow('500');

    expect(onAuthFailed).not.toHaveBeenCalled();
  });

  test('should NOT call onAuthFailed when refresh fails due to 502 gateway error', async () => {
    const gatewayErr = new Error('Request failed with status code 502');
    gatewayErr.response = { status: 502 };
    axios.post.mockRejectedValueOnce(gatewayErr);

    const error = make401Error();
    await expect(interceptor.error(error)).rejects.toThrow('502');

    expect(onAuthFailed).not.toHaveBeenCalled();
  });

  test('should NOT call onAuthFailed when refresh fails due to connection refused', async () => {
    const connErr = new Error('connect ECONNREFUSED 127.0.0.1:443');
    connErr.code = 'ECONNREFUSED';
    axios.post.mockRejectedValueOnce(connErr);

    const error = make401Error();
    await expect(interceptor.error(error)).rejects.toThrow('ECONNREFUSED');

    expect(onAuthFailed).not.toHaveBeenCalled();
  });

  // ── CRITICAL: Genuine auth failures SHOULD trigger logout ──

  test('should call onAuthFailed when refresh returns 401 (invalid refresh token)', async () => {
    const authErr = new Error('Request failed with status code 401');
    authErr.response = { status: 401, data: { message: 'Invalid refresh token' } };
    axios.post.mockRejectedValueOnce(authErr);

    const error = make401Error();
    await expect(interceptor.error(error)).rejects.toThrow('401');

    // CRITICAL assertion: onAuthFailed MUST be called for genuine auth failures
    expect(onAuthFailed).toHaveBeenCalledTimes(1);
    expect(onAuthFailed).toHaveBeenCalledWith(authErr);
  });

  test('should call onAuthFailed when refresh returns 403 (token revoked)', async () => {
    const authErr = new Error('Request failed with status code 403');
    authErr.response = { status: 403, data: { message: 'Token revoked' } };
    axios.post.mockRejectedValueOnce(authErr);

    const error = make401Error();
    await expect(interceptor.error(error)).rejects.toThrow('403');

    expect(onAuthFailed).toHaveBeenCalledTimes(1);
    expect(onAuthFailed).toHaveBeenCalledWith(authErr);
  });

  // ── Edge cases ──

  test('should not attempt refresh for non-401 errors', async () => {
    const error = make500Error();
    await expect(interceptor.error(error)).rejects.toBe(error);

    expect(axios.post).not.toHaveBeenCalled();
    expect(onAuthFailed).not.toHaveBeenCalled();
  });

  test('should not attempt refresh on the refresh endpoint itself', async () => {
    const error = make401Error('/auth/refresh');
    await expect(interceptor.error(error)).rejects.toBe(error);

    expect(axios.post).not.toHaveBeenCalled();
    expect(onAuthFailed).not.toHaveBeenCalled();
  });

  test('should not attempt refresh when no refresh token', async () => {
    client.refreshToken = null;
    // Need to recreate client without refresh token
    const clientNoRefresh = new ApiClient('test-token', null);
    clientNoRefresh.onAuthFailed(onAuthFailed);
    const newInterceptor = axios.__getResponseInterceptor();

    const error = make401Error();
    await expect(newInterceptor.error(error)).rejects.toBe(error);

    expect(onAuthFailed).not.toHaveBeenCalled();
  });

  test('should only retry once per request (_retry flag)', async () => {
    const error = make401Error();
    error.config._retry = true; // Already retried

    await expect(interceptor.error(error)).rejects.toBe(error);

    expect(axios.post).not.toHaveBeenCalled();
    expect(onAuthFailed).not.toHaveBeenCalled();
  });

  // ── Token refresh coalescing ──

  test('concurrent 401s should share a single refresh call', async () => {
    axios.post.mockResolvedValueOnce({
      data: { access_token: 'shared-access', refresh_token: 'shared-refresh' },
    });

    const callableClient = axios.create.mock.results[0].value;
    callableClient.mockResolvedValue({ data: { ok: true } });

    const error1 = make401Error('/timer/status');
    const error2 = {
      response: { status: 401 },
      config: { url: '/projects', headers: {}, _retry: false },
    };

    const [result1, result2] = await Promise.all([
      interceptor.error(error1),
      interceptor.error(error2),
    ]);

    // Only one refresh call should have been made
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(onAuthFailed).not.toHaveBeenCalled();
  });
});

describe('ApiClient Token Persistence', () => {
  let client;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new ApiClient('test-token', 'test-refresh');
  });

  test('onTokenRefreshed callback should receive new tokens after refresh', async () => {
    const tokenCallback = jest.fn();
    client.onTokenRefreshed(tokenCallback);

    axios.post.mockResolvedValueOnce({
      data: { access_token: 'new-access', refresh_token: 'new-refresh' },
    });

    await client._doRefresh();

    expect(tokenCallback).toHaveBeenCalledWith('new-access', 'new-refresh');
    expect(client.refreshToken).toBe('new-refresh');
  });

  test('login returns requires_org_selection without setting tokens', async () => {
    const mockAxios = axios.__mockInstance;
    mockAxios.post.mockResolvedValueOnce({
      data: {
        requires_org_selection: true,
        organizations: [{ id: 'org-1', name: 'Org 1' }],
      },
    });

    const result = await client.login('test@example.com', 'password');

    expect(result.requires_org_selection).toBe(true);
    // Token should NOT have been set
    expect(mockAxios.defaults.headers.common['Authorization']).toBe('Bearer test-token');
  });

  test('selectOrganization should set tokens', async () => {
    const mockAxios = axios.__mockInstance;
    mockAxios.post.mockResolvedValueOnce({
      data: { access_token: 'org-access', refresh_token: 'org-refresh' },
    });

    await client.selectOrganization({ organization_id: 'org-1', email: 'test@example.com', password: 'pass' });

    expect(mockAxios.defaults.headers.common['Authorization']).toBe('Bearer org-access');
    expect(client.refreshToken).toBe('org-refresh');
  });
});
