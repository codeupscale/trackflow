/**
 * Linux session bootstrap — must run before app.requestSingleInstanceLock().
 *
 * Previous builds deleted WAYLAND_DISPLAY and forced --ozone-platform=x11 to avoid
 * the XDG screen-picker on every capture. That hijacks the compositor on modern
 * GNOME/KDE Wayland sessions and can blank the entire desktop after install.
 *
 * Correct approach (Ubuntu 22.04+): stay on native Wayland, enable PipeWire,
 * and reuse one ScreenCast stream per timer session (see wayland-capture-session.js).
 */
function isWaylandSession(env = process.env) {
  return Boolean(env.WAYLAND_DISPLAY);
}

function isAppImageBuild(env = process.env) {
  return Boolean(env.APPIMAGE);
}

/**
 * @param {import('electron').App} electronApp
 * @param {NodeJS.ProcessEnv} [env]
 */
function configureLinuxPlatform(electronApp, env = process.env) {
  if (process.platform !== 'linux') return { isWayland: false, isAppImage: false };

  const isWayland = isWaylandSession(env);
  const isAppImage = isAppImageBuild(env);

  // AppImage ships without setuid chrome-sandbox — required to start at all.
  if (isAppImage) {
    electronApp.commandLine.appendSwitch('no-sandbox');
  }

  if (isWayland) {
    // Keep WAYLAND_DISPLAY — do NOT force X11 / XWayland.
    electronApp.commandLine.appendSwitch(
      'enable-features',
      'WebRTCPipeWireCapturer,PipeWireCapture',
    );
    console.log(
      '[linux] Wayland session detected — PipeWire screen capture enabled (WAYLAND_DISPLAY kept)',
    );
  } else {
    console.log('[linux] X11 session — using native screen capture');
  }

  return { isWayland, isAppImage };
}

module.exports = {
  configureLinuxPlatform,
  isWaylandSession,
  isAppImageBuild,
};
