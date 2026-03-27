const fs = require('fs');
const path = require('path');
const OfflineQueue = require('../src/main/offline-queue');

// Mock fs for file operations
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: jest.fn(() => true),
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    readFileSync: jest.fn(() => Buffer.alloc(1000, 0x42)),
    unlinkSync: jest.fn(),
    readdirSync: jest.fn(() => []),
  };
});

describe('OfflineQueue', () => {
  let queue;

  beforeEach(() => {
    jest.clearAllMocks();
    queue = new OfflineQueue();
  });

  afterEach(() => {
    queue.close();
  });

  test('should initialize without errors', () => {
    expect(queue).toBeDefined();
    expect(queue.db).toBeDefined();
  });

  test('should create screenshot directory on init', () => {
    // existsSync returns true so mkdirSync may not be called,
    // but _screenshotDir should be set
    expect(queue._screenshotDir).toContain('offline-screenshots');
  });

  test('add should not throw when db is null', () => {
    queue.db = null;
    expect(() => queue.add('heartbeat', { test: 1 })).not.toThrow();
  });

  test('add screenshot saves buffer to file and stores path in SQLite', () => {
    const buffer = Buffer.alloc(5000, 0x42);
    queue.add('screenshot', {
      buffer: buffer,
      time_entry_id: 'entry-1',
      captured_at: '2026-01-01T00:00:00.000Z',
    });

    // Should write the file to disk
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('offline-screenshots'),
      buffer
    );
  });

  test('add screenshot rejects oversized buffers', () => {
    const hugeBuffer = Buffer.alloc(3 * 1024 * 1024); // 3MB > 2MB limit
    queue.add('screenshot', {
      buffer: hugeBuffer,
      time_entry_id: 'entry-1',
      captured_at: '2026-01-01T00:00:00.000Z',
    });

    // Should NOT write file for oversized buffer
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  test('add heartbeat stores data normally (no file)', () => {
    queue.add('heartbeat', { test: 1 });
    // No file write for heartbeats
    expect(fs.writeFileSync).not.toHaveBeenCalled();
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

  test('cleanupOrphanedFiles does not throw when db is null', () => {
    queue.db = null;
    expect(() => queue.cleanupOrphanedFiles()).not.toThrow();
  });
});
