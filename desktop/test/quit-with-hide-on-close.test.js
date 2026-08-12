/**
 * Regression: "Quit TrackFlow" did nothing unless a timer was running.
 *
 * The window's 'close' handler hides instead of closing (so tidying the desktop can
 * never kill a running timer) and only stands down when `isQuitting` is set. That
 * flag used to be set ONLY on before-quit's timer-running branch, so quitting while
 * signed in and idle had Electron ask the window to close, the handler prevent it,
 * and the quit silently cancel — the app just hid. Signing out first appeared to fix
 * it only because that destroys the window in favour of the login window.
 *
 * These tests model the two handlers' interaction, matching the logic-replication
 * style the rest of this suite uses (index.js pulls in better-sqlite3, which is built
 * for Electron's ABI and cannot load under Jest).
 */

/** Mirrors app.on('before-quit') + popupWindow.on('close'). */
function makeApp({ isTimerRunning, hasApiClient, setFlagEarly }) {
    const state = { isQuitting: false, exited: false, windowVisible: true };

    state.beforeQuit = () => {
        if (state.isQuitting) return;
        if (setFlagEarly) state.isQuitting = true;

        if (isTimerRunning && hasApiClient) {
            if (!setFlagEarly) state.isQuitting = true;
            state.exited = true; // branch ends in app.exit(0)
        }
        // else branch: no preventDefault — Electron proceeds to close windows.
    };

    /** Returns true if the window actually closed. */
    state.closeWindow = () => {
        if (state.isQuitting) {
            state.windowVisible = false;
            return true;
        }
        state.windowVisible = false; // hide()
        return false; // preventDefault()
    };

    return state;
}

/** Full quit: before-quit, then Electron closing the window if not already exited. */
function quit(app) {
    app.beforeQuit();
    if (app.exited) return true;
    return app.closeWindow();
}

describe('Quit vs hide-on-close', () => {
    test('THE BUG: idle + signed in, flag set late — quit is cancelled by our own window', () => {
        const app = makeApp({
            isTimerRunning: false,
            hasApiClient: true,
            setFlagEarly: false,
        });
        expect(quit(app)).toBe(false); // window refused to close → app stays alive
    });

    test('FIXED: idle + signed in, flag set early — window closes and the app quits', () => {
        const app = makeApp({
            isTimerRunning: false,
            hasApiClient: true,
            setFlagEarly: true,
        });
        expect(quit(app)).toBe(true);
    });

    test('a running timer still quits (the branch that always worked)', () => {
        const app = makeApp({
            isTimerRunning: true,
            hasApiClient: true,
            setFlagEarly: true,
        });
        expect(quit(app)).toBe(true);
        expect(app.exited).toBe(true);
    });

    test('signed out (no apiClient) quits — why Sign Out then Quit appeared to work', () => {
        const app = makeApp({
            isTimerRunning: false,
            hasApiClient: false,
            setFlagEarly: true,
        });
        expect(quit(app)).toBe(true);
    });

    test('a plain close (no quit in progress) still HIDES, never destroys', () => {
        const app = makeApp({
            isTimerRunning: true,
            hasApiClient: true,
            setFlagEarly: true,
        });
        expect(app.closeWindow()).toBe(false); // preventDefault + hide
        expect(app.exited).toBe(false); // a running timer survives the close
    });

    test('before-quit is re-entrant-safe', () => {
        const app = makeApp({
            isTimerRunning: false,
            hasApiClient: true,
            setFlagEarly: true,
        });
        app.beforeQuit();
        app.beforeQuit(); // must not throw or undo the flag
        expect(app.isQuitting).toBe(true);
        expect(app.closeWindow()).toBe(true);
    });
});
