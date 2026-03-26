// Screenshot capture service
// - Captures at org-configured interval while timer is running
// - Multi-monitor: captures each display individually (Hubstaff-style) and
//   uploads them as separate screenshots with display_index metadata.
//   Legacy composite mode (stitching all screens into one image) is retained
//   but no longer the default.
// - Cross-platform: macOS (permission check + window-first fallback),
//   Windows, Linux
// - Blur support via sharp
// - Stops cleanly when timer stops (no orphan screenshots)
//
// KEY DESIGN DECISIONS:
//   1. thumbnailSize is capped at 1920x1080 to prevent Electron's internal
//      capture timeout on Retina/HiDPI displays. Requesting native resolution
//      (e.g., 2880x1800) causes desktopCapturer to return empty thumbnails
//      on macOS — a known Electron bug. 1920x1080 is sufficient for
//      monitoring purposes and matches what Hubstaff captures.
//
//   2. All failure paths log with console.error AND increment a failure counter.
//      After 5 consecutive failures, capture pauses for 5 minutes to avoid CPU waste.
//
//   3. Multi-monitor captures each display individually and uploads them as
//      separate screenshots tagged with display_index / display_count.
//      This matches how Hubstaff and Time Doctor handle multi-monitor setups
//      and allows the web dashboard to show per-display screenshots.

const { desktopCapturer, Notification, screen, systemPreferences, shell, dialog, BrowserWindow, powerMonitor } = require('electron');
const FormData = require('form-data');

// Lazy-load sharp
let _sharp = null;
let _sharpChecked = false;
function getSharp() {
  if (_sharpChecked) return _sharp;
  _sharpChecked = true;
  try {
    _sharp = require('sharp');
  } catch {
    _sharp = null;
    console.warn('[SS] sharp not available — multi-monitor composite and blur disabled');
  }
  return _sharp;
}

const MAX_CONSECUTIVE_FAILURES = 5;
const FAILURE_PAUSE_MS = 5 * 60 * 1000;

// Skip screenshot capture when system has been idle for 5+ minutes.
// Catches screen lock, sleep/wake recovery, and extended AFK scenarios.
const IDLE_THRESHOLD_SECONDS = 300;

// Safe capture size — do NOT request native Retina resolution.
// Electron's desktopCapturer returns empty thumbnails when the
// requested size exceeds internal GPU buffer limits (~2048px on some GPUs).
const CAPTURE_WIDTH = 1920;
const CAPTURE_HEIGHT = 1080;

class ScreenshotService {
  constructor(apiClient, config, offlineQueue, getIsAppVisible = null, activityMonitor = null) {
    this.apiClient = apiClient;
    this.config = config;
    this.offlineQueue = offlineQueue;
    this.getIsAppVisible = typeof getIsAppVisible === 'function' ? getIsAppVisible : null;
    this.activityMonitor = activityMonitor;
    this._intervalTimer = null;
    this.initialTimeout = null;
    this.currentEntryId = null;
    this._capturing = false;
    this._consecutiveFailures = 0;
    this._pauseTimeout = null;
    this._intervalMs = 0;
    this._lastNotification = null;
    this._permissionDialogShown = false;
    // Track last capture hash to detect static/wallpaper-only images
    this._lastCaptureHash = null;
    this._staticCaptureCount = 0;
    // Once we confirm desktopCapturer returns real content, skip native fallback
    this._desktopCapturerWorks = false;
    // Optional callback for when permission dialog triggers a restart-state save
    this._onPermissionDialogSave = null;
  }

  // Set a callback that saves restart state before showing the permission dialog
  setRestartStateSaver(fn) {
    this._onPermissionDialogSave = typeof fn === 'function' ? fn : null;
  }

