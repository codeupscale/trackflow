/**
 * Structural invariants of the idle-alert path in src/main/index.js.
 *
 * These are source-level assertions on purpose. `index.js` pulls in Electron and
 * better-sqlite3 (built for Electron's ABI, unloadable under Jest), so the two
 * regressions below cannot be reached by a behavioural test — and both of them
 * shipped precisely because nothing was watching this code.
 *
 * See bugs/desktop-idle-alert-never-appears.md.
 */

const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(
    path.join(__dirname, "..", "src", "main", "index.js"),
    "utf8",
);
// Collapse whitespace so multi-line call sites match as one string.
const FLAT = SRC.replace(/\s+/g, " ");

describe("idle alert — never lost to a promise-method call on a sync function", () => {
    // The local-first refactor made pauseTimerForIdle() synchronous but left
    // `.catch(() => {})` on the call site, so every idle detection threw
    // "Cannot read properties of undefined (reading 'catch')" BEFORE
    // showIdleAlert() ran. No idle window appeared on any OS.
    test("pauseTimerForIdle is synchronous and is never awaited or chained", () => {
        expect(SRC).toMatch(/\nfunction pauseTimerForIdle\(/);
        expect(SRC).not.toMatch(/\nasync function pauseTimerForIdle\(/);
        expect(FLAT).not.toMatch(/pauseTimerForIdle\([^;]*?\)\s*\.(catch|then|finally)\(/);
        expect(FLAT).not.toMatch(/await pauseTimerForIdle\(/);
    });

    test("the idle-detected handler shows the alert through a guarded promise", () => {
        // Promise.resolve() wrapper: survives showIdleAlert() ever becoming sync,
        // and logs a rejection instead of dropping it as an unhandled rejection.
        expect(FLAT).toMatch(
            /Promise\.resolve\(\s*showIdleAlert\([^()]*\)\s*,?\s*\)\s*\.catch\(/,
        );
    });
});

describe("idle alert — exactly one window", () => {
    // A user who locked the laptop and came back an hour later found a stack of
    // idle windows: the alert was mirrored onto every display, and a stale window
    // from the interrupted cycle could outlive its own cycle.
    test("only one alert window is ever constructed per cycle", () => {
        const creations = SRC.match(/_createIdleWindowOnDisplay\(/g) || [];
        // One declaration + exactly one call site.
        expect(creations.length).toBe(2);
        expect(SRC).toMatch(
            /idleAlertWindow = _createIdleWindowOnDisplay\(alertDisplay\);/,
        );
    });

    test("per-display mirror windows are gone for good", () => {
        expect(SRC).not.toMatch(/_idleAlertExtraWindows/);
        expect(SRC).not.toMatch(/const mirror = /);
    });

    test("every surviving alert window is swept before a new one opens", () => {
        const sweepIdx = FLAT.indexOf("_destroyAllIdleAlertWindows();");
        const createIdx = FLAT.indexOf(
            "idleAlertWindow = _createIdleWindowOnDisplay(alertDisplay);",
        );
        expect(sweepIdx).toBeGreaterThan(-1);
        expect(createIdx).toBeGreaterThan(sweepIdx);
    });

    test("the sweeper marks windows programmatic so it cannot re-arm the detector", () => {
        const sweeper = SRC.slice(
            SRC.indexOf("function _destroyAllIdleAlertWindows()"),
            SRC.indexOf("function pushProjectsToIdleAlert"),
        );
        expect(sweeper).toMatch(/_getAllIdleAlertWindows\(\)/);
        expect(sweeper).toMatch(/_dismissedProgrammatically = true/);
        expect(sweeper).toMatch(/\.destroy\(\)/);
        expect(sweeper).toMatch(/idleAlertWindow = null/);
    });

    test("dismissIdleAlert tears down through the same sweeper", () => {
        const dismiss = SRC.slice(
            SRC.indexOf("function dismissIdleAlert()"),
            SRC.indexOf("function reshowIdleAlertAfterResume"),
        );
        expect(dismiss).toMatch(/_destroyAllIdleAlertWindows\(\);/);
    });
});

/**
 * Idle time is NEVER credited as work — including under the retired "always keep idle
 * time" org setting.
 *
 * Owner policy (2026-07-16) removed Keep and Reassign; the prompt offers only
 * "Continue tracking" and "Stop timer", and both discard the gap. `keep_idle_time =
 * always` predates that and was the last path that still billed it: it resolved the
 * idle cycle and kept counting from the original start, so every idle minute stayed
 * inside the entry. It now resolves as a DISCARD, exactly like `never`.
 */
describe("keep_idle_time policy — no path credits idle time", () => {
    const handler = SRC.slice(
        SRC.indexOf("idleDetector.onIdleDetected("),
        SRC.indexOf("idleDetector.onAutoStop("),
    );

    test("the idle-detected handler is reachable and reads the policy", () => {
        expect(handler).toMatch(/config\.keep_idle_time \|\| "prompt"/);
    });

    test('"always" resolves through the discard split, not a bare resolveIdle', () => {
        expect(handler).toMatch(
            /policy === "always" \|\| policy === "never"[\s\S]*?handleIdleAction\(\s*"discard"/,
        );
    });

    test('"always" never re-arms tracking without splitting the session', () => {
        // The old branch called resolveIdle() + start() directly and returned, leaving
        // the live row anchored at its original start with the idle gap inside it.
        const flatHandler = handler.replace(/\s+/g, " ");
        expect(flatHandler).not.toMatch(
            /policy === "always" \) \{ idleDetector\.resolveIdle/,
        );
    });

    test("the idle watchdog no longer exempts the retired policy", () => {
        // The exemption existed only because those orgs credited presence. With nothing
        // crediting idle time, exempting them just removes the backstop for a wedged
        // detector.
        const watchdog = SRC.slice(
            SRC.indexOf("async function _idleWatchdogTick()"),
            SRC.indexOf("function startIdleWatchdog()"),
        );
        expect(watchdog).not.toMatch(
            /if \(config\?\.keep_idle_time === "always"\) return;/,
        );
    });
});
