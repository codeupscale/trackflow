const {
    resolveWatchTarget,
    shouldStopForRemoval,
} = require("../src/main/uninstall-watcher");

describe("Uninstall self-removal watcher", () => {
    describe("resolveWatchTarget", () => {
        test("watches the AppImage file on Linux AppImage builds", () => {
            const env = { APPIMAGE: "/home/u/Apps/TrackFlow.AppImage" };
            const exe = "/tmp/.mount_TrackXYZ/trackflow"; // ephemeral squashfs mount
            expect(resolveWatchTarget(env, exe)).toBe(
                "/home/u/Apps/TrackFlow.AppImage",
            );
        });

        test("watches the executable when APPIMAGE is absent (mac/win/deb)", () => {
            const macExe = "/Applications/TrackFlow.app/Contents/MacOS/TrackFlow";
            expect(resolveWatchTarget({}, macExe)).toBe(macExe);

            const winExe = "C:/Program Files/TrackFlow/TrackFlow.exe";
            expect(resolveWatchTarget(undefined, winExe)).toBe(winExe);
        });

        test("returns null when no path is resolvable", () => {
            expect(resolveWatchTarget({}, undefined)).toBeNull();
            expect(resolveWatchTarget({}, "")).toBeNull();
        });
    });

    describe("shouldStopForRemoval", () => {
        test("stops when packaged, not quitting, and the path is gone", () => {
            expect(
                shouldStopForRemoval({
                    isPackaged: true,
                    isQuitting: false,
                    pathExists: false,
                }),
            ).toBe(true);
        });

        test("does NOT stop while the install path still exists", () => {
            expect(
                shouldStopForRemoval({
                    isPackaged: true,
                    isQuitting: false,
                    pathExists: true,
                }),
            ).toBe(false);
        });

        test("does NOT stop during an auto-update file swap (isQuitting)", () => {
            // An updater replaces the binary; isQuitting is set before quitAndInstall.
            expect(
                shouldStopForRemoval({
                    isPackaged: true,
                    isQuitting: true,
                    pathExists: false,
                }),
            ).toBe(false);
        });

        test("does NOT stop in dev (unpackaged source tree)", () => {
            expect(
                shouldStopForRemoval({
                    isPackaged: false,
                    isQuitting: false,
                    pathExists: false,
                }),
            ).toBe(false);
        });
    });
});
