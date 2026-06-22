// Cross-platform "the app is being uninstalled" detection.
//
// There is NO reliable pre-uninstall hook on every OS: macOS (drag .app to Trash)
// and Linux AppImage (delete the file) run zero app code on removal. The only thing
// a running app can do everywhere is notice that its own install path has vanished
// and react (stop the timer, quit) before the process is torn down.
//
// The pure helpers below hold that decision so it is unit-testable without Electron.
// index.js wires them to a poll + app.quit() (which runs the before-quit graceful stop).

/**
 * Filesystem path whose disappearance signals an uninstall in progress.
 *
 * - AppImage: `env.APPIMAGE` is the real `.AppImage` file. `exePath` points into the
 *   ephemeral squashfs mount (normal at runtime), so it must NOT be watched there.
 * - Everywhere else: the installed executable / macOS `.app` binary is removed on
 *   uninstall, so the exe path is the right thing to watch.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} exePath  app.getPath('exe')
 * @returns {string|null}
 */
function resolveWatchTarget(env, exePath) {
    if (env && env.APPIMAGE) {
        return env.APPIMAGE;
    }
    return exePath || null;
}

/**
 * Whether the running app should stop its timer and quit because it is being removed.
 *
 * - Dev (`!isPackaged`): the "exe" is the source tree — never treat as uninstall.
 * - Already quitting (normal quit OR an auto-update file swap): suppress, so an
 *   update that replaces the binary is never mistaken for an uninstall.
 * - Otherwise: a missing install path means the uninstaller has removed our files.
 *
 * @param {{isPackaged: boolean, isQuitting: boolean, pathExists: boolean}} state
 * @returns {boolean}
 */
function shouldStopForRemoval({ isPackaged, isQuitting, pathExists }) {
    if (!isPackaged) return false;
    if (isQuitting) return false;
    return pathExists === false;
}

module.exports = { resolveWatchTarget, shouldStopForRemoval };
