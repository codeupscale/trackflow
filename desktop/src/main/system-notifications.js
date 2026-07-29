// Shared OS notification helper for the desktop agent.
// Centralizes Windows AppUserModelID setup, branded icon attachment,
// unique toast IDs (prevents Windows dedup/suppression), and failure logging.

const { app, Notification, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { getNotificationIcon } = require('./tray-icons');

const APP_USER_MODEL_ID = 'com.trackflow.agent';

let _initialized = false;
let _lastNotification = null;

function formatTimeShortLocal(date = new Date()) {
  const hours24 = date.getHours();
  const h = hours24 % 12 || 12;
  const m = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours24 >= 12 ? 'PM' : 'AM';
  return `${h}:${m} ${ampm}`;
}

/** Format a duration in seconds as "Xh Ym" (or "Ym" when under an hour). */
function formatDurationShort(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Pure dedup/coalescing decision for the tracking-state notification. Returns true
 * when a state notification should fire. Guards, in order:
 *   - not authenticated → never (respects logout / no session).
 *   - an automatic-stop toast fired within `autoStopSuppressMs` → skip (that toast
 *     is the specific message; don't contradict it — the resume-that-autostopped
 *     case).
 *   - an idle alert is showing → skip (the alert IS the state message).
 *   - SAME tracking state within `debounceMs` of the last state notif → skip
 *     (coalesces the paired resume+unlock a single lid-open emits). A genuine state
 *     change is always allowed through.
 *
 * @returns {boolean}
 */
function shouldNotifyTrackingState({
  isAuthenticated,
  isTracking,
  isIdleAlertActive = false,
  now,
  lastStateNotifAt = 0,
  lastNotifiedTracking = null,
  lastAutoStopNotifAt = 0,
  debounceMs = 5000,
  autoStopSuppressMs = 8000,
}) {
  if (!isAuthenticated) return false;
  if (now - lastAutoStopNotifAt < autoStopSuppressMs) return false;
  if (isIdleAlertActive) return false;
  if (isTracking === lastNotifiedTracking && now - lastStateNotifAt < debounceMs) {
    return false;
  }
  return true;
}

/**
 * Pure content selector for the "always know your tracking state" notification.
 * Kept pure (no I/O) so the title/body wording is unit-testable.
 *
 * @param {object} opts
 * @param {boolean} opts.isTracking - whether the timer is currently running
 * @param {number} [opts.todayTotalSeconds=0] - today's tracked total (all projects)
 * @returns {{ title: string, body: string }}
 */
function buildTrackingStateNotification({ isTracking, todayTotalSeconds = 0 } = {}) {
  if (isTracking) {
    return {
      title: 'TrackFlow — Tracking active',
      body: `Timer is running · today ${formatDurationShort(
        todayTotalSeconds,
      )}. You're being tracked.`,
    };
  }
  return {
    title: 'TrackFlow — Not tracking',
    body: "Timer is stopped — you are NOT being tracked. Start the timer when you're ready.",
  };
}

function resolveNotificationIcon() {
  const branded = getNotificationIcon();
  if (branded && !branded.isEmpty()) return branded;

  const candidates = [
    path.join(process.resourcesPath, 'tray', 'notification-icon.png'),
    path.join(__dirname, '..', '..', 'build', 'tray', 'notification-icon.png'),
    path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    path.join(__dirname, '..', '..', 'build', 'icon.png'),
  ];

  for (const iconPath of candidates) {
    if (!fs.existsSync(iconPath)) continue;
    const img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty()) return img;
  }

  return null;
}

/**
 * Call once at app startup (before any Notification.show()).
 */
function initSystemNotifications() {
  if (_initialized) return;
  _initialized = true;

  if (process.platform === 'win32') {
    try {
      app.setAppUserModelId(APP_USER_MODEL_ID);
    } catch (e) {
      console.warn('[Notification] setAppUserModelId failed:', e.message);
    }
  }
}

/**
 * Show a native OS notification with platform best practices applied.
 *
 * @param {object} options
 * @param {string} options.title
 * @param {string} options.body
 * @param {boolean} [options.silent=false]
 * @param {number} [options.durationMs=0] - Auto-close after N ms (0 = no auto-close)
 * @param {string} [options.id] - Unique toast id (auto-generated if omitted)
 * @param {boolean} [options.closePrevious=true] - Close the prior toast from this helper
 * @param {(notification: Electron.Notification) => void} [options.onClick]
 * @returns {Electron.Notification|null}
 */
function showSystemNotification({
  title,
  body,
  silent = false,
  durationMs = 0,
  id,
  closePrevious = true,
  onClick,
} = {}) {
  try {
    if (!Notification.isSupported()) return null;

    if (closePrevious && _lastNotification) {
      try { _lastNotification.close(); } catch {}
      _lastNotification = null;
    }

    const notificationId = id || `trackflow-${Date.now()}`;
    const options = {
      id: notificationId,
      title,
      body,
      silent,
    };

    const icon = resolveNotificationIcon();
    if (icon) options.icon = icon;

    const notification = new Notification(options);

    notification.on('failed', (_event, error) => {
      console.warn(`[Notification] failed (${notificationId}):`, error);
    });

    if (typeof onClick === 'function') {
      notification.on('click', () => onClick(notification));
    }

    notification.show();
    _lastNotification = notification;

    if (durationMs > 0) {
      const ref = notification;
      setTimeout(() => {
        try { ref.close(); } catch {}
        if (_lastNotification === ref) _lastNotification = null;
      }, durationMs);
    }

    return notification;
  } catch (e) {
    console.warn('[Notification] Could not show notification:', e.message);
    return null;
  }
}

module.exports = {
  APP_USER_MODEL_ID,
  initSystemNotifications,
  showSystemNotification,
  formatTimeShortLocal,
  formatDurationShort,
  buildTrackingStateNotification,
  shouldNotifyTrackingState,
};
