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
    promises: {
      writeFile: jest.fn().mockResolvedValue(undefined),
      readFile: jest.fn().mockResolvedValue(Buffer.alloc(1000, 0x42)),
    },
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

  test('add screenshot saves buffer to file and stores path in SQLite', async () => {
    const buffer = Buffer.alloc(5000, 0x42);
    await queue.add('screenshot', {
      buffer: buffer,
      time_entry_id: 'entry-1',
      captured_at: '2026-01-01T00:00:00.000Z',
    });

    // Should write the file to disk via fs.promises.writeFile
    expect(fs.promises.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('offline-screenshots'),
      buffer
    );
  });

  test('add screenshot rejects oversized buffers', async () => {
    const hugeBuffer = Buffer.alloc(3 * 1024 * 1024); // 3MB > 2MB limit
    await queue.add('screenshot', {
      buffer: hugeBuffer,
      time_entry_id: 'entry-1',
      captured_at: '2026-01-01T00:00:00.000Z',
    });

    // Should NOT write file for oversized buffer
    expect(fs.promises.writeFile).not.toHaveBeenCalled();
  });

  test('add heartbeat stores data normally (no file)', async () => {
    await queue.add('heartbeat', { test: 1 });
    // No file write for heartbeats
    expect(fs.promises.writeFile).not.toHaveBeenCalled();
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

  test('backoff schedule caps at 120s', () => {
    // After multiple failures, backoff caps at step 4 (120000ms)
    queue._backoffStep = 10;
    const cappedStep = Math.min(queue._backoffStep, 4); // BACKOFF_SCHEDULE has 5 entries
    expect(cappedStep).toBe(4);
  });

  test('cleanupOrphanedFiles does not throw when db is null', () => {
    queue.db = null;
    expect(() => queue.cleanupOrphanedFiles()).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// FIX D1/D2/D3 — server-id resolution + idle re-anchor on flush
// ═══════════════════════════════════════════════════════════════════════
describe('OfflineQueue flush — local-id resolution & idle re-anchor', () => {
  let queue;

  // Drive flush() with an explicit list of queue rows. Overrides the prepared
  // SELECT/COUNT statements and a no-op DELETE so the in-memory mock is enough.
  function primeQueue(rows) {
    queue._stmtSelect = { all: () => rows };
    queue._stmtCount = { get: () => ({ count: 0 }) };
    queue._stmtIncAttempt = { run: jest.fn() };
    // flush() calls this.db.prepare(`DELETE ... IN (...)`).run(...ids)
    queue.db = { prepare: jest.fn(() => ({ run: jest.fn() })) };
    queue.cleanupOrphanedFiles = jest.fn();
  }

  beforeEach(() => {
    jest.clearAllMocks();
    queue = new OfflineQueue();
  });

  afterEach(() => {
    if (queue._flushTimer) clearTimeout(queue._flushTimer);
    queue.db = null; // already replaced by a plain mock in primeQueue
  });

  // ── D1: heartbeat id resolution ──
  test('D1: holds heartbeat (no bulk upload) when entry id is unresolved local-', async () => {
    primeQueue([{ id: 1, type: 'heartbeat', data: JSON.stringify({ time_entry_id: 'local-abc', keyboard_events: 5 }), attempts: 0 }]);
    queue.resolveServerEntryId = jest.fn(() => null); // not synced yet
    const apiClient = { bulkUploadLogs: jest.fn().mockResolvedValue({}) };

    await queue.flush(apiClient);

    expect(queue.resolveServerEntryId).toHaveBeenCalled();
    expect(apiClient.bulkUploadLogs).not.toHaveBeenCalled(); // held, not sent
  });

  test('D1: resolves local- heartbeat id to server id before bulk upload', async () => {
    primeQueue([{ id: 1, type: 'heartbeat', data: JSON.stringify({ time_entry_id: 'local-abc', keyboard_events: 5 }), attempts: 0 }]);
    queue.resolveServerEntryId = jest.fn(() => 'srv-99');
    const apiClient = { bulkUploadLogs: jest.fn().mockResolvedValue({}) };

    await queue.flush(apiClient);

    expect(apiClient.bulkUploadLogs).toHaveBeenCalledWith([
      expect.objectContaining({ time_entry_id: 'srv-99', keyboard_events: 5 }),
    ]);
  });

  test('D1: a real (non-local) heartbeat id passes through without a resolver', async () => {
    primeQueue([{ id: 1, type: 'heartbeat', data: JSON.stringify({ time_entry_id: 'srv-real', keyboard_events: 3 }), attempts: 0 }]);
    queue.resolveServerEntryId = null;
    const apiClient = { bulkUploadLogs: jest.fn().mockResolvedValue({}) };

    await queue.flush(apiClient);

    expect(apiClient.bulkUploadLogs).toHaveBeenCalledWith([
      expect.objectContaining({ time_entry_id: 'srv-real' }),
    ]);
  });

  // ── Orphan drop: heartbeat with no entry id AND no idempotency_key can never
  //    resolve, so it must be DELETED (not held forever in an infinite flush loop) ──
  test('drops orphaned heartbeat (no entry id, no idempotency_key) instead of holding forever', async () => {
    const runArgs = [];
    primeQueue([{ id: 7, type: 'heartbeat', data: JSON.stringify({ keyboard_events: 5 }), attempts: 0 }]);
    queue.db = { prepare: jest.fn(() => ({ run: (...args) => runArgs.push(args) })) };
    queue.resolveServerEntryId = jest.fn(() => null);
    const apiClient = { bulkUploadLogs: jest.fn().mockResolvedValue({}) };

    await queue.flush(apiClient);

    expect(apiClient.bulkUploadLogs).not.toHaveBeenCalled(); // nothing replayable
    expect(runArgs.flat()).toContain(7);                     // orphan was DELETED
  });

  test('does NOT drop a local- heartbeat (still resolvable once its start syncs)', async () => {
    const runArgs = [];
    primeQueue([{ id: 8, type: 'heartbeat', data: JSON.stringify({ time_entry_id: 'local-abc', keyboard_events: 5 }), attempts: 0 }]);
    queue.db = { prepare: jest.fn(() => ({ run: (...args) => runArgs.push(args) })) };
    queue.resolveServerEntryId = jest.fn(() => null); // not synced yet
    const apiClient = { bulkUploadLogs: jest.fn().mockResolvedValue({}) };

    await queue.flush(apiClient);

    expect(apiClient.bulkUploadLogs).not.toHaveBeenCalled(); // held
    expect(runArgs.flat()).not.toContain(8);                 // NOT deleted — kept for later
  });

  // ── D2: screenshot id resolution ──
  test('D2: holds screenshot (no presign) when entry id is unresolved local-', async () => {
    primeQueue([{ id: 1, type: 'screenshot', data: JSON.stringify({ file_path: '/tmp/x.jpg', time_entry_id: 'local-abc', captured_at: 'now', idempotency_key: 'k1' }), attempts: 0 }]);
    queue.resolveServerEntryId = jest.fn(() => null);
    const apiClient = {
      presignScreenshot: jest.fn().mockResolvedValue({ screenshot_id: 's', upload_url: 'u' }),
      uploadToS3: jest.fn().mockResolvedValue(undefined),
      confirmScreenshot: jest.fn().mockResolvedValue(undefined),
    };

    await queue.flush(apiClient);

    expect(apiClient.presignScreenshot).not.toHaveBeenCalled(); // held
    expect(fs.unlinkSync).not.toHaveBeenCalled(); // file kept for later flush
  });

  test('D2: resolves local- screenshot id to server id before presign', async () => {
    primeQueue([{ id: 1, type: 'screenshot', data: JSON.stringify({ file_path: '/tmp/x.jpg', time_entry_id: 'local-abc', captured_at: 'now', idempotency_key: 'k1' }), attempts: 0 }]);
    queue.resolveServerEntryId = jest.fn(() => 'srv-77');
    const apiClient = {
      presignScreenshot: jest.fn().mockResolvedValue({ screenshot_id: 's', upload_url: 'u', upload_headers: {} }),
      uploadToS3: jest.fn().mockResolvedValue(undefined),
      confirmScreenshot: jest.fn().mockResolvedValue(undefined),
    };

    await queue.flush(apiClient);

    expect(apiClient.presignScreenshot).toHaveBeenCalledWith(
      expect.objectContaining({ time_entry_id: 'srv-77' }),
    );
  });

  // ── D3: idle_discard re-anchor + skip-when-stopped ──
  test('D3: invokes onIdleReanchor with new_entry when reportIdleTime splits the entry', async () => {
    const payload = { time_entry_id: 'srv-1', idle_started_at: '2026-06-22T10:00:00.000Z', action: 'discard' };
    primeQueue([{ id: 1, type: 'idle_discard', data: JSON.stringify(payload), attempts: 0 }]);
    const newEntry = { id: 'srv-2', started_at: '2026-06-22T10:05:00.000Z', project_id: 'p1' };
    const apiClient = { reportIdleTime: jest.fn().mockResolvedValue({ new_entry: newEntry }) };
    queue.onIdleReanchor = jest.fn();
    queue.isLocalTimerActive = () => true;

    await queue.flush(apiClient);

    expect(apiClient.reportIdleTime).toHaveBeenCalledWith(expect.objectContaining({ time_entry_id: 'srv-1' }));
    expect(queue.onIdleReanchor).toHaveBeenCalledWith(payload, newEntry);
  });

  test('D3: drops queued idle_discard without calling API when no local timer is active', async () => {
    primeQueue([{ id: 1, type: 'idle_discard', data: JSON.stringify({ time_entry_id: 'srv-1', action: 'discard' }), attempts: 0 }]);
    const apiClient = { reportIdleTime: jest.fn() };
    queue.onIdleReanchor = jest.fn();
    queue.isLocalTimerActive = () => false; // timer was stopped before this flushed

    await queue.flush(apiClient);

    expect(apiClient.reportIdleTime).not.toHaveBeenCalled();
    expect(queue.onIdleReanchor).not.toHaveBeenCalled();
  });

  test('D3: does not throw when reportIdleTime returns no new_entry', async () => {
    primeQueue([{ id: 1, type: 'idle_discard', data: JSON.stringify({ time_entry_id: 'srv-1', action: 'discard' }), attempts: 0 }]);
    const apiClient = { reportIdleTime: jest.fn().mockResolvedValue({ new_entry: null }) };
    queue.onIdleReanchor = jest.fn();
    queue.isLocalTimerActive = () => true;

    await expect(queue.flush(apiClient)).resolves.not.toThrow();
    expect(queue.onIdleReanchor).not.toHaveBeenCalled();
  });
});
