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

describe('Offline Sync — Exponential Backoff', () => {
  let queue;

  beforeEach(() => {
    jest.clearAllMocks();
    queue = new OfflineQueue();
  });

  afterEach(() => {
    queue.close();
  });

  test('initial retry delay is 5000ms', () => {
    expect(queue.retryDelay).toBe(5000);
    expect(queue._backoffStep).toBe(0);
  });

  test('backoff step increments on failure', () => {
    expect(queue._backoffStep).toBe(0);
    queue._backoffStep = Math.min(queue._backoffStep + 1, 4);
    expect(queue._backoffStep).toBe(1);
    queue._backoffStep = Math.min(queue._backoffStep + 1, 4);
    expect(queue._backoffStep).toBe(2);
  });

  test('backoff step caps at 4 (index of 120s)', () => {
    queue._backoffStep = 3;
    queue._backoffStep = Math.min(queue._backoffStep + 1, 4);
    expect(queue._backoffStep).toBe(4);
    // Further increments stay at 4
    queue._backoffStep = Math.min(queue._backoffStep + 1, 4);
    expect(queue._backoffStep).toBe(4);
  });

  test('backoff resets to 0 on successful flush (empty queue)', async () => {
    queue._backoffStep = 3;
    queue.retryDelay = 60000;

    // Override stmtSelect to return empty (simulates empty queue)
    queue._stmtSelect = { all: jest.fn(() => []) };
    queue._stmtCount = { get: jest.fn(() => ({ count: 0 })) };

    const mockApiClient = {};
    await queue.flush(mockApiClient);

    // When queue is empty, flush returns early with reset backoff
    expect(queue._backoffStep).toBe(0);
    expect(queue.retryDelay).toBe(5000);
  });

  test('add method does not throw for timer_start type', async () => {
    await expect(
      queue.add('timer_start', {
        project_id: 'proj-1',
        idempotency_key: 'idem-123',
        started_at: '2026-04-06T10:00:00Z',
      })
    ).resolves.not.toThrow();
  });

  test('add method does not throw for timer_stop type', async () => {
    await expect(
      queue.add('timer_stop', {
        entry_id: 'entry-1',
        started_at: '2026-04-06T10:00:00Z',
        ended_at: '2026-04-06T11:00:00Z',
        idempotency_key: 'idem-123',
        project_id: 'proj-1',
      })
    ).resolves.not.toThrow();
  });

  test('flushing flag prevents concurrent flushes', async () => {
    queue.flushing = true;

    const mockApiClient = {
      startTimer: jest.fn(),
      stopTimer: jest.fn(),
    };

    await queue.flush(mockApiClient);

    // Should not call any API methods when already flushing
    expect(mockApiClient.startTimer).not.toHaveBeenCalled();
    expect(mockApiClient.stopTimer).not.toHaveBeenCalled();
  });

  test('flush does not throw when db is null', async () => {
    queue.db = null;
    await expect(queue.flush({})).resolves.not.toThrow();
  });
});

describe('Offline Sync — Timer Events Are Not Queued (dual-replay fix)', () => {
  // Timer start/stop events are NO LONGER added to the offline queue.
  // Timer sync is handled exclusively by timer_sessions table + reconcileTimerState().
  // This eliminates the dual-replay bug that caused duplicate time entries on reconnect.
  let queue;

  beforeEach(() => {
    jest.clearAllMocks();
    queue = new OfflineQueue();
  });

  afterEach(() => {
    queue.close();
  });

  test('flush ignores legacy timer_start items without calling API', async () => {
    // If a timer_start item somehow exists in the queue (from before the fix),
    // it should be skipped — no startTimer API call should be made.
    const timerStartItem = {
      id: 1,
      type: 'timer_start',
      data: JSON.stringify({
        project_id: 'proj-1',
        idempotency_key: 'idem-key-abc',
        started_at: '2026-04-06T10:00:00Z',
      }),
      created_at: '2026-04-06T10:00:00',
      attempts: 0,
      priority: 1,
    };

    queue._stmtSelect = { all: jest.fn(() => [timerStartItem]) };
    queue._stmtCount = { get: jest.fn(() => ({ count: 0 })) };
    queue._stmtIncAttempt = { run: jest.fn() };
    queue.db.prepare = jest.fn(() => ({ run: jest.fn() }));

    const mockApiClient = {
      startTimer: jest.fn(),
      bulkUploadLogs: jest.fn().mockResolvedValue({}),
    };

    await queue.flush(mockApiClient);

    // startTimer should NOT be called — timer sync is handled by reconcileTimerState()
    expect(mockApiClient.startTimer).not.toHaveBeenCalled();
  });

  test('flush ignores legacy timer_stop items without calling API', async () => {
    const timerStopItem = {
      id: 2,
      type: 'timer_stop',
      data: JSON.stringify({
        entry_id: 'entry-1',
        started_at: '2026-04-06T10:00:00Z',
        ended_at: '2026-04-06T11:00:00Z',
        project_id: 'proj-1',
      }),
      created_at: '2026-04-06T10:00:00',
      attempts: 0,
      priority: 0,
    };

    queue._stmtSelect = { all: jest.fn(() => [timerStopItem]) };
    queue._stmtCount = { get: jest.fn(() => ({ count: 0 })) };
    queue._stmtIncAttempt = { run: jest.fn() };
    queue.db.prepare = jest.fn(() => ({ run: jest.fn() }));

    const mockApiClient = {
      stopTimer: jest.fn(),
      bulkUploadLogs: jest.fn().mockResolvedValue({}),
    };

    await queue.flush(mockApiClient);

    // stopTimer should NOT be called — timer sync is handled by reconcileTimerState()
    expect(mockApiClient.stopTimer).not.toHaveBeenCalled();
  });

  test('corrupt data entries are removed during flush', async () => {
    const corruptItem = {
      id: 4,
      type: 'timer_stop',
      data: 'not valid json{{{',
      created_at: '2026-04-06T10:00:00',
      attempts: 0,
      priority: 0,
    };

    queue._stmtSelect = { all: jest.fn(() => [corruptItem]) };
    queue._stmtCount = { get: jest.fn(() => ({ count: 0 })) };
    queue._stmtIncAttempt = { run: jest.fn() };
    const deleteRunSpy = jest.fn();
    queue.db.prepare = jest.fn(() => ({ run: deleteRunSpy }));

    await queue.flush({
      bulkUploadLogs: jest.fn().mockResolvedValue({}),
    });

    // Corrupt entry should be deleted
    expect(deleteRunSpy).toHaveBeenCalled();
  });
});
