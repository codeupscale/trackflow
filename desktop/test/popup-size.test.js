// Regression tests for the Windows-resizable popup sizing rules (QA #10).
// Covers min-size clamping (never below the designed 320x400 floor), max-size
// ceiling, and the platform gate (macOS/Linux always get the fixed design size,
// so persistence can never change their behaviour).

const {
    POPUP_WIDTH,
    POPUP_HEIGHT,
    POPUP_MIN_WIDTH,
    POPUP_MIN_HEIGHT,
    POPUP_MAX_WIDTH,
    POPUP_MAX_HEIGHT,
    clampPopupSize,
    resolvePopupSize,
} = require('../src/main/popup-size');

describe('popup-size constants', () => {
    test('design size is 320x400 and is also the minimum', () => {
        expect(POPUP_WIDTH).toBe(320);
        expect(POPUP_HEIGHT).toBe(400);
        expect(POPUP_MIN_WIDTH).toBe(320);
        expect(POPUP_MIN_HEIGHT).toBe(400);
    });

    test('max size is a compact ceiling above the design size', () => {
        expect(POPUP_MAX_WIDTH).toBeGreaterThan(POPUP_MIN_WIDTH);
        expect(POPUP_MAX_HEIGHT).toBeGreaterThan(POPUP_MIN_HEIGHT);
        expect(POPUP_MAX_WIDTH).toBe(480);
        expect(POPUP_MAX_HEIGHT).toBe(640);
    });
});

describe('clampPopupSize', () => {
    test('keeps an in-range size unchanged', () => {
        expect(clampPopupSize(400, 500)).toEqual({ width: 400, height: 500 });
    });

    test('clamps below-minimum values up to the design floor (footer never clips)', () => {
        expect(clampPopupSize(100, 50)).toEqual({
            width: POPUP_MIN_WIDTH,
            height: POPUP_MIN_HEIGHT,
        });
        // The specific DPI-drift regression: a few px short must snap back up.
        expect(clampPopupSize(318, 397)).toEqual({
            width: POPUP_MIN_WIDTH,
            height: POPUP_MIN_HEIGHT,
        });
    });

    test('clamps above-maximum values down to the ceiling', () => {
        expect(clampPopupSize(9999, 9999)).toEqual({
            width: POPUP_MAX_WIDTH,
            height: POPUP_MAX_HEIGHT,
        });
    });

    test('rounds fractional sizes to whole pixels', () => {
        expect(clampPopupSize(400.6, 500.2)).toEqual({ width: 401, height: 500 });
    });

    test('falls back to the minimum on NaN / invalid input', () => {
        expect(clampPopupSize(NaN, undefined)).toEqual({
            width: POPUP_MIN_WIDTH,
            height: POPUP_MIN_HEIGHT,
        });
        expect(clampPopupSize('abc', null)).toEqual({
            width: POPUP_MIN_WIDTH,
            height: POPUP_MIN_HEIGHT,
        });
    });
});

describe('resolvePopupSize', () => {
    test('non-resizable platforms always get the fixed design size, ignoring any persisted value', () => {
        expect(resolvePopupSize({ width: 460, height: 600 }, false)).toEqual({
            width: POPUP_WIDTH,
            height: POPUP_HEIGHT,
        });
        expect(resolvePopupSize(null, false)).toEqual({
            width: POPUP_WIDTH,
            height: POPUP_HEIGHT,
        });
    });

    test('resizable platform restores a valid persisted size (clamped)', () => {
        expect(resolvePopupSize({ width: 440, height: 560 }, true)).toEqual({
            width: 440,
            height: 560,
        });
        // Out-of-range persisted values are clamped, never used raw.
        expect(resolvePopupSize({ width: 5000, height: 10 }, true)).toEqual({
            width: POPUP_MAX_WIDTH,
            height: POPUP_MIN_HEIGHT,
        });
    });

    test('resizable platform falls back to the design size when nothing valid is saved', () => {
        expect(resolvePopupSize(null, true)).toEqual({
            width: POPUP_WIDTH,
            height: POPUP_HEIGHT,
        });
        expect(resolvePopupSize({}, true)).toEqual({
            width: POPUP_WIDTH,
            height: POPUP_HEIGHT,
        });
        expect(resolvePopupSize({ width: '440' }, true)).toEqual({
            width: POPUP_WIDTH,
            height: POPUP_HEIGHT,
        });
    });
});