  start(entryId, options = {}) {
    this.stop();
    this.currentEntryId = entryId;
    this._consecutiveFailures = 0;
    this._permissionDialogShown = false;
    const immediateCapture = options.immediateCapture === true;
    this._intervalMs = (this.config.screenshot_interval || 5) * 60 * 1000;
    const firstDelayMin = this.config.screenshot_first_capture_delay_min != null
      ? this.config.screenshot_first_capture_delay_min : 1;
    const firstDelayMs = firstDelayMin * 60 * 1000;

    console.log(`[SS] Started — entry=${entryId}, interval=${this.config.screenshot_interval}min, firstDelay=${firstDelayMin}min, immediate=${immediateCapture}`);

    if (immediateCapture || firstDelayMs === 0) {
      setImmediate(() => {
        if (!this.currentEntryId) return;
        this.capture().finally(() => {
          if (this.currentEntryId) this._startInterval();
        });
      });
    } else {
      this.initialTimeout = setTimeout(() => {
        this.initialTimeout = null;
        if (!this.currentEntryId) return;
        console.log('[SS] First capture delay elapsed, taking screenshot');
        this.capture().finally(() => {
          if (this.currentEntryId) this._startInterval();
        });
      }, firstDelayMs);
    }
  }

  _startInterval() {
    if (this._intervalTimer) clearTimeout(this._intervalTimer);
    const scheduleNext = () => {
      // Randomize within 60-100% of interval to prevent predictable capture timing
      const minDelay = Math.floor(this._intervalMs * 0.6);
      const maxDelay = this._intervalMs;
      const delay = minDelay + Math.floor(Math.random() * (maxDelay - minDelay));
      this._intervalTimer = setTimeout(() => {
        this.capture().finally(() => {
          if (this.currentEntryId) scheduleNext();
        });
      }, delay);
    };
    scheduleNext();
    console.log(`[SS] Randomized interval started — ~${Math.round(this._intervalMs / 1000)}s (\u00b140%)`);
  }

  stop() {
    if (this.initialTimeout) {
      clearTimeout(this.initialTimeout);
      this.initialTimeout = null;
    }
    if (this._intervalTimer) {
      clearTimeout(this._intervalTimer);
      this._intervalTimer = null;
    }
    if (this._pauseTimeout) {
      clearTimeout(this._pauseTimeout);
      this._pauseTimeout = null;
    }
    if (this.currentEntryId) {
      console.log(`[SS] Stopped — entry=${this.currentEntryId}`);
    }
    this.currentEntryId = null;
    this._capturing = false;
    this._closeNotification();
  }

  // ── macOS Screen Recording Permission ─────────────────────────────
  //
  // IMPORTANT: systemPreferences.getMediaAccessStatus('screen') is UNRELIABLE.
  //   1. It caches the status at process startup — toggling permission ON
  //      in System Settings still returns 'denied' until the app is restarted.
  //   2. For ad-hoc signed apps (no Apple Developer cert), it may ALWAYS
  //      return 'denied' even when permission is granted.
  //
  // Solution: Don't block on the permission check. Always attempt the capture.
  // If desktopCapturer.getSources() returns empty thumbnails, THEN we know
  // permission is truly not granted and we show the dialog.

  _checkScreenPermissionStatus() {
    if (process.platform !== 'darwin') return 'granted';
    try {
      return systemPreferences.getMediaAccessStatus('screen');
    } catch {
      return 'unknown';
    }
  }

