# Desktop — Windows screenshot capture notification not shown

**Status:** ✅ FIXED (2026-07-06) — branch `fix/web-frontend-and-desktop-app`

**Severity:** P2 (UX / monitoring transparency)

**Scope:** Desktop agent (Electron) — screenshot capture toast on Windows only.

## Symptom

While the timer is running and screenshots are captured/uploaded successfully, macOS shows a brief "Screenshot captured" system notification after each capture. On Windows, no equivalent toast appears. Other TrackFlow notifications on Windows (idle auto-stop, sleep auto-stop, update ready) work normally.

## Root cause

Screenshot notifications were implemented in `ScreenshotService._showNotification()` but used a Windows-unfriendly configuration that differed from every other working TrackFlow toast:

| Option | Screenshot toast (broken on Windows) | Working toasts |
|--------|-----------------------------------|----------------|
| `silent` | `true` | `false` |
| `icon` | none | none |
| Body | static `"Screenshot captured"` every interval | dynamic text |
| Auto-dismiss | 3 seconds | 5s or none |
| `timeoutType` | `'default'` | unset |

Additionally:

1. **`getNotificationIcon()` was dead code** — a branded notification icon was added in v1.0.41 (`desktop/build/tray/notification-icon.png`, loader in `tray-icons.js`) but never passed to any `Notification` constructor.
2. **No `failed` event handler** — Windows toast failures were invisible in logs.
3. **No shared notification helper** — four separate inline `new Notification()` call sites with inconsistent options.

Global Windows notification registration (NSIS Start Menu shortcut / AppUserModelID) was already sufficient for idle/power/update toasts; the bug was screenshot-specific options and missing icon/id wiring.

## Evidence

- `desktop/src/main/screenshot-service.js:891-912` — inline `Notification` with `silent: true`, static body, no icon, 3s close
- `desktop/src/main/tray-icons.js:135-141` — `getNotificationIcon()` exported but unused anywhere
- `desktop/src/main/index.js` — idle/update/power notifications use `silent: false` and dynamic bodies

## Fix

1. Added `desktop/src/main/system-notifications.js`:
   - `initSystemNotifications()` — calls `app.setAppUserModelId('com.trackflow.agent')` on `win32`
   - `showSystemNotification()` — attaches branded icon, unique `id` per toast, `failed` event logging, optional auto-close
2. `ScreenshotService._showNotification()` now delegates to `showSystemNotification()` with:
   - `silent: true` (no sound every capture interval)
   - timestamp body: `Screenshot captured at HH:MM`
   - unique `id`: `screenshot-${Date.now()}`
   - 5s dismiss (was 3s)
3. `initSystemNotifications()` called at start of `app.on('ready')` in `index.js`
4. Unit tests in `desktop/test/system-notifications.test.js`; updated `screenshot-service.test.js`

## Verification

On Windows 10/11 packaged build:

1. Start timer; wait for first screenshot capture
2. Confirm banner toast: **TrackFlow — Screenshot captured at HH:MM** (no sound)
3. Confirm second-interval capture also shows a banner
4. Confirm idle/sleep/update toasts still work
5. If missing: check **Settings → System → Notifications → TrackFlow** and Action Center for grouped entries
