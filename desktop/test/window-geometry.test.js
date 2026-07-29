// Regression tests for the main window's geometry rules.
//
// Replaces popup-size.test.js: the window is no longer a fixed 320x480 tray
// popup with a compact max size, but an ordinary resizable app window whose
// full rect is persisted. The rules that matter now are the size FLOOR and the
// off-screen rescue — a window restored from a monitor that has since been
// unplugged must never come back where the user cannot reach it.

const {
    WINDOW_WIDTH,
    WINDOW_HEIGHT,
    WINDOW_MIN_WIDTH,
    WINDOW_MIN_HEIGHT,
    TITLEBAR_HEIGHT,
    clampWindowSize,
    isVisibleOnAnyDisplay,
    centerOnDisplay,
    resolveWindowBounds,
    resolveWindowChrome,
} = require('../src/main/window-geometry');

const PRIMARY = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
const SECOND = { workArea: { x: 1920, y: 0, width: 1440, height: 900 } };

describe('window-geometry constants', () => {
    test('default size is roomier than the old 320x480 popup', () => {
        expect(WINDOW_WIDTH).toBeGreaterThan(320);
        expect(WINDOW_HEIGHT).toBeGreaterThan(480);
    });

    test('minimum is at or below the default so the default is always valid', () => {
        expect(WINDOW_MIN_WIDTH).toBeLessThanOrEqual(WINDOW_WIDTH);
        expect(WINDOW_MIN_HEIGHT).toBeLessThanOrEqual(WINDOW_HEIGHT);
    });
});

describe('clampWindowSize', () => {
    test('raises an undersized window to the minimum', () => {
        expect(clampWindowSize(100, 100)).toEqual({
            width: WINDOW_MIN_WIDTH,
            height: WINDOW_MIN_HEIGHT,
        });
    });

    test('has NO maximum — a user may fill their screen', () => {
        expect(clampWindowSize(3840, 2160)).toEqual({
            width: 3840,
            height: 2160,
        });
    });

    test('rounds fractional sizes from fractional-DPI displays', () => {
        expect(clampWindowSize(640.4, 700.6)).toEqual({
            width: 640,
            height: 701,
        });
    });

    test('falls back to the default size on NaN/garbage input', () => {
        expect(clampWindowSize(NaN, undefined)).toEqual({
            width: WINDOW_WIDTH,
            height: WINDOW_HEIGHT,
        });
    });
});

describe('isVisibleOnAnyDisplay', () => {
    test('a window fully inside the primary display is visible', () => {
        expect(
            isVisibleOnAnyDisplay(
                { x: 100, y: 100, width: 440, height: 600 },
                [PRIMARY],
            ),
        ).toBe(true);
    });

    test('a window on a second display is visible while it is connected', () => {
        const onSecond = { x: 2000, y: 100, width: 440, height: 600 };
        expect(isVisibleOnAnyDisplay(onSecond, [PRIMARY, SECOND])).toBe(true);
        // ...and stranded once that display is unplugged
        expect(isVisibleOnAnyDisplay(onSecond, [PRIMARY])).toBe(false);
    });

    test('a window slid almost entirely off the right edge is not visible', () => {
        expect(
            isVisibleOnAnyDisplay(
                { x: 1900, y: 100, width: 440, height: 600 },
                [PRIMARY],
            ),
        ).toBe(false);
    });

    test('a window with only a sliver of title bar showing is not visible', () => {
        // 200px of width overlaps, but only 20px of height — not enough to grab.
        expect(
            isVisibleOnAnyDisplay(
                { x: 100, y: -580, width: 440, height: 600 },
                [PRIMARY],
            ),
        ).toBe(false);
    });

    test('no displays reported → nothing is visible', () => {
        expect(
            isVisibleOnAnyDisplay({ x: 0, y: 0, width: 440, height: 600 }, []),
        ).toBe(false);
    });
});

