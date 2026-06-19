// Unit tests for power-manager sleep auto-stop and startup gap detection.

const PowerManager = require('../src/main/power-manager');

describe('PowerManager', () => {
  describe('evaluateStartupGap', () => {
    const now = new Date('2026-06-20T11:00:00.000Z').getTime();

    test('does not close when no open session', () => {
      const r = PowerManager.evaluateStartupGap({
        lastActiveAtMs: now - 3600_000,
        nowMs: now,
        gapThresholdSec: 180,
        hasOpenSession: false,
      });
      expect(r.shouldClose).toBe(false);
    });

    test('does not close when gap is within threshold', () => {
      const r = PowerManager.evaluateStartupGap({
        lastActiveAtMs: now - 60_000,
        nowMs: now,
        gapThresholdSec: 180,
        hasOpenSession: true,
      });
      expect(r.shouldClose).toBe(false);
      expect(r.gapSec).toBe(60);
    });

    test('closes at lastActiveAt when gap exceeds threshold', () => {
      const lastActive = now - 600_000;
      const r = PowerManager.evaluateStartupGap({
        lastActiveAtMs: lastActive,
        nowMs: now,
        gapThresholdSec: 180,
        hasOpenSession: true,
      });
      expect(r.shouldClose).toBe(true);
      expect(r.stopAtMs).toBe(lastActive);
      expect(r.gapSec).toBe(600);
    });
  });

  describe('formatTimeShortLocal', () => {
    test('formats hours and minutes', () => {
      const d = new Date();
      d.setHours(14, 5, 30, 0);
      expect(PowerManager.formatTimeShortLocal(d)).toBe('14:05');
    });
  });
});
