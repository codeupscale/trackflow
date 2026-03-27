const { desktopCapturer, Notification, screen, systemPreferences, powerMonitor, dialog } = require('electron');
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
  let mockActivityMonitor;

  // Create a mock NativeImage with realistic size
  function makeMockImage(empty = false, width = 1920, height = 1080, jpegSize = 50000) {
    return {
      isEmpty: jest.fn(() => empty),
      toJPEG: jest.fn((quality) => Buffer.alloc(jpegSize, 0x42)),
      toPNG: jest.fn(() => Buffer.alloc(jpegSize, 0x89)),
      getSize: jest.fn(() => empty ? { width: 0, height: 0 } : { width, height }),
    };
  }

  function makeScreenSource(id, name, thumbnail = null) {
    return {
      id,
      name,
      display_id: id.startsWith('screen:') ? id.split(':')[1] : '',
      thumbnail: thumbnail || makeMockImage(),
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
    mockActivityMonitor = {
      getActiveApp: jest.fn().mockResolvedValue('VS Code'),
      getActiveWindowTitle: jest.fn().mockResolvedValue('index.js - trackflow'),
      getCurrentScore: jest.fn().mockReturnValue(75),
    };

    // Default: one screen source with realistic 50KB JPEG
    const bigImage = makeMockImage(false, 1920, 1080, 50000);
    desktopCapturer.getSources.mockResolvedValue([{
      id: 'screen:0:0',
      name: 'Entire Screen',
      thumbnail: bigImage,
      display_id: '1',
    }]);

    systemPreferences.getMediaAccessStatus.mockReturnValue('granted');
    powerMonitor.getSystemIdleTime.mockReturnValue(0);

    screen.getAllDisplays.mockReturnValue([{
      size: { width: 1920, height: 1080 },
      scaleFactor: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      id: 1,
    }]);
    screen.getCursorScreenPoint.mockReturnValue({ x: 500, y: 500 });
    screen.getDisplayNearestPoint.mockReturnValue({
      size: { width: 1920, height: 1080 },
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      id: 1,
    });

    service = new ScreenshotService(mockApiClient, mockConfig, mockOfflineQueue, mockGetIsAppVisible, mockActivityMonitor);
  });

  afterEach(() => {
    service.stop();
    jest.useRealTimers();
  });

  // ═════════════════════════════════════════════════════════════════
  // ── Constructor & Initial State ──
  // ═════════════════════════════════════════════════════════════════

  describe('constructor', () => {
    test('initializes with correct default state', () => {
      expect(service.currentEntryId).toBeNull();
      expect(service._capturing).toBe(false);
      expect(service._consecutiveFailures).toBe(0);
      expect(service._intervalTimer).toBeNull();
      expect(service.initialTimeout).toBeNull();
      expect(service._intervalMs).toBe(0);
    });

    test('stores dependencies correctly', () => {
      expect(service.apiClient).toBe(mockApiClient);
      expect(service.config).toBe(mockConfig);
      expect(service.offlineQueue).toBe(mockOfflineQueue);
      expect(service.activityMonitor).toBe(mockActivityMonitor);
    });

    test('accepts function getIsAppVisible', () => {
      const fn = () => true;
      const svc = new ScreenshotService(mockApiClient, mockConfig, mockOfflineQueue, fn);
      expect(svc.getIsAppVisible).toBe(fn);
    });

    test('ignores non-function getIsAppVisible', () => {
      const svc = new ScreenshotService(mockApiClient, mockConfig, mockOfflineQueue, 'not-a-fn');
      expect(svc.getIsAppVisible).toBeNull();
    });

    test('accepts null activityMonitor', () => {
      const svc = new ScreenshotService(mockApiClient, mockConfig, mockOfflineQueue, null, null);
      expect(svc.activityMonitor).toBeNull();
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // ── start() ──
  // ═════════════════════════════════════════════════════════════════

  describe('start()', () => {
    test('sets currentEntryId and resets failure counter', () => {
      service._consecutiveFailures = 3;
      service.start('entry-1');
      expect(service.currentEntryId).toBe('entry-1');
      expect(service._consecutiveFailures).toBe(0);
    });

    test('stops any existing capture before starting new one', () => {
      const stopSpy = jest.spyOn(service, 'stop');
      service.start('entry-1');
      service.start('entry-2');
      expect(stopSpy).toHaveBeenCalledTimes(2);
      expect(service.currentEntryId).toBe('entry-2');
    });

    test('captures immediately when firstDelayMs is 0', async () => {
      mockConfig.screenshot_first_capture_delay_min = 0;
      const captureSpy = jest.spyOn(service, 'capture').mockResolvedValue();
      service.start('entry-1');
      await jest.advanceTimersByTimeAsync(10);
      expect(captureSpy).toHaveBeenCalled();
    });

    test('captures immediately when immediateCapture option is true', async () => {
      mockConfig.screenshot_first_capture_delay_min = 5; // normally would wait
      const captureSpy = jest.spyOn(service, 'capture').mockResolvedValue();
      service.start('entry-1', { immediateCapture: true });
      await jest.advanceTimersByTimeAsync(10);
      expect(captureSpy).toHaveBeenCalled();
    });

    test('sets initial timeout for first capture delay', () => {
      mockConfig.screenshot_first_capture_delay_min = 2;
      service.start('entry-1');
      expect(service.initialTimeout).not.toBeNull();
    });

    test('calculates interval from config', () => {
      mockConfig.screenshot_interval = 10;
      service.start('entry-1');
      expect(service._intervalMs).toBe(10 * 60 * 1000);
    });

    test('defaults screenshot_interval to 5 minutes', () => {
      delete mockConfig.screenshot_interval;
      service.start('entry-1');
      expect(service._intervalMs).toBe(5 * 60 * 1000);
    });

    test('resets permissionDialogShown flag', () => {
      service._permissionDialogShown = true;
      service.start('entry-1');
      expect(service._permissionDialogShown).toBe(false);
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // ── stop() ──
  // ═════════════════════════════════════════════════════════════════

  describe('stop()', () => {
    test('clears all timers and resets state', () => {
      service.start('entry-1');
      service.stop();
      expect(service.currentEntryId).toBeNull();
      expect(service.initialTimeout).toBeNull();
      expect(service._intervalTimer).toBeNull();
      expect(service._capturing).toBe(false);
    });

    test('clears pause timeout', () => {
      service._pauseTimeout = setTimeout(() => {}, 100000);
      service.stop();
      expect(service._pauseTimeout).toBeNull();
    });

    test('prevents further captures', async () => {
      service.start('entry-1');
      service.stop();
      await service.capture();
      expect(desktopCapturer.getSources).not.toHaveBeenCalled();
    });

    test('is safe to call when nothing is running', () => {
      expect(() => service.stop()).not.toThrow();
    });

    test('can be called multiple times safely', () => {
      service.start('entry-1');
      service.stop();
      service.stop();
      expect(service.currentEntryId).toBeNull();
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // ── capture() — Core ──
  // ═════════════════════════════════════════════════════════════════

  describe('capture()', () => {
    test('uploads screenshot on success', async () => {
      service.currentEntryId = 'entry-1';
      await service.capture();
      expect(desktopCapturer.getSources).toHaveBeenCalledWith({
        types: ['screen', 'window'],
        thumbnailSize: expect.any(Object),
        fetchWindowIcons: false,
      });
      expect(mockApiClient.uploadScreenshot).toHaveBeenCalled();
      expect(service._consecutiveFailures).toBe(0);
    });

    test('does nothing when no entryId', async () => {
      service.currentEntryId = null;
      await service.capture();
      expect(desktopCapturer.getSources).not.toHaveBeenCalled();
    });

    test('does nothing when already capturing', async () => {
      service.currentEntryId = 'entry-1';
      service._capturing = true;
      await service.capture();
      expect(desktopCapturer.getSources).not.toHaveBeenCalled();
    });

    test('resets _capturing flag after capture completes', async () => {
      service.currentEntryId = 'entry-1';
      await service.capture();
      expect(service._capturing).toBe(false);
    });

    test('resets _capturing flag on error', async () => {
      service.currentEntryId = 'entry-1';
      desktopCapturer.getSources.mockRejectedValue(new Error('Permission denied'));
      await service.capture();
      expect(service._capturing).toBe(false);
    });

    test('handles empty sources array', async () => {
      service.currentEntryId = 'entry-1';
      desktopCapturer.getSources.mockResolvedValue([]);
      await service.capture();
      expect(mockApiClient.uploadScreenshot).not.toHaveBeenCalled();
      expect(service._consecutiveFailures).toBe(1);
    });

    test('handles empty thumbnail', async () => {
      const origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      try {
        service.currentEntryId = 'entry-1';
        desktopCapturer.getSources.mockResolvedValue([{
          id: 'screen:0:0',
          name: 'Entire Screen',
          thumbnail: makeMockImage(true),
          display_id: '1',
        }]);
        await service.capture();
        expect(mockApiClient.uploadScreenshot).not.toHaveBeenCalled();
        expect(service._consecutiveFailures).toBe(1);
      } finally {
        Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
      }
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // ── capture() — Screen Lock / Idle Detection ──
  // ═════════════════════════════════════════════════════════════════

  describe('capture() idle detection', () => {
    test('skips capture when system idle exceeds threshold', async () => {
      service.currentEntryId = 'entry-1';
      powerMonitor.getSystemIdleTime.mockReturnValue(400); // 400s > 300s threshold
      await service.capture();
      expect(desktopCapturer.getSources).not.toHaveBeenCalled();
      expect(service._consecutiveFailures).toBe(0); // Not a failure
    });

    test('captures normally when system idle is below threshold', async () => {
      service.currentEntryId = 'entry-1';
      powerMonitor.getSystemIdleTime.mockReturnValue(60);
      await service.capture();
      expect(desktopCapturer.getSources).toHaveBeenCalled();
      expect(mockApiClient.uploadScreenshot).toHaveBeenCalled();
    });

    test('skips at exact threshold boundary (300s)', async () => {
      service.currentEntryId = 'entry-1';
      powerMonitor.getSystemIdleTime.mockReturnValue(300); // exactly at threshold
      await service.capture();
      // 300 is NOT > 300, so it should capture
      expect(desktopCapturer.getSources).toHaveBeenCalled();
    });

    test('skips at 301s (just over threshold)', async () => {
      service.currentEntryId = 'entry-1';
      powerMonitor.getSystemIdleTime.mockReturnValue(301);
      await service.capture();
      expect(desktopCapturer.getSources).not.toHaveBeenCalled();
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // ── capture() — Visibility ──
  // ═════════════════════════════════════════════════════════════════

  describe('capture() visibility check', () => {
    test('skips when capture_only_when_visible and app not visible', async () => {
      service.config.capture_only_when_visible = true;
      mockGetIsAppVisible.mockReturnValue(false);
      service.currentEntryId = 'entry-1';
      await service.capture();
      expect(desktopCapturer.getSources).not.toHaveBeenCalled();
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

    test('captures when capture_only_when_visible is false regardless of visibility', async () => {
      service.config.capture_only_when_visible = false;
      mockGetIsAppVisible.mockReturnValue(false);
      service.currentEntryId = 'entry-1';
      await service.capture();
      expect(desktopCapturer.getSources).toHaveBeenCalled();
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // ── capture() — macOS Permission ──
  // ═════════════════════════════════════════════════════════════════

  describe('capture() macOS permission', () => {
    test('always attempts capture even when macOS reports denied', async () => {
      const origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      systemPreferences.getMediaAccessStatus.mockReturnValue('denied');
      service.currentEntryId = 'entry-1';
      await service.capture();
      expect(desktopCapturer.getSources).toHaveBeenCalled();
      Object.defineProperty(process, 'platform', { value: origPlatform });
    });

    test('shows permission dialog when sources are empty on macOS with denied status', async () => {
      const origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      // dialog already imported at top
      systemPreferences.getMediaAccessStatus.mockReturnValue('denied');
      desktopCapturer.getSources.mockResolvedValue([]);
      service.currentEntryId = 'entry-1';
      await service.capture();
      expect(service._consecutiveFailures).toBe(1);
      expect(dialog.showMessageBox).toHaveBeenCalled();
      Object.defineProperty(process, 'platform', { value: origPlatform });
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // ── _captureActiveWindow() ──
  // ═════════════════════════════════════════════════════════════════

  describe('_captureActiveWindow()', () => {
    test('returns null for empty window sources', () => {
      expect(service._captureActiveWindow([])).toBeNull();
      expect(service._captureActiveWindow(null)).toBeNull();
    });

    test('filters out system windows (TrackFlow, Dock, etc.)', () => {
      const sources = [
        makeScreenSource('window:1', 'TrackFlow'),
        makeScreenSource('window:2', 'Dock'),
        makeScreenSource('window:3', 'Notification Center'),
        makeScreenSource('window:4', 'StatusBar'),
        makeScreenSource('window:5', 'Control Center'),
        makeScreenSource('window:6', 'Spotlight'),
        makeScreenSource('window:7', 'Item-0'),
        makeScreenSource('window:8', 'WindowServer'),
      ];
      expect(service._captureActiveWindow(sources)).toBeNull();
    });

    test('filters out windows with empty thumbnails', () => {
      const sources = [makeScreenSource('window:1', 'VS Code', makeMockImage(true))];
      expect(service._captureActiveWindow(sources)).toBeNull();
    });

    test('filters out tiny windows (< 200px)', () => {
      const sources = [makeScreenSource('window:1', 'SomeApp', makeMockImage(false, 100, 100))];
      expect(service._captureActiveWindow(sources)).toBeNull();
    });

    test('returns JPEG buffer for valid active window', () => {
      const thumb = makeMockImage(false, 1920, 1080, 50000);
      const sources = [makeScreenSource('window:1', 'VS Code', thumb)];
      const result = service._captureActiveWindow(sources);
      expect(result).not.toBeNull();
      expect(result.length).toBe(50000);
      expect(thumb.toJPEG).toHaveBeenCalledWith(80);
    });

    test('returns null for wallpaper-only windows (< 15KB)', () => {
      const sources = [makeScreenSource('window:1', 'SomeApp', makeMockImage(false, 1920, 1080, 10000))];
      expect(service._captureActiveWindow(sources)).toBeNull();
    });

    test('picks frontmost (first) valid window as active', () => {
      const thumb1 = makeMockImage(false, 1920, 1080, 50000);
      const thumb2 = makeMockImage(false, 1920, 1080, 60000);
      const sources = [
        makeScreenSource('window:1', 'Firefox', thumb1),
        makeScreenSource('window:2', 'VS Code', thumb2),
      ];
      const result = service._captureActiveWindow(sources);
      expect(thumb1.toJPEG).toHaveBeenCalled();
      expect(result.length).toBe(50000);
    });

    test('skips system window and picks next valid one', () => {
      const thumb = makeMockImage(false, 1920, 1080, 50000);
      const sources = [
        makeScreenSource('window:1', 'TrackFlow Popup'),
        makeScreenSource('window:2', 'VS Code', thumb),
      ];
      const result = service._captureActiveWindow(sources);
      expect(result).not.toBeNull();
      expect(result.length).toBe(50000);
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // ── _matchSourceToDisplay() ──
  // ═════════════════════════════════════════════════════════════════

  describe('_matchSourceToDisplay()', () => {
    const displays = [
      { id: 1, size: { width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      { id: 2, size: { width: 2560, height: 1440 }, bounds: { x: 1920, y: 0, width: 2560, height: 1440 } },
    ];

    test('matches by display_id on macOS', () => {
      const origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const sources = [
        { id: 'screen:1:0', display_id: '1', name: 'Screen 1', thumbnail: makeMockImage() },
        { id: 'screen:2:0', display_id: '2', name: 'Screen 2', thumbnail: makeMockImage() },
      ];
      const match = service._matchSourceToDisplay(sources, displays[1], displays);
      expect(match.display_id).toBe('2');

      Object.defineProperty(process, 'platform', { value: origPlatform });
    });

    test('matches by index pattern on Windows/Linux', () => {
      const origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const sources = [
        { id: 'screen:0:0', display_id: '', name: 'Screen 1', thumbnail: makeMockImage() },
        { id: 'screen:1:0', display_id: '', name: 'Screen 2', thumbnail: makeMockImage() },
      ];
      const match = service._matchSourceToDisplay(sources, displays[1], displays);
      expect(match.id).toBe('screen:1:0');

      Object.defineProperty(process, 'platform', { value: origPlatform });
    });

    test('falls back to index position when no ID match', () => {
      const origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });

      const sources = [
        { id: 'screen:abc:0', display_id: '', name: 'Screen 1', thumbnail: makeMockImage() },
        { id: 'screen:def:0', display_id: '', name: 'Screen 2', thumbnail: makeMockImage() },
      ];
      const match = service._matchSourceToDisplay(sources, displays[0], displays);
      expect(match.name).toBe('Screen 1');

      Object.defineProperty(process, 'platform', { value: origPlatform });
    });

    test('returns null when no sources available', () => {
      const match = service._matchSourceToDisplay([], displays[0], displays);
      expect(match).toBeNull();
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // ── _captureAllDisplays() ──
  // ═════════════════════════════════════════════════════════════════

  describe('_captureAllDisplays()', () => {
    test('captures each display individually', async () => {
      const displays = [
        { id: 1, size: { width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
        { id: 2, size: { width: 2560, height: 1440 }, bounds: { x: 1920, y: 0, width: 2560, height: 1440 } },
      ];

      const origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const screenSources = [
        { id: 'screen:1:0', display_id: '1', name: 'Screen 1', thumbnail: makeMockImage(false, 1920, 1080, 50000) },
        { id: 'screen:2:0', display_id: '2', name: 'Screen 2', thumbnail: makeMockImage(false, 2560, 1440, 60000) },
      ];

      const results = await service._captureAllDisplays(screenSources, [], displays);
      expect(results).toHaveLength(2);
      expect(results[0]).not.toBeNull();
      expect(results[1]).not.toBeNull();

      Object.defineProperty(process, 'platform', { value: origPlatform });
    });

    test('returns null for displays with empty thumbnails', async () => {
      const displays = [
        { id: 1, size: { width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      ];
      const origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const screenSources = [
        { id: 'screen:0:0', display_id: '1', name: 'Screen 1', thumbnail: makeMockImage(true) },
      ];
      const results = await service._captureAllDisplays(screenSources, [], displays);
      expect(results[0]).toBeNull();

      Object.defineProperty(process, 'platform', { value: origPlatform });
    });

    test('returns null for wallpaper-only captures (< 15KB)', async () => {
      const displays = [
        { id: 1, size: { width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      ];
      const origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const screenSources = [
        { id: 'screen:0:0', display_id: '1', name: 'Screen 1', thumbnail: makeMockImage(false, 1920, 1080, 10000) },
      ];
      const results = await service._captureAllDisplays(screenSources, [], displays);
      expect(results[0]).toBeNull();

      Object.defineProperty(process, 'platform', { value: origPlatform });
    });

    test('falls back to window capture on macOS when screen fails', async () => {
      const displays = [
        { id: 1, size: { width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      ];
      const origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const screenSources = [
        { id: 'screen:1:0', display_id: '1', name: 'Screen 1', thumbnail: makeMockImage(false, 1920, 1080, 10000) }, // wallpaper-only
      ];
      const windowSources = [
        makeScreenSource('window:1', 'VS Code', makeMockImage(false, 1920, 1080, 50000)),
      ];

      const results = await service._captureAllDisplays(screenSources, windowSources, displays);
      // Should fall back to window capture on macOS
      expect(results[0]).not.toBeNull();

      Object.defineProperty(process, 'platform', { value: origPlatform });
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // ── _captureSingleMonitor() ──
  // ═════════════════════════════════════════════════════════════════

  describe('_captureSingleMonitor()', () => {
    test('returns JPEG buffer from first valid source', () => {
      const sources = [makeScreenSource('screen:0:0', 'Screen 1')];
      const result = service._captureSingleMonitor(sources);
      expect(result).not.toBeNull();
      expect(result.length).toBe(50000);
    });

    test('skips sources with empty thumbnails and uses next valid', () => {
      const validThumb = makeMockImage(false, 1920, 1080, 50000);
      const sources = [
        makeScreenSource('screen:0:0', 'Empty', makeMockImage(true)),
        makeScreenSource('screen:1:0', 'Valid', validThumb),
      ];
      const result = service._captureSingleMonitor(sources);
      expect(result).not.toBeNull();
      expect(result.length).toBe(50000);
    });

    test('returns null when all sources are empty', () => {
      const sources = [makeScreenSource('screen:0:0', 'Empty', makeMockImage(true))];
      const result = service._captureSingleMonitor(sources);
      expect(result).toBeNull();
    });

    test('skips sources with zero-size thumbnails', () => {
      const zeroSize = {
        isEmpty: jest.fn(() => false),
        getSize: jest.fn(() => ({ width: 0, height: 0 })),
        toJPEG: jest.fn(() => Buffer.alloc(100)),
      };
      const sources = [makeScreenSource('screen:0:0', 'ZeroSize', zeroSize)];
      expect(service._captureSingleMonitor(sources)).toBeNull();
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // ── upload() ──
  // ═════════════════════════════════════════════════════════════════

  describe('upload()', () => {
    beforeEach(() => {
      service.currentEntryId = 'entry-1';
    });

    test('uploads screenshot via apiClient', async () => {
      const buffer = Buffer.alloc(50000, 0x42);
      await service.upload(buffer);
      expect(mockApiClient.uploadScreenshot).toHaveBeenCalledTimes(1);
    });

    test('retries up to 3 times on failure', async () => {
      jest.useRealTimers();
      mockApiClient.uploadScreenshot
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce({ screenshot: { id: '1' } });

      const buffer = Buffer.alloc(50000, 0x42);
      await service.upload(buffer);
      expect(mockApiClient.uploadScreenshot).toHaveBeenCalledTimes(3);
      expect(mockOfflineQueue.add).not.toHaveBeenCalled();
      jest.useFakeTimers();
    });

    test('queues for offline after 3 failed attempts', async () => {
      jest.useRealTimers();
      mockApiClient.uploadScreenshot.mockRejectedValue(new Error('Network error'));

      const buffer = Buffer.alloc(50000, 0x42);
      await service.upload(buffer);
      expect(mockApiClient.uploadScreenshot).toHaveBeenCalledTimes(3);
      expect(mockOfflineQueue.add).toHaveBeenCalledWith('screenshot', expect.objectContaining({
        buffer: expect.any(Buffer),
        time_entry_id: 'entry-1',
      }));
      jest.useFakeTimers();
    });

    test('includes activity context from activityMonitor', async () => {
      const buffer = Buffer.alloc(50000, 0x42);
      await service.upload(buffer);
      expect(mockActivityMonitor.getActiveApp).toHaveBeenCalled();
      expect(mockActivityMonitor.getActiveWindowTitle).toHaveBeenCalled();
    });

    test('handles activityMonitor errors gracefully', async () => {
      mockActivityMonitor.getActiveApp.mockRejectedValue(new Error('fail'));
      const buffer = Buffer.alloc(50000, 0x42);
      await expect(service.upload(buffer)).resolves.not.toThrow();
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // ── Failure Tracking ──
  // ═════════════════════════════════════════════════════════════════

  describe('_handleCaptureFailure()', () => {
    test('increments consecutive failure counter', () => {
      service._handleCaptureFailure('Test failure');
      expect(service._consecutiveFailures).toBe(1);
    });

    test('pauses after MAX_CONSECUTIVE_FAILURES (5)', async () => {
      service.currentEntryId = 'entry-1';
      desktopCapturer.getSources.mockResolvedValue([]);

      for (let i = 0; i < 5; i++) {
        await service.capture();
      }
      expect(service._consecutiveFailures).toBe(5);
      expect(service._intervalTimer).toBeNull();
    });

    test('resumes after pause timeout', async () => {
      service.currentEntryId = 'entry-1';
      service._intervalMs = 60000;
      desktopCapturer.getSources.mockResolvedValue([]);

      for (let i = 0; i < 5; i++) {
        await service.capture();
      }
      expect(service._pauseTimeout).not.toBeNull();

      desktopCapturer.getSources.mockResolvedValue([makeScreenSource('screen:0:0', 'Screen', makeMockImage())]);

      jest.advanceTimersByTime(5 * 60 * 1000);
      expect(service._consecutiveFailures).toBe(0);
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // ── _queueForOffline() ──
  // ═════════════════════════════════════════════════════════════════

  describe('_queueForOffline()', () => {
    beforeEach(() => {
      service.currentEntryId = 'entry-1';
    });

    test('queues screenshots under 1MB', () => {
      const buffer = Buffer.alloc(500 * 1024);
      service._queueForOffline(buffer, 'Chrome', 'Google');
      expect(mockOfflineQueue.add).toHaveBeenCalledWith('screenshot', expect.objectContaining({
        time_entry_id: 'entry-1',
        app_name: 'Chrome',
        window_title: 'Google',
      }));
    });

    test('skips screenshots larger than 1MB', () => {
      const buffer = Buffer.alloc(2 * 1024 * 1024);
      service._queueForOffline(buffer);
      expect(mockOfflineQueue.add).not.toHaveBeenCalled();
    });

    test('includes display info for multi-monitor', () => {
      const buffer = Buffer.alloc(100 * 1024);
      service._queueForOffline(buffer, null, null, { display_index: 0, display_count: 2 });
      expect(mockOfflineQueue.add).toHaveBeenCalledWith('screenshot', expect.objectContaining({
        display_index: 0,
        display_count: 2,
      }));
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // ── _buildFormData() ──
  // ═════════════════════════════════════════════════════════════════

  describe('_buildFormData()', () => {
    beforeEach(() => {
      service.currentEntryId = 'entry-456';
    });

    test('constructs FormData with required fields', () => {
      const buffer = Buffer.alloc(100);
      const formData = service._buildFormData(buffer);
      expect(formData).toBeDefined();
    });

    test('includes app context when provided', () => {
      const buffer = Buffer.alloc(100);
      const formData = service._buildFormData(buffer, 'VS Code', 'file.js');
      expect(formData).toBeDefined();
    });

    test('includes display info for multi-monitor', () => {
      const buffer = Buffer.alloc(100);
      const formData = service._buildFormData(buffer, null, null, { display_index: 0, display_count: 2 });
      expect(formData).toBeDefined();
    });

    test('includes activity score when activityMonitor exists', () => {
      const buffer = Buffer.alloc(100);
      const formData = service._buildFormData(buffer);
      expect(formData).toBeDefined();
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // ── Notification ──
  // ═════════════════════════════════════════════════════════════════

  describe('_showNotification()', () => {
    test('shows notification after successful capture', async () => {
      service.currentEntryId = 'entry-1';
      await service.capture();
      expect(Notification).toHaveBeenCalledWith(expect.objectContaining({
        title: 'TrackFlow',
        body: 'Screenshot captured',
      }));
    });

    test('closes previous notification before showing new one', () => {
      const mockNotif = { close: jest.fn(), show: jest.fn() };
      service._lastNotification = mockNotif;
      service._showNotification();
      expect(mockNotif.close).toHaveBeenCalled();
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // ── setRestartStateSaver() ──
  // ═════════════════════════════════════════════════════════════════

  describe('setRestartStateSaver()', () => {
    test('stores a valid function', () => {
      const fn = jest.fn();
      service.setRestartStateSaver(fn);
      expect(service._onPermissionDialogSave).toBe(fn);
    });

    test('ignores non-function values', () => {
      service.setRestartStateSaver('not-a-function');
      expect(service._onPermissionDialogSave).toBeNull();
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // ── _checkScreenPermissionStatus() ──
  // ═════════════════════════════════════════════════════════════════

  describe('_checkScreenPermissionStatus()', () => {
    test('returns "granted" on non-macOS platforms', () => {
      const origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });
      expect(service._checkScreenPermissionStatus()).toBe('granted');
      Object.defineProperty(process, 'platform', { value: origPlatform });
    });

    test('returns systemPreferences status on macOS', () => {
      const origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      systemPreferences.getMediaAccessStatus.mockReturnValue('denied');
      expect(service._checkScreenPermissionStatus()).toBe('denied');
      Object.defineProperty(process, 'platform', { value: origPlatform });
    });

    test('returns "unknown" when systemPreferences throws', () => {
      const origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      systemPreferences.getMediaAccessStatus.mockImplementation(() => { throw new Error('Not available'); });
      expect(service._checkScreenPermissionStatus()).toBe('unknown');
      Object.defineProperty(process, 'platform', { value: origPlatform });
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // ── Blur (SS-11) — Server-side only ──
  // ═════════════════════════════════════════════════════════════════

  describe('blur', () => {
    test('does NOT apply blur even when configured (server handles it)', async () => {
      const sharp = require('sharp');
      service.config.blur_screenshots = true;
      service.currentEntryId = 'entry-1';
      await service.capture();
      expect(sharp._instance.blur).not.toHaveBeenCalled();
      expect(mockApiClient.uploadScreenshot).toHaveBeenCalled();
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // ── End-to-end: start → capture → upload cycle ──
  // ═════════════════════════════════════════════════════════════════

  describe('full lifecycle', () => {
    test('start captures and uploads then starts interval', async () => {
      mockConfig.screenshot_first_capture_delay_min = 0;
      const svc = new ScreenshotService(mockApiClient, mockConfig, mockOfflineQueue, mockGetIsAppVisible, mockActivityMonitor);
      svc.start('entry-1');

      // Flush setImmediate + await capture
      await jest.advanceTimersByTimeAsync(10);

      expect(mockApiClient.uploadScreenshot).toHaveBeenCalled();
    });

    test('stop after start prevents further captures', async () => {
      service.start('entry-1');
      service.stop();

      mockApiClient.uploadScreenshot.mockClear();
      jest.advanceTimersByTime(10 * 60 * 1000);

      expect(mockApiClient.uploadScreenshot).not.toHaveBeenCalled();
    });
  });
});