describe('resolveWindowBounds', () => {
    test('first run centres the default size on the primary display', () => {
        const b = resolveWindowBounds(null, [PRIMARY], PRIMARY);
        expect(b.width).toBe(WINDOW_WIDTH);
        expect(b.height).toBe(WINDOW_HEIGHT);
        expect(b.x).toBe(Math.round((1920 - WINDOW_WIDTH) / 2));
        expect(b.y).toBe(Math.round((1080 - WINDOW_HEIGHT) / 2));
    });

    test('a valid persisted rect is restored exactly as saved', () => {
        const saved = { x: 300, y: 200, width: 620, height: 780 };
        expect(resolveWindowBounds(saved, [PRIMARY], PRIMARY)).toEqual(saved);
    });

    test('a rect on a still-connected second display is restored there', () => {
        const saved = { x: 2100, y: 150, width: 500, height: 700 };
        expect(
            resolveWindowBounds(saved, [PRIMARY, SECOND], PRIMARY),
        ).toEqual(saved);
    });

    test('an off-screen rect keeps its SIZE but is re-centred on primary', () => {
        const stranded = { x: 2100, y: 150, width: 500, height: 700 };
        const b = resolveWindowBounds(stranded, [PRIMARY], PRIMARY);
        expect(b.width).toBe(500);
        expect(b.height).toBe(700);
        expect(b.x).toBe(Math.round((1920 - 500) / 2));
        expect(b.y).toBe(Math.round((1080 - 700) / 2));
    });

    test('a persisted rect smaller than the floor is raised to the minimum', () => {
        const tiny = { x: 100, y: 100, width: 120, height: 90 };
        const b = resolveWindowBounds(tiny, [PRIMARY], PRIMARY);
        expect(b.width).toBe(WINDOW_MIN_WIDTH);
        expect(b.height).toBe(WINDOW_MIN_HEIGHT);
    });

    test('a corrupted rect (size only, no position) is centred', () => {
        const b = resolveWindowBounds(
            { width: 500, height: 700 },
            [PRIMARY],
            PRIMARY,
        );
        expect(b.width).toBe(500);
        expect(b.x).toBe(Math.round((1920 - 500) / 2));
    });

    test('a display with a non-zero workArea origin (taskbar/menu bar) is respected', () => {
        const withMenuBar = {
            workArea: { x: 0, y: 25, width: 1920, height: 1055 },
        };
        const b = resolveWindowBounds(null, [withMenuBar], withMenuBar);
        expect(b.y).toBe(Math.round(25 + (1055 - WINDOW_HEIGHT) / 2));
    });
});

describe('resolveWindowChrome — every platform gets NATIVE window controls', () => {
    test('macOS floats the traffic lights over our own header row', () => {
        const c = resolveWindowChrome('darwin');
        expect(c.titleBarStyle).toBe('hiddenInset');
        expect(c.trafficLightPosition).toBeDefined();
        // Must NOT be frameless — that is what removed the controls before.
        expect(c.frame).toBeUndefined();
    });

    test('Windows has the OS paint the caption buttons into the header', () => {
        const c = resolveWindowChrome('win32', {
            background: '#121110',
            symbol: '#a8a29e',
        });
        expect(c.titleBarStyle).toBe('hidden');
        expect(c.titleBarOverlay.color).toBe('#121110');
        expect(c.titleBarOverlay.symbolColor).toBe('#a8a29e');
        // Overlay height must match the CSS header so the buttons line up.
        expect(c.titleBarOverlay.height).toBe(TITLEBAR_HEIGHT);
    });

    test('Linux keeps a real native frame — never a frameless window', () => {
        // A frameless window on a WM that refuses to decorate it is undraggable
        // and unclosable; titleBarOverlay support is not dependable there.
        const c = resolveWindowChrome('linux');
        expect(c.frame).toBe(true);
        expect(c.titleBarStyle).toBeUndefined();
        expect(c.titleBarOverlay).toBeUndefined();
    });

    test('an unknown platform falls back to the safe native frame', () => {
        expect(resolveWindowChrome('freebsd').frame).toBe(true);
    });

    test('Windows overlay colours fall back when none are supplied', () => {
        const c = resolveWindowChrome('win32');
        expect(c.titleBarOverlay.color).toBeTruthy();
        expect(c.titleBarOverlay.symbolColor).toBeTruthy();
    });
});

describe('centerOnDisplay', () => {
    test('centres within the work area, not the raw screen', () => {
        expect(centerOnDisplay(SECOND, 440, 600)).toEqual({
            x: Math.round(1920 + (1440 - 440) / 2),
            y: Math.round((900 - 600) / 2),
            width: 440,
            height: 600,
        });
    });
});
