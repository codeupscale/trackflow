const {
  shouldUseWaylandPersistentCapture,
  WaylandCaptureSession,
} = require('../src/main/wayland-capture-session');

const { BrowserWindow, desktopCapturer, __mockWebContents } = require('electron');

describe('wayland-capture-session', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    __mockWebContents.executeJavaScript.mockResolvedValue({
      ok: true,
      width: 1920,
      height: 1080,
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  test('shouldUseWaylandPersistentCapture is true only on Linux Wayland', () => {
    expect(
      shouldUseWaylandPersistentCapture({ WAYLAND_DISPLAY: 'wayland-0' }),
    ).toBe(true);
    expect(shouldUseWaylandPersistentCapture({})).toBe(false);

    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    expect(
      shouldUseWaylandPersistentCapture({ WAYLAND_DISPLAY: 'wayland-0' }),
    ).toBe(false);
  });

  test('open() calls getSources once and starts hidden capture page', async () => {
    desktopCapturer.getSources.mockResolvedValue([
      { id: 'screen:0:0', name: 'Screen 1' },
    ]);

    const session = new WaylandCaptureSession();
    await session.open();

    expect(desktopCapturer.getSources).toHaveBeenCalledTimes(1);
    expect(BrowserWindow).toHaveBeenCalledTimes(1);
    expect(__mockWebContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('__waylandCaptureStart'),
      true,
    );
  });

  test('captureJpeg() grabs frame without another getSources call', async () => {
    desktopCapturer.getSources.mockResolvedValue([
      { id: 'screen:0:0', name: 'Screen 1' },
    ]);

    const session = new WaylandCaptureSession();
    await session.open();

    __mockWebContents.executeJavaScript.mockResolvedValueOnce({
      ok: true,
      data: Buffer.from('jpeg').toString('base64'),
    });

    const buffer = await session.captureJpeg();

    expect(desktopCapturer.getSources).toHaveBeenCalledTimes(1);
    expect(__mockWebContents.executeJavaScript).toHaveBeenLastCalledWith(
      'window.__waylandCaptureGrab()',
      true,
    );
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.toString()).toBe('jpeg');
  });

  /**
   * Every timeout raced against real work must be CLEARED when the work wins.
   *
   * Abandoning it kept a 15s (open) / 10s (frame grab) timer alive per call, holding a
   * closure and the event loop. In Jest that leak force-exits the worker, and a
   * force-exited worker reports whatever suite it happened to be running as FAILED —
   * which is how `projects-cache.test.js` (no timers, no async, no clock) failed
   * intermittently under load while passing every time on its own.
   */
  test('open() and captureJpeg() leave no dangling timeout behind', async () => {
    jest.useFakeTimers();
    try {
      desktopCapturer.getSources.mockResolvedValue([
        { id: 'screen:0:0', name: 'Screen 1' },
      ]);

      const session = new WaylandCaptureSession();
      await session.open();

      __mockWebContents.executeJavaScript.mockResolvedValueOnce({
        ok: true,
        data: Buffer.from('jpeg').toString('base64'),
      });
      await session.captureJpeg();

      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  test('close() stops stream and destroys hidden window', async () => {
    desktopCapturer.getSources.mockResolvedValue([
      { id: 'screen:0:0', name: 'Screen 1' },
    ]);

    const session = new WaylandCaptureSession();
    await session.open();
    const win = BrowserWindow.mock.results[0].value;

    __mockWebContents.executeJavaScript.mockResolvedValueOnce({ ok: true });
    await session.close();

    expect(__mockWebContents.executeJavaScript).toHaveBeenCalledWith(
      'window.__waylandCaptureStop()',
      true,
    );
    expect(win.destroy).toHaveBeenCalled();
  });
});
