const OfflineQueue = require('../src/main/offline-queue');

describe('OfflineQueue', () => {
  let queue;

  beforeEach(() => {
    queue = new OfflineQueue();
  });

  afterEach(() => {
    queue.close();
  });

  test('should initialize without errors', () => {
    expect(queue).toBeDefined();
    expect(queue.db).toBeDefined();
  });

  test('add should not throw when db is null', () => {
    queue.db = null;
    expect(() => queue.add('heartbeat', { test: 1 })).not.toThrow();
  });

  test('getQueueSize should return 0 when db is null', () => {
    queue.db = null;
    expect(queue.getQueueSize()).toBe(0);
  });

  test('getQueueSize should return count', () => {
    // Mock returns 0 by default
    expect(queue.getQueueSize()).toBe(0);
  });

  test('flush should not throw when db is null', async () => {
    queue.db = null;
    await expect(queue.flush({})).resolves.not.toThrow();
  });

  test('flush should not run concurrently', async () => {
    queue.flushing = true;
    const mockClient = { bulkUploadLogs: jest.fn() };
    await queue.flush(mockClient);
    expect(mockClient.bulkUploadLogs).not.toHaveBeenCalled();
  });

  test('close should set db to null', () => {
    queue.close();
    expect(queue.db).toBeNull();
  });

  test('close should clear flush timer', () => {
    queue._flushTimer = setTimeout(() => {}, 10000);
    queue.close();
    expect(queue._flushTimer).toBeNull();
  });

  test('retryDelay should start at 5000ms', () => {
    expect(queue.retryDelay).toBe(5000);
  });

  test('maxRetryDelay should be 5 minutes', () => {
    expect(queue.maxRetryDelay).toBe(300000);
  });
});
