const { configureLinuxPlatform, isWaylandSession, isAppImageBuild } = require('../src/main/linux-platform');

describe('linux-platform', () => {
  test('isWaylandSession detects WAYLAND_DISPLAY', () => {
    expect(isWaylandSession({ WAYLAND_DISPLAY: 'wayland-0' })).toBe(true);
    expect(isWaylandSession({})).toBe(false);
  });

  test('isAppImageBuild detects APPIMAGE env', () => {
    expect(isAppImageBuild({ APPIMAGE: '/tmp/TrackFlow.AppImage' })).toBe(true);
    expect(isAppImageBuild({})).toBe(false);
  });

  test('configureLinuxPlatform enables PipeWire on Wayland (no X11 forcing)', () => {
    const switches = [];
    const mockApp = {
      commandLine: {
        appendSwitch: (name, value) => switches.push([name, value]),
      },
    };
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });

    try {
      const result = configureLinuxPlatform(mockApp, {
        WAYLAND_DISPLAY: 'wayland-0',
      });

      expect(result).toEqual({ isWayland: true, isAppImage: false });
      expect(switches).toContainEqual([
        'enable-features',
        'WebRTCPipeWireCapturer,PipeWireCapture',
      ]);
      expect(switches.some(([name]) => name === 'ozone-platform')).toBe(false);
      expect(switches.some(([name]) => name === 'no-sandbox')).toBe(false);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  test('configureLinuxPlatform adds no-sandbox only for AppImage', () => {
    const switches = [];
    const mockApp = {
      commandLine: {
        appendSwitch: (name, value) => switches.push([name, value]),
      },
    };
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });

    try {
      configureLinuxPlatform(mockApp, {
        APPIMAGE: '/opt/TrackFlow.AppImage',
        WAYLAND_DISPLAY: 'wayland-0',
      });

      expect(switches).toContainEqual(['no-sandbox', undefined]);
      expect(switches).toContainEqual([
        'enable-features',
        'WebRTCPipeWireCapturer,PipeWireCapture',
      ]);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  test('configureLinuxPlatform is a no-op on non-linux', () => {
    const switches = [];
    const mockApp = {
      commandLine: {
        appendSwitch: (name, value) => switches.push([name, value]),
      },
    };
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    try {
      const result = configureLinuxPlatform(mockApp, {
        WAYLAND_DISPLAY: 'wayland-0',
      });
      expect(result).toEqual({ isWayland: false, isAppImage: false });
      expect(switches).toHaveLength(0);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });
});
