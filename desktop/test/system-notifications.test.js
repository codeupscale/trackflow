jest.mock('../src/main/tray-icons', () => ({
  getNotificationIcon: jest.fn(() => ({
    isEmpty: jest.fn(() => false),
  })),
}));

const { getNotificationIcon } = require('../src/main/tray-icons');

function withNotificationsModule(fn) {
  jest.isolateModules(() => {
    const electron = require('electron');
    const mod = require('../src/main/system-notifications');
    fn({ electron, mod });
  });
}

describe('system-notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    getNotificationIcon.mockReturnValue({ isEmpty: jest.fn(() => false) });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('formatTimeShortLocal()', () => {
    test('formats hours and minutes as h:MM AM/PM', () => {
      withNotificationsModule(({ mod }) => {
        const date = new Date(2026, 6, 6, 14, 5, 30);
        expect(mod.formatTimeShortLocal(date)).toBe('2:05 PM');
      });
    });

    test('handles midnight, noon, and morning boundaries', () => {
      withNotificationsModule(({ mod }) => {
        expect(mod.formatTimeShortLocal(new Date(2026, 6, 6, 0, 0, 0))).toBe('12:00 AM');
        expect(mod.formatTimeShortLocal(new Date(2026, 6, 6, 12, 0, 0))).toBe('12:00 PM');
        expect(mod.formatTimeShortLocal(new Date(2026, 6, 6, 9, 7, 0))).toBe('9:07 AM');
      });
    });
  });

  describe('initSystemNotifications()', () => {
    test('sets AppUserModelId on Windows', () => {
      const orig = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });

      withNotificationsModule(({ electron, mod }) => {
        mod.initSystemNotifications();
        expect(electron.app.setAppUserModelId).toHaveBeenCalledWith(mod.APP_USER_MODEL_ID);
      });

      Object.defineProperty(process, 'platform', { value: orig });
    });

    test('does not set AppUserModelId on macOS', () => {
      const orig = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      withNotificationsModule(({ electron, mod }) => {
        mod.initSystemNotifications();
        expect(electron.app.setAppUserModelId).not.toHaveBeenCalled();
      });

      Object.defineProperty(process, 'platform', { value: orig });
    });
  });

  describe('showSystemNotification()', () => {
    test('creates notification with icon, unique id, title, and body', () => {
      withNotificationsModule(({ electron, mod }) => {
        electron.Notification.isSupported.mockReturnValue(true);
        electron.nativeImage.createFromPath.mockReturnValue({ isEmpty: jest.fn(() => false) });

        const result = mod.showSystemNotification({
          id: 'screenshot-test-1',
          title: 'TrackFlow',
          body: 'Screenshot captured at 2:05 PM',
          silent: true,
          durationMs: 5000,
        });

        expect(electron.Notification).toHaveBeenCalledWith(expect.objectContaining({
          id: 'screenshot-test-1',
          title: 'TrackFlow',
          body: 'Screenshot captured at 2:05 PM',
          silent: true,
          icon: expect.anything(),
        }));
        expect(result).toBeTruthy();
        expect(result.show).toHaveBeenCalled();
      });
    });

    test('auto-generates id when omitted', () => {
      withNotificationsModule(({ electron, mod }) => {
        electron.Notification.isSupported.mockReturnValue(true);
        mod.showSystemNotification({ title: 'TrackFlow', body: 'Test' });
        const call = electron.Notification.mock.calls[0][0];
        expect(call.id).toMatch(/^trackflow-\d+$/);
      });
    });

    test('attaches failed event handler', () => {
      withNotificationsModule(({ electron, mod }) => {
        electron.Notification.isSupported.mockReturnValue(true);
        mod.showSystemNotification({ title: 'TrackFlow', body: 'Test' });
        const instance = electron.Notification.mock.results[0].value;
        expect(instance.on).toHaveBeenCalledWith('failed', expect.any(Function));
      });
    });

    test('auto-closes after durationMs', () => {
      withNotificationsModule(({ electron, mod }) => {
        electron.Notification.isSupported.mockReturnValue(true);
        const notification = mod.showSystemNotification({
          title: 'TrackFlow',
          body: 'Test',
          durationMs: 5000,
        });
        jest.advanceTimersByTime(5000);
        expect(notification.close).toHaveBeenCalled();
      });
    });

    test('closes previous notification before showing a new one', () => {
      withNotificationsModule(({ electron, mod }) => {
        electron.Notification.isSupported.mockReturnValue(true);
        const first = mod.showSystemNotification({ title: 'A', body: 'first' });
        mod.showSystemNotification({ title: 'B', body: 'second' });
        expect(first.close).toHaveBeenCalled();
      });
    });

    test('returns null when notifications are unsupported', () => {
      withNotificationsModule(({ electron, mod }) => {
        electron.Notification.isSupported.mockReturnValue(false);
        const result = mod.showSystemNotification({ title: 'A', body: 'B' });
        expect(result).toBeNull();
      });
    });
  });
});