  _showPermissionDialog(force = false) {
    // Only show once per app session
    if (this._permissionDialogShown) return;
    if (!force) {
      const status = this._checkScreenPermissionStatus();
      if (status === 'granted') return; // Permission is fine, don't nag
    }

    this._permissionDialogShown = true;

    console.log('[SS] Showing screen recording permission dialog');

    // Trigger a lightweight desktopCapturer probe so macOS registers TrackFlow
    // in the Screen Recording permission list before directing the user there.
    desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1, height: 1 },
    }).catch(() => {}); // fire-and-forget; errors are non-fatal

    dialog.showMessageBox({
      type: 'warning',
      title: 'Screen Recording Permission Required',
      message: 'TrackFlow needs screen recording access to capture activity screenshots.',
      detail: 'Your employer requires activity screenshots as part of time tracking.\n\n'
        + 'Steps to enable:\n'
        + '1. Click "Open System Settings" below\n'
        + '2. Find "TrackFlow" in the list and toggle it ON\n'
        + '3. macOS will ask you to "Quit & Reopen" — click it\n\n'
        + 'Your time will be saved. After restarting, tracking will resume automatically.',
      buttons: ['Open System Settings', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) {
        // Save restart state so tracking resumes after the forced restart
        if (this._onPermissionDialogSave) {
          try { this._onPermissionDialogSave(); } catch {}
        }
        shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
      }
    }).catch(() => {});
  }

  // ── Core Capture ──────────────────────────────────────────────────
  //
  // CRITICAL macOS ISSUE — ad-hoc signed apps get wallpaper-only screenshots:
  //   desktopCapturer.getSources({ types: ['screen'] }) returns thumbnails
  //   showing ONLY the wallpaper, not application windows on top.
  //   This happens because macOS composites windows separately and restricts
  //   the screen layer for apps without a real Apple Developer certificate.
  //
  // SOLUTION — Platform-aware capture strategy:
  //   macOS:    ALWAYS capture the active WINDOW first (reliable for ad-hoc)
  //             Fall back to screen capture only if no windows available
  //   Windows:  Screen capture works perfectly (no signing restriction)
  //   Linux:    Screen capture works perfectly

  async capture() {
    if (!this.currentEntryId) return;
    if (this._capturing) return;
    this._capturing = true;

    // Skip capture when system is idle (screen locked, sleep, AFK)
    const idleSeconds = powerMonitor.getSystemIdleTime();
    if (idleSeconds > IDLE_THRESHOLD_SECONDS) {
      console.log(`[SS] Skipping capture — system idle for ${idleSeconds}s (likely locked)`);
      this._capturing = false;
      return;
    }

    // Skip if capture_only_when_visible and popup not visible
    if (this.config.capture_only_when_visible === true) {
      if (this.getIsAppVisible && !this.getIsAppVisible()) {
        this._capturing = false;
        return;
      }
    }

    const permStatus = this._checkScreenPermissionStatus();
    if (process.platform === 'darwin') {
      console.log(`[SS] macOS screen permission: ${permStatus}`);
    }

    try {
      const thumbnailSize = { width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT };
      const isMac = process.platform === 'darwin';

      // Request sources — always include windows on macOS for reliable capture
      // (window capture is the primary strategy on macOS for ad-hoc signed apps)
      const sourceTypes = isMac ? ['screen', 'window'] : ['screen'];
      console.log(`[SS] Requesting ${sourceTypes.join('+')} sources at ${thumbnailSize.width}x${thumbnailSize.height}`);

      const allSources = await Promise.race([
        desktopCapturer.getSources({
          types: sourceTypes,
          thumbnailSize,
          fetchWindowIcons: false,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('desktopCapturer.getSources() timed out after 10s')), 10000)
        ),
      ]);

      const screenSources = allSources.filter(s => s.id.startsWith('screen:'));
      const windowSources = allSources.filter(s => s.id.startsWith('window:'));

      console.log(`[SS] Got ${screenSources.length} screen(s), ${windowSources.length} window(s)`);

      if (screenSources.length === 0 && windowSources.length === 0) {
        this._capturing = false;
        this._handleCaptureFailure('No sources returned — screen recording permission not granted');
        this._showPermissionDialog();
        return;
      }

      // Determine how many physical displays are connected
      const displays = screen.getAllDisplays();
      const multiMonitorEnabled = this.config.capture_multi_monitor === true;
      const hasMultipleDisplays = displays.length > 1;

      // ── Multi-Monitor Path ──
      // When multi-monitor is enabled AND there are 2+ displays, capture
      // each display individually and upload as separate screenshots
      // (Hubstaff-style per-display capture).
      if (hasMultipleDisplays && multiMonitorEnabled) {
        console.log(`[SS] Multi-monitor: capturing ${displays.length} displays individually`);
        const capturedDisplays = await this._captureAllDisplays(screenSources, windowSources, displays);

        const successCount = capturedDisplays.filter(d => d !== null).length;
        if (successCount === 0) {
          this._capturing = false;
          this._handleCaptureFailure('Multi-monitor capture returned no valid content from any display');
          if (isMac) this._showPermissionDialog(true);
          return;
        }

        console.log(`[SS] Multi-monitor: ${successCount}/${displays.length} displays captured`);

        // Upload each display's screenshot individually with display metadata
        if (this.currentEntryId) {
          for (let i = 0; i < capturedDisplays.length; i++) {
            if (capturedDisplays[i]) {
              const displayInfo = { display_index: i, display_count: displays.length };
              await this.upload(capturedDisplays[i], displayInfo);
            }
          }
          this._showNotification();
          this._consecutiveFailures = 0;
        }
      } else {
        // ── Single Monitor / Multi-Monitor Disabled Path ──
        // Original behavior: capture the active screen/window only
        let buffer = null;

        if (isMac) {
          // ── macOS Capture Strategy ──
          //
          // Use desktopCapturer ONLY — never call screencapture CLI.
          //
          // IMPORTANT: Window capture FIRST, screen capture fallback.
          // Ad-hoc signed apps (dev builds) get wallpaper-only from screen
          // capture. Window capture reliably returns the active app content.
          // Production builds with stable signatures work fine either way.

          // Try window capture first (captures frontmost/active window)
          if (windowSources.length > 0) {
            console.log(`[SS] macOS: trying window capture first (${windowSources.length} windows)`);
            buffer = this._captureActiveWindow(windowSources);
            if (buffer) {
              console.log(`[SS] macOS window capture succeeded (${Math.round(buffer.length / 1024)}KB)`);
            }
          }

          // Fallback: screen capture (may return wallpaper-only on ad-hoc signed apps)
          if (!buffer && screenSources.length > 0) {
            buffer = this._captureSingleMonitor(screenSources);
            if (buffer) {
              console.log(`[SS] macOS screen capture fallback (${Math.round(buffer.length / 1024)}KB)`);
            }
          }
        } else {
          // ── Windows / Linux: Screen capture works perfectly ──
          if (screenSources.length > 1) {
            console.log(`[SS] Finding active screen among ${screenSources.length}`);
            buffer = this._captureActiveScreen(screenSources);
          } else {
            buffer = this._captureSingleMonitor(screenSources);
          }
        }

        if (!buffer || buffer.length === 0) {
          this._capturing = false;
          this._handleCaptureFailure('Capture returned empty content despite permission appearing granted. Try: remove TrackFlow from Screen Recording, re-add, and restart.');
          if (isMac) this._showPermissionDialog(true); // force=true: status may say 'granted' but capture is wallpaper-only
          return;
        }

        console.log(`[SS] Captured ${buffer.length} bytes (${Math.round(buffer.length / 1024)}KB)`);

        // NOTE: Client-side blur removed (SS-11). The server's ProcessScreenshotJob
        // already applies blur when blur_screenshots is enabled. Having both client
        // and server blur causes double-blurring that makes images unusable.
        // The _applyBlur() method is kept below for potential future use.

        if (this.currentEntryId) {
          await this.upload(buffer);
          this._showNotification();
          this._consecutiveFailures = 0;
        }
      }
    } catch (e) {
      this._handleCaptureFailure(`Exception: ${e.message}`);
    } finally {
      this._capturing = false;
    }
  }

  // ── Active Window Capture ──────────────────────────────────────────
  //
  // Primary capture method on macOS (ad-hoc signed apps get wallpaper-only
  // from screen capture). Falls back to screen capture if no valid windows.

  _captureActiveWindow(windowSources) {
    if (!windowSources || windowSources.length === 0) return null;

    // Filter out TrackFlow's own windows, system UI, and tiny windows
    const skipPatterns = [
      'TrackFlow', 'Notification Center', 'Dock', 'WindowServer',
      'StatusBar', 'Control Center', 'Spotlight', 'Item-0',
    ];
    const validWindows = windowSources.filter(s => {
      const name = s.name || '';
      if (skipPatterns.some(skip => name.includes(skip))) return false;
      if (!s.thumbnail || s.thumbnail.isEmpty()) return false;
      const size = s.thumbnail.getSize();
      // Skip tiny windows (menubar items, tooltips, etc.)
      return size.width > 200 && size.height > 200;
    });

    // Log all valid windows for debugging
    for (const w of validWindows.slice(0, 5)) {
      const sz = w.thumbnail.getSize();
      console.log(`[SS]   window: "${w.name}" (${sz.width}x${sz.height})`);
    }

    if (validWindows.length === 0) {
      console.warn('[SS] No valid application windows found');
      return null;
    }

    // desktopCapturer returns windows in z-order — first = frontmost
    const activeWindow = validWindows[0];
    const size = activeWindow.thumbnail.getSize();
    const buffer = activeWindow.thumbnail.toJPEG(80);

    // Content validation: blank/wallpaper images compress to < 15KB at this resolution
    // A real application window at 1920x1080 JPEG quality 80 is typically > 30KB
    if (buffer.length < 15000) {
      console.warn(`[SS] Window "${activeWindow.name}" thumbnail too small (${buffer.length} bytes) — likely blank/permission-denied`);
      return null;
    }

    console.log(`[SS] Captured active window "${activeWindow.name}" (${size.width}x${size.height}, ${Math.round(buffer.length / 1024)}KB)`);
    return buffer;
  }

  // ── Per-Display Multi-Monitor Capture ────────────────────────────
  //
  // Hubstaff-style: capture each connected display individually so the
  // backend receives one screenshot per display per interval.
  //
  // On macOS, screen sources may return wallpaper-only (ad-hoc signing bug).
  // For each display that fails screen capture we attempt to find an
  // application window positioned on that display as a fallback.

  async _captureAllDisplays(screenSources, windowSources, displays) {
    const isMac = process.platform === 'darwin';
    const results = new Array(displays.length).fill(null);

    for (let i = 0; i < displays.length; i++) {
      const display = displays[i];
      const matchedSource = this._matchSourceToDisplay(screenSources, display, displays);

      let buffer = null;

      if (matchedSource) {
        const image = matchedSource.thumbnail;
        if (image && !image.isEmpty()) {
          const size = image.getSize();
          if (size.width > 0 && size.height > 0) {
            buffer = image.toJPEG(80);
            // Content validation: wallpaper-only images compress to < 15KB
            if (buffer.length < 15000) {
              console.warn(`[SS] Display ${i} ("${matchedSource.name}") thumbnail too small (${buffer.length} bytes) — likely wallpaper-only`);
              buffer = null;
            }
          }
        }
      }

      // macOS fallback: if screen source failed, try to find windows on this display
      if (!buffer && isMac && windowSources.length > 0) {
        buffer = this._captureWindowsOnDisplay(windowSources, display, i);
      }

      if (buffer) {
        console.log(`[SS] Display ${i}: captured ${Math.round(buffer.length / 1024)}KB (${display.size.width}x${display.size.height})`);
      } else {
        console.warn(`[SS] Display ${i}: capture failed (${display.size.width}x${display.size.height})`);
      }

      results[i] = buffer;
    }

    return results;
  }

  // Match a desktopCapturer screen source to an Electron display object.
  //
  // macOS:         source.display_id === display.id.toString()
  // Windows/Linux: source.id pattern "screen:N:0" maps to display index

  _matchSourceToDisplay(screenSources, display, allDisplays) {
    // macOS: match by display_id
    if (process.platform === 'darwin') {
      const match = screenSources.find(s => s.display_id === display.id.toString());
      if (match) return match;
    }

    // Windows/Linux: match by index in source.id ("screen:N:0")
    const displayIndex = allDisplays.findIndex(d => d.id === display.id);
    if (displayIndex >= 0) {
      for (const s of screenSources) {
        const idMatch = s.id.match(/screen:(\d+):/);
        if (idMatch && parseInt(idMatch[1]) === displayIndex) {
          return s;
        }
      }
      // Fallback: sources ordered same as displays
      if (displayIndex < screenSources.length) {
        return screenSources[displayIndex];
      }
    }

    return null;
  }

  // macOS fallback: find application windows positioned on a specific display.
  // Used when screen capture returns wallpaper-only for that display.

  _captureWindowsOnDisplay(windowSources, display, displayIndex) {
    const skipPatterns = [
      'TrackFlow', 'Notification Center', 'Dock', 'WindowServer',
      'StatusBar', 'Control Center', 'Spotlight', 'Item-0',
    ];

    // Display bounds — a window is "on" this display if its center falls within
    const db = display.bounds;

    // Filter windows to those on this display
    // NOTE: desktopCapturer does not expose window position directly; we cannot
    // reliably determine which display a window is on from desktopCapturer alone.
    // On macOS, BrowserWindow.getAllWindows() only lists OUR windows.
    //
    // Best-effort: for display 0 (primary / first), use the frontmost window.
    // For secondary displays, try screen source first (already attempted above).
    // This is an inherent Electron limitation — full per-display window mapping
    // would require native macOS APIs (CGWindowListCopyWindowInfo) which are not
    // exposed through Electron's sandboxed context.

    if (displayIndex === 0) {
      // Primary display: use the standard active-window capture
      return this._captureActiveWindow(windowSources);
    }

    // Secondary displays: try each valid window that hasn't been used.
    // Since we can't determine position, we return the first valid window
    // that passes content validation. This is a best-effort fallback;
    // proper screen capture (production-signed apps) is the reliable path.
    const validWindows = windowSources.filter(s => {
      const name = s.name || '';
      if (skipPatterns.some(skip => name.includes(skip))) return false;
      if (!s.thumbnail || s.thumbnail.isEmpty()) return false;
      const size = s.thumbnail.getSize();
      return size.width > 200 && size.height > 200;
    });

    // Skip the first window (already used for display 0) and try the rest
    for (let i = 1; i < validWindows.length; i++) {
      const win = validWindows[i];
      const buffer = win.thumbnail.toJPEG(80);
      if (buffer.length >= 15000) {
        console.log(`[SS] Display ${displayIndex}: using window fallback "${win.name}" (${Math.round(buffer.length / 1024)}KB)`);
        return buffer;
      }
    }

    console.warn(`[SS] Display ${displayIndex}: no valid window fallback available`);
    return null;
  }

  // ── Active Screen Detection ──────────────────────────────────────
  //
  // When user has multiple monitors (laptop + LED, dual monitors, etc.),
  // we need to capture the screen WHERE THE USER IS WORKING, not always
  // the primary display.
  //
  // Strategy: Use cursor position → find which Electron display it's on
  // → match that display to the correct desktopCapturer source.
  //
  // On macOS, source.display_id matches display.id.toString()
  // On Windows/Linux, source.id contains the display index as ":0:N"

  _captureActiveScreen(sources) {
    try {
      // 1. Find which display has the cursor
      const cursorPoint = screen.getCursorScreenPoint();
      const activeDisplay = screen.getDisplayNearestPoint(cursorPoint);
      console.log(`[SS] Cursor at (${cursorPoint.x}, ${cursorPoint.y}) — active display id=${activeDisplay.id} (${activeDisplay.size.width}x${activeDisplay.size.height})`);

      // 2. Try to match the active display to a source
      let activeSource = null;

      // macOS: source.display_id is a string matching the display ID
      if (process.platform === 'darwin') {
        activeSource = sources.find(s => s.display_id === activeDisplay.id.toString());
        if (activeSource) {
          console.log(`[SS] Matched source via display_id: "${activeSource.name}"`);
        }
      }

      // Windows/Linux: source.id format is "screen:N:0" where N is the display index
      // Match by comparing index position
      if (!activeSource) {
        const allDisplays = screen.getAllDisplays();
        const displayIndex = allDisplays.findIndex(d => d.id === activeDisplay.id);
        if (displayIndex >= 0) {
          // desktopCapturer sources are typically ordered by display index
          // Try matching by source.id pattern first
          for (const s of sources) {
            // Source IDs look like "screen:0:0", "screen:1:0" on Windows
            // or "screen:XXXXXXXX:0" on macOS
            const idMatch = s.id.match(/screen:(\d+):/);
            if (idMatch && parseInt(idMatch[1]) === displayIndex) {
              activeSource = s;
              console.log(`[SS] Matched source via display index ${displayIndex}: "${s.name}"`);
              break;
            }
          }
        }

        // Fallback: if sources are in same order as displays
        if (!activeSource && displayIndex >= 0 && displayIndex < sources.length) {
          activeSource = sources[displayIndex];
          console.log(`[SS] Matched source by position index ${displayIndex}: "${activeSource.name}"`);
        }
      }

      // 3. Use matched source, or fall back to first valid source
      if (activeSource) {
        const image = activeSource.thumbnail;
        if (image && !image.isEmpty()) {
          const size = image.getSize();
          if (size.width > 0 && size.height > 0) {
            console.log(`[SS] Capturing active screen "${activeSource.name}" (${size.width}x${size.height})`);
            return image.toJPEG(80);
          }
        }
      }

      console.warn('[SS] Could not match active display to source — falling back to first valid');
    } catch (e) {
      console.warn(`[SS] Active screen detection failed: ${e.message} — falling back`);
    }

    return this._captureSingleMonitor(sources);
  }

  // ── Single Monitor ────────────────────────────────────────────────

  _captureSingleMonitor(sources) {
    // Try to find a valid (non-empty) source
    for (const source of sources) {
      const image = source.thumbnail;
      if (image && !image.isEmpty()) {
        const size = image.getSize();
        if (size.width > 0 && size.height > 0) {
          const jpegBuffer = image.toJPEG(80);
          if (jpegBuffer.length > 0) {
            console.log(`[SS] Using source "${source.name}" (${size.width}x${size.height})`);
            return jpegBuffer;
          }
        }
      }
    }
    // All sources had empty thumbnails
    console.error(`[SS] All ${sources.length} source(s) had empty thumbnails`);
    return null;
  }

  // ── Multi-Monitor ─────────────────────────────────────────────────

  async _captureMultiMonitor(sources) {
    const sharpLib = getSharp();
    if (!sharpLib) {
      return this._captureSingleMonitor(sources);
    }

    // Collect valid thumbnails as PNG buffers
    const pngImages = [];
    for (const s of sources) {
      if (s.thumbnail && !s.thumbnail.isEmpty()) {
        const size = s.thumbnail.getSize();
        if (size.width > 0 && size.height > 0) {
          pngImages.push(s.thumbnail.toPNG());
        }
      }
    }

    if (pngImages.length === 0) return null;
    if (pngImages.length === 1) {
      return sharpLib(pngImages[0]).jpeg({ quality: 80 }).toBuffer();
    }

    // Composite all screens left-to-right
    const metas = [];
    for (const img of pngImages) {
      metas.push(await sharpLib(img).metadata());
    }

    let totalWidth = 0;
    let maxHeight = 0;
    const composites = [];

    for (let i = 0; i < pngImages.length; i++) {
      const w = metas[i].width || CAPTURE_WIDTH;
      const h = metas[i].height || CAPTURE_HEIGHT;
      maxHeight = Math.max(maxHeight, h);
      composites.push({ input: pngImages[i], left: totalWidth, top: 0 });
      totalWidth += w;
    }

    return sharpLib({
      create: {
        width: totalWidth,
        height: maxHeight,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .composite(composites)
      .jpeg({ quality: 80 })
      .toBuffer();
  }

  // ── Blur ──────────────────────────────────────────────────────────

  async _applyBlur(buffer) {
    const sharpLib = getSharp();
    if (!sharpLib) return buffer;
    try {
      return await sharpLib(buffer).blur(15).jpeg({ quality: 80 }).toBuffer();
    } catch (e) {
      console.warn('[SS] Blur failed:', e.message);
      return buffer;
    }
  }

  // ── Failure Tracking ──────────────────────────────────────────────

  _handleCaptureFailure(reason) {
    this._consecutiveFailures++;
    console.error(`[SS] FAILED (${this._consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${reason}`);

    if (this._consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.error(`[SS] PAUSED after ${MAX_CONSECUTIVE_FAILURES} consecutive failures. Will retry in 5 minutes.`);
      if (this._intervalTimer) {
        clearTimeout(this._intervalTimer);
        this._intervalTimer = null;
      }
      this._pauseTimeout = setTimeout(() => {
        this._pauseTimeout = null;
        this._consecutiveFailures = 0;
        if (this.currentEntryId) {
          console.log('[SS] Resuming after 5-minute pause');
          this._startInterval();
        }
      }, FAILURE_PAUSE_MS);
    }
  }

  // ── Notification ──────────────────────────────────────────────────

  _showNotification() {
    try {
      if (!Notification.isSupported()) return;
      this._closeNotification();

      const notification = new Notification({
        title: 'TrackFlow',
        body: 'Screenshot captured',
        silent: true,
        timeoutType: 'default',
      });
      notification.show();
      this._lastNotification = notification;

      const ref = notification;
      setTimeout(() => {
        try { ref.close(); } catch {}
        if (this._lastNotification === ref) this._lastNotification = null;
      }, 3000);
    } catch (e) {
      console.warn('[SS] Could not show notification:', e.message);
    }
  }

  _closeNotification() {
    if (this._lastNotification) {
      try { this._lastNotification.close(); } catch {}
      this._lastNotification = null;
    }
  }

  // ── Upload with retry ────────────────────────────────────────────

  async upload(buffer, displayInfo = null) {
    // Get current app context for this screenshot
    let appName = null;
    let windowTitle = null;
    try {
      if (this.activityMonitor) {
        appName = await this.activityMonitor.getActiveApp();
        windowTitle = await this.activityMonitor.getActiveWindowTitle();
      }
    } catch {}

    const displayLabel = displayInfo ? ` [display ${displayInfo.display_index}/${displayInfo.display_count}]` : '';

    let formData = this._buildFormData(buffer, appName, windowTitle, displayInfo);
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.apiClient.uploadScreenshot(formData);
        console.log(`[SS] Uploaded successfully${displayLabel} on attempt ${attempt} (${Math.round(buffer.length / 1024)}KB)`);
        return;
      } catch (e) {
        console.warn(`[SS] Upload attempt ${attempt}/3 failed${displayLabel}: ${e.message}`);
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
          // Rebuild FormData for retry (streams are consumed)
          formData = this._buildFormData(buffer, appName, windowTitle, displayInfo);
        }
      }
    }
    // All retries failed — queue for offline
    this._queueForOffline(buffer, appName, windowTitle, displayInfo);
  }

  _buildFormData(buffer, appName = null, windowTitle = null, displayInfo = null) {
    const formData = new FormData();
    formData.append('file', buffer, {
      filename: `screenshot_${Date.now()}.jpg`,
      contentType: 'image/jpeg',
    });
    formData.append('time_entry_id', String(this.currentEntryId));
    formData.append('captured_at', new Date().toISOString());
    if (appName) formData.append('app_name', appName);
    if (windowTitle) formData.append('window_title', windowTitle);

    // Attach point-in-time activity score (like Hubstaff)
    if (this.activityMonitor) {
      const score = this.activityMonitor.getCurrentScore();
      formData.append('activity_score', String(score));
    }

    // Multi-monitor metadata: display index (0-based) and total display count
    if (displayInfo) {
      formData.append('display_index', String(displayInfo.display_index));
      formData.append('display_count', String(displayInfo.display_count));
    }

    return formData;
  }

  _queueForOffline(buffer, appName = null, windowTitle = null, displayInfo = null) {
    if (buffer.length < 1024 * 1024) {
      const data = {
        buffer: buffer,
        time_entry_id: String(this.currentEntryId),
        captured_at: new Date().toISOString(),
      };
      if (appName) data.app_name = appName;
      if (windowTitle) data.window_title = windowTitle;
      if (displayInfo) {
        data.display_index = displayInfo.display_index;
        data.display_count = displayInfo.display_count;
      }
      this.offlineQueue.add('screenshot', data);
      console.log(`[SS] Queued for offline sync${displayInfo ? ` [display ${displayInfo.display_index}]` : ''}`);
    } else {
      console.warn(`[SS] Too large for offline queue (${Math.round(buffer.length / 1024)}KB), skipping`);
    }
  }
}

module.exports = ScreenshotService;
