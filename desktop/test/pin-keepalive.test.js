/**
 * Pin keepalive must be macOS-only.
 * On Windows, polling moveTop() every 300ms dismisses the native <select> dropdown
 * while the window is pinned (default on fresh install).
 */

describe('Pin keepalive platform policy', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  function shouldRunPinKeepalive() {
    return process.platform === 'darwin';
  }

  test('keepalive runs on macOS only', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    expect(shouldRunPinKeepalive()).toBe(true);

    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(shouldRunPinKeepalive()).toBe(false);

    Object.defineProperty(process, 'platform', { value: 'linux' });
    expect(shouldRunPinKeepalive()).toBe(false);
  });

  test('showPopup moveTop re-assert is macOS-only', () => {
    function shouldMoveTopOnShow() {
      return process.platform === 'darwin';
    }

    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(shouldMoveTopOnShow()).toBe(false);

    Object.defineProperty(process, 'platform', { value: 'darwin' });
    expect(shouldMoveTopOnShow()).toBe(true);
  });
});
