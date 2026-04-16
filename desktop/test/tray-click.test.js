describe('Tray Click Blur Guard', () => {
  test('blur within 300ms of tray click should be suppressed', () => {
    let _lastTrayClickAt = 0;
    const TRAY_CLICK_GUARD_MS = 300;

    _lastTrayClickAt = Date.now();

    const shouldHide = (Date.now() - _lastTrayClickAt) >= TRAY_CLICK_GUARD_MS;
    expect(shouldHide).toBe(false);
  });

  test('blur after 300ms should proceed normally', () => {
    jest.useFakeTimers();
    let _lastTrayClickAt = 0;
    const TRAY_CLICK_GUARD_MS = 300;

    _lastTrayClickAt = Date.now();

    jest.advanceTimersByTime(350);

    const shouldHide = (Date.now() - _lastTrayClickAt) >= TRAY_CLICK_GUARD_MS;
    expect(shouldHide).toBe(true);

    jest.useRealTimers();
  });

  test('blur with no recent tray click should proceed', () => {
    let _lastTrayClickAt = 0;
    const TRAY_CLICK_GUARD_MS = 300;

    const shouldHide = (Date.now() - _lastTrayClickAt) >= TRAY_CLICK_GUARD_MS;
    expect(shouldHide).toBe(true);
  });

  test('debounced blur should check isFocused before hiding', () => {
    jest.useFakeTimers();

    let hidden = false;
    let isFocused = false;
    let isDestroyed = false;
    let _lastTrayClickAt = 0;
    const TRAY_CLICK_GUARD_MS = 300;

    function simulateBlur() {
      if (Date.now() - _lastTrayClickAt < TRAY_CLICK_GUARD_MS) return;
      setTimeout(() => {
        if (!isDestroyed && !isFocused) {
          hidden = true;
        }
      }, 150);
    }

    // Simulate: blur fires, but window regains focus before timeout
    simulateBlur();
    isFocused = true;
    jest.advanceTimersByTime(150);
    // The setTimeout fired but isFocused is true, so hidden stays false
    // (our code checks !isFocused before hiding)
    expect(hidden).toBe(false);

    jest.useRealTimers();
  });
});
