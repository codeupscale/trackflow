/**
 * Pure helpers mirrored from idle-alert.js — auto-stop countdown must match
 * IdleDetector._checkAutoStop() (grace period after alertShownAt, not idle start).
 */

function toTimestampMs(value) {
    if (value == null) return null;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
}

function computeAutoStopRemainingSec(
    alertShownAtMs,
    autoStopGraceSec,
    nowMs = Date.now(),
) {
    if (!alertShownAtMs || !autoStopGraceSec || autoStopGraceSec <= 0) {
        return null;
    }
    const deadlineMs = alertShownAtMs + autoStopGraceSec * 1000;
    return Math.max(0, Math.floor((deadlineMs - nowMs) / 1000));
}

function formatCountdown(seconds) {
    if (seconds <= 0) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
}

describe("idle auto-stop countdown", () => {
    const t0 = 1_700_000_000_000;

    test("remaining uses alertShownAt + grace, not idle start", () => {
        const alertShownAt = t0;
        const graceSec = 600; // 10 min
        const now = t0 + 120_000; // 2 min after popup
        expect(computeAutoStopRemainingSec(alertShownAt, graceSec, now)).toBe(
            480,
        );
        expect(formatCountdown(480)).toBe("8:00");
    });

    test("long idle before popup does not inflate remaining", () => {
        const idleStartedAt = t0 - 20 * 60 * 1000; // idle 20 min before popup
        const alertShownAt = t0;
        const graceSec = 600;
        const now = t0 + 60_000;
        const idleElapsed = Math.floor((now - idleStartedAt) / 1000);
        expect(idleElapsed).toBeGreaterThan(1200);
        const remaining = computeAutoStopRemainingSec(
            alertShownAt,
            graceSec,
            now,
        );
        expect(remaining).toBe(540);
        expect(remaining).toBeLessThan(700);
    });

    test("old broken formula would show thousands of minutes", () => {
        const idleTimeoutSec = 300;
        const alertAutoStopSec = 600;
        const autoStopTotalSec = idleTimeoutSec + alertAutoStopSec;
        const idleElapsed = 1246;
        const brokenRemaining = autoStopTotalSec - idleElapsed;
        expect(brokenRemaining).toBeLessThan(0);
        // When idleElapsed < autoStopTotalSec but huge idle before popup:
        const hugeIdleElapsed = 100;
        const inflated = autoStopTotalSec - hugeIdleElapsed;
        expect(inflated).toBe(800); // still wrong vs grace model
    });

    test("toTimestampMs parses ISO strings from IPC", () => {
        const iso = "2026-06-19T10:00:00.000Z";
        expect(toTimestampMs(iso)).toBe(Date.parse(iso));
        expect(toTimestampMs(t0)).toBe(t0);
    });

    test("returns null when auto-stop disabled", () => {
        expect(computeAutoStopRemainingSec(t0, 0, t0 + 1000)).toBeNull();
    });
});
