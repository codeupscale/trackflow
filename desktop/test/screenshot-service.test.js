const { desktopCapturer, Notification, screen, systemPreferences } = require('electron');

// Mock dialog and shell (used for permission prompts)
jest.mock('electron', () => {
  const actual = jest.requireActual('electron');
  return {
    ...actual,
    dialog: {
      showMessageBox: jest.fn().mockResolvedValue({ response: 1 }),
    },
    shell: {
      ...actual.shell,
      openExternal: jest.fn().mockResolvedValue(),
    },
  };
});
const ScreenshotService = require('../src/main/screenshot-service');

// Mock sharp
jest.mock('sharp', () => {
  const instance = {
    blur: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    composite: jest.fn().mockReturnThis(),
    metadata: jest.fn().mockResolvedValue({ width: 1920, height: 1080 }),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('mock-jpeg')),
  };
  const sharpFn = jest.fn(() => instance);
  sharpFn._instance = instance;
  return sharpFn;
});

describe('ScreenshotService', () => {
  let service;
  let mockApiClient;
  let mockOfflineQueue;
  let mockConfig;
  let mockGetIsAppVisible;

  // Create a mock NativeImage with realistic size
  function makeMockImage(empty = false, width = 1920, height = 1080) {
    return {
      isEmpty: jest.fn(() => empty),
      toJPEG: jest.fn((quality) => Buffer.from(`jpeg-q${quality}`)),
      toPNG: jest.fn(() => Buffer.from('png-data')),
      getSize: jest.fn(() => empty ? { width: 0, height: 0 } : { width, height }),
    };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    mockApiClient = {
      uploadScreenshot: jest.fn().mockResolvedValue({ screenshot: { id: '1' } }),
    };
    mockOfflineQueue = {
      add: jest.fn(),
    };
    mockConfig = {
      screenshot_interval: 5,
      screenshot_first_capture_delay_min: 0,
      blur_screenshots: false,
      capture_only_when_visible: false,
      capture_multi_monitor: false,
    };
    mockGetIsAppVisible = jest.fn(() => true);

    // Default: one screen source available
    desktopCapturer.getSources.mockResolvedValue([{
      id: 'screen:0:0',
      name: 'Entire Screen',
      thumbnail: makeMockImage(false),
      display_id: '1',
    }]);

    // macOS screen permission granted
    systemPreferences.getMediaAccessStatus.mockReturnValue('granted');

    service = new ScreenshotService(mockApiClient, mockConfig, mockOfflineQueue, mockGetIsAppVisible);
  });

  afterEach(() => {
    service.stop();
    jest.useRealTimers();
  });

  // ── Lifecycle ──

  test('start sets currentEntryId and stops previous session', () => {
    service.start('entry-1');
    expect(service.currentEntryId).toBe('entry-1');
  });

  test('stop clears all state', () => {
    service.start('entry-1');
    service.stop();
    expect(service.currentEntryId).toBeNull();
    expect(service.interval).toBeNull();
    expect(service._capturing).toBe(false);
  });

  test('stop prevents further captures', async () => {
    service.start('entry-1');
    service.stop();
    await service.capture();
    expect(desktopCapturer.getSources).not.toHaveBeenCalled();
  });

  // ── Single Monitor Capture ──

  test('capture uploads screenshot on success', async () => {
    service.currentEntryId = 'entry-1';
    await service.capture();
    expect(desktopCapturer.getSources).toHaveBeenCalledWith({
      types: ['screen'],
      thumbnailSize: expect.any(Object),
    });
    expect(mockApiClient.uploadScreenshot).toHaveBeenCalled();
    expect(service._consecutiveFailures).toBe(0);
  });

  test('capture does nothing when no entryId', async () => {
    service.currentEntryId = null;
    await service.capture();
    expect(desktopCapturer.getSources).not.toHaveBeenCalled();
  });

  test('capture does nothing when already capturing', async () => {
    service.currentEntryId = 'entry-1';
    service._capturing = true;
    await service.capture();
    expect(desktopCapturer.getSources).not.toHaveBeenCalled();
  });

  test('capture handles empty sources array', async () => {
    service.currentEntryId = 'entry-1';
    desktopCapturer.getSources.mockResolvedValue([]);
    await service.capture();
    expect(mockApiClient.uploadScreenshot).not.toHaveBeenCalled();
    expect(service._consecutiveFailures).toBe(1);
  });

  test('capture handles empty thumbnail', async () => {
    service.currentEntryId = 'entry-1';
    desktopCapturer.getSources.mockResolvedValue([{
      id: 'screen:0:0',
      name: 'Entire Screen',
      thumbnail: makeMockImage(true), // isEmpty = true
      display_id: '1',
    }]);
    await service.capture();
    expect(mockApiClient.uploadScreenshot).not.toHaveBeenCalled();
    expect(service._consecutiveFailures).toBe(1);
  });

  // ── macOS Permission ──

  test('capture always attempts even when macOS reports denied (permission API is unreliable)', async () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    systemPreferences.getMediaAccessStatus.mockReturnValue('denied');
    service.currentEntryId = 'entry-1';
    await service.capture();

    // Should still attempt capture — permission check is informational only
    expect(desktopCapturer.getSources).toHaveBeenCalled();

    Object.defineProperty(process, 'platform', { value: origPlatform });
  });

  test('shows permission dialog when sources are empty on macOS', async () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const { dialog } = require('electron');

    desktopCapturer.getSources.mockResolvedValue([]);
    service.currentEntryId = 'entry-1';
    await service.capture();

    expect(service._consecutiveFailures).toBe(1);
    expect(dialog.showMessageBox).toHaveBeenCalled();

    Object.defineProperty(process, 'platform', { value: origPlatform });
  });

  // ── capture_only_when_visible ──

  test('skips capture when capture_only_when_visible and app not visible', async () => {
    service.config.capture_only_when_visible = true;
    mockGetIsAppVisible.mockReturnValue(false);
    service.currentEntryId = 'entry-1';
    await service.capture();
    expect(desktopCapturer.getSources).not.toHaveBeenCalled();
    // No failure increment — this is expected behavior
    expect(service._consecutiveFailures).toBe(0);
  });

  test('captures when capture_only_when_visible and app IS visible', async () => {
    service.config.capture_only_when_visible = true;
    mockGetIsAppVisible.mockReturnValue(true);
    service.currentEntryId = 'entry-1';
    await service.capture();
    expect(desktopCapturer.getSources).toHaveBeenCalled();
    expect(mockApiClient.uploadScreenshot).toHaveBeenCalled();
  });

  // ── Failure Tracking ──

  test('pauses after MAX_CONSECUTIVE_FAILURES', async () => {
    service.currentEntryId = 'entry-1';
    desktopCapturer.getSources.mockResolvedValue([]);

    for (let i = 0; i < 5; i++) {
      await service.capture();
    }

    expect(service._consecutiveFailures).toBe(5);
    // After 5 failures, interval should be cleared
    expect(service.interval).toBeNull();
  });

  test('resumes after pause timeout', async () => {
    service.currentEntryId = 'entry-1';
    service._intervalMs = 60000;
    desktopCapturer.getSources.mockResolvedValue([]);

    for (let i = 0; i < 5; i++) {
      await service.capture();
    }
    expect(service._pauseTimeout).not.toBeNull();

    // Reset sources to succeed
    desktopCapturer.getSources.mockResolvedValue([{
      id: 'screen:0:0',
      name: 'Entire Screen',
      thumbnail: makeMockImage(false),
      display_id: '1',
    }]);

    // Advance past pause (5 minutes)
    jest.advanceTimersByTime(5 * 60 * 1000);
    expect(service._consecutiveFailures).toBe(0);
  });

  // ── Upload & Offline Queue ──

  test('queues screenshot offline when upload fails', async () => {
    service.currentEntryId = 'entry-1';
    mockApiClient.uploadScreenshot.mockRejectedValueOnce(new Error('Network error'));

    await service.capture();

    expect(mockOfflineQueue.add).toHaveBeenCalledWith('screenshot', expect.objectContaining({
      time_entry_id: 'entry-1',
      captured_at: expect.any(String),
      buffer: expect.any(String), // base64
    }));
  });

  // ── Blur ──

  test('applies blur when configured', async () => {
    const sharp = require('sharp');
    service.config.blur_screenshots = true;
    service.currentEntryId = 'entry-1';

    await service.capture();

    expect(sharp._instance.blur).toHaveBeenCalledWith(15);
    expect(mockApiClient.uploadScreenshot).toHaveBeenCalled();
  });

  // ── Notification ──

  test('shows notification after successful capture', async () => {
    service.currentEntryId = 'entry-1';
    await service.capture();
    expect(Notification).toHaveBeenCalledWith(expect.objectContaining({
      title: 'TrackFlow',
      body: 'Screenshot captured',
    }));
  });

  // ── Interval timing ──

  test('starts interval after first capture', async () => {
    service.start('entry-1');
    // With firstDelayMs = 0, capture is called via setImmediate
    // Flush microtasks and macro tasks
    await jest.advanceTimersByTimeAsync(10);
    expect(service.interval).not.toBeNull();
  });
});
