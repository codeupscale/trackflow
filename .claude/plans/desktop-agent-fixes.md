# Desktop Agent — Fix Plan

**Scope:** All issues from the 2026-04-02 desktop code review
**Agent:** `desktop-engineer`
**Branch:** `fix/desktop-agent-issues`
**Execution order:** BUGs → HIGH → MEDIUM → LOW

---

## Phase 1 — Critical Bugs (do first, can ship independently)

### B1 — `stopTimer()` not awaited in idle stop action
**File:** `src/main/index.js`
**Fix:** Add `await` before `stopTimer()` in the `case 'stop':` branch of `handleIdleAction`. Ensure `handleIdleAction` is declared `async` if not already.

### B2 — OAuth callback HTTP server not closed on timeout
**File:** `src/main/index.js`
**Fix:** In the 5-minute timeout handler, call `callbackServer.close()` *before* resolving the promise. Also wrap the request handler in a guard (`if (settled) return`) so late-arriving callbacks after timeout are ignored.

### B3 — Timer sync interval overlap on re-login
**File:** `src/main/index.js`
**Fix:** In `startTimerSync()`, ensure the existing interval guard `clearInterval(timerSyncInterval)` is confirmed to fire before re-login calls `initializeApp()` again. Audit all paths that call `initializeApp()` and ensure `stopTimerSync()` runs first.

---

## Phase 2 — HIGH Priority

### H1 — Sandbox disabled in development
**File:** `src/main/index.js` (3 BrowserWindow constructors)
**Fix:** Change `sandbox: process.env.NODE_ENV !== 'development'` → `sandbox: true` unconditionally in all three window constructors. Verify renderer still works; if dev tools break, use `webContents.openDevTools()` instead of disabling sandbox.

### H4 — Swallowed exceptions in timer sync
**File:** `src/main/index.js`
**Fix:** Replace empty `catch {}` in the timer sync interval with structured error logging:
```javascript
catch (err) {
  console.error('[TimerSync] sync failed:', err.message);
  // Do not re-throw — keep interval alive
}
```

### H2 — Monolithic index.js (2562 lines)
**Strategy:** Extract into focused modules. Do in stages to avoid a single massive diff.
- `src/main/window-manager.js` — all BrowserWindow creation + show/hide logic
- `src/main/auth-manager.js` — login, logout, Google OAuth, org selection
- `src/main/timer-manager.js` — timer start/stop/sync, tray timer tick, state cache
- `src/main/power-manager.js` — suspend/resume/shutdown handlers, powerMonitor listeners
- `index.js` becomes an orchestrator: imports the above, wires events, calls `app.whenReady()`

### H3 — 16 global mutable variables
**File:** `src/main/index.js`
**Fix:** Consolidate into a single `AppState` object:
```javascript
const AppState = {
  tray: null, popupWindow: null, loginWindow: null,
  apiClient: null, activityMonitor: null, screenshotService: null,
  idleDetector: null, offlineQueue: null,
  isTimerRunning: false, currentEntry: null,
  todayTotalGlobal: 0, todayTotalCurrentProject: 0,
  config: null, cachedProjects: [], isAuthenticated: false,
  timerSyncInterval: null,
};
```
All mutations go through `AppState.field = value`. This makes state transitions auditable.

---

## Phase 3 — MEDIUM Priority

### M1 — Heartbeat data loss (reset before store)
**File:** `src/main/activity-monitor.js`
**Fix:** Snapshot counters, reset them immediately (to avoid double-counting on retry), then attempt API/queue. If *both* fail, restore snapshot values:
```javascript
const snapshot = { keys: keyboardCount, mouse: mouseCount, seconds: [..._activeSeconds] };
keyboardCount = 0; mouseCount = 0; _activeSeconds.clear();
try {
  await api.sendHeartbeat(snapshot);
} catch {
  try { await offlineQueue.add('heartbeat', snapshot); }
  catch { /* restore */ keyboardCount += snapshot.keys; mouseCount += snapshot.mouse; snapshot.seconds.forEach(s => _activeSeconds.add(s)); }
}
```

### M2 — Synchronous file I/O in offline queue
**File:** `src/main/offline-queue.js`
**Fix:** Replace `fs.writeFileSync` / `fs.readFileSync` with `fs.promises.writeFile` / `fs.promises.readFile`. Ensure callers `await` these. For screenshot blob writes, consider a worker thread via `worker_threads` if file sizes exceed 500KB regularly.

### M3 — Windows active-window detection wrong
**File:** `src/main/activity-monitor.js`
**Fix:** Replace the `Get-Process` PowerShell command with a proper foreground-window query:
```powershell
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class Win32{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern int GetWindowText(IntPtr hWnd,System.Text.StringBuilder text,int count);[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr hWnd,out uint pid);}';
$hwnd=[Win32]::GetForegroundWindow();
$pid=0;[Win32]::GetWindowThreadProcessId($hwnd,[ref]$pid)|Out-Null;
$p=Get-Process -Id $pid -ErrorAction SilentlyContinue;
$title=New-Object System.Text.StringBuilder 256;[Win32]::GetWindowText($hwnd,$title,256)|Out-Null;
"$($p.Name)|$($title.ToString())"
```

### M4 — powerMonitor listeners stack on re-login
**File:** `src/main/index.js`
**Fix:** Extract `handleSuspend` and `handleResume` as named module-level functions. Register them once on app startup (`app.whenReady()`), not inside `initializeApp()`. Use `powerMonitor.removeAllListeners('suspend')` defensively before re-adding.

### M5 — Auto-start without user consent
**File:** `src/main/index.js`
**Fix:** Gate `setLoginItemSettings({ openAtLogin: true })` behind a user preference stored in config. On first launch, show a dialog or preference toggle. Read `config.get('launchAtLogin', false)` before calling.

### M6 — Concurrent API calls in sync cycle
**File:** `src/main/index.js`
**Fix:** Add a `isSyncing` boolean guard at the top of the sync interval callback:
```javascript
if (isSyncing) return;
isSyncing = true;
try { /* sync work */ } finally { isSyncing = false; }
```

### M7 — Null offlineQueue race after logout
**File:** `src/main/index.js`
**Fix:** In all offline fallback calls, guard with `if (AppState.offlineQueue)`. In `performLogout()`, set a `isLoggingOut` flag that short-circuits in-flight async operations before nulling the queue.

### M8 — Clock skew for elapsed time
**File:** `src/main/index.js`
**Fix:** When the backend returns `started_at`, also return server's `current_time`. Compute `serverElapsedMs = serverCurrentTime - startedAt`. Apply `clockOffset = serverCurrentTime - Date.now()` and use `Date.now() + clockOffset` for local display.

### M9 — Multi-monitor screenshot on macOS
**File:** `src/main/screenshot-service.js`
**Fix:** Use `screen.getCursorScreenPoint()` to get the display the user is actively working on, then match `desktopCapturer` sources by display ID. For non-cursor displays, fall back to screen capture using `screen:N:0` pattern.

---

## Phase 4 — LOW Priority

### L1 — Hardcoded PBKDF2 secret
**File:** `src/main/keychain.js`
**Fix:** Derive the secret from a combination of: machine UUID (`os.networkInterfaces()` MAC hash) + app version + static suffix. Document explicitly that this is "obscurity not security" for keychain-popup-free operation on macOS.

### L2 — .env bundled in production
**File:** `package.json`
**Fix:** Remove `.env` from `extraResources`. Move `POSTHOG_API_KEY` to a compile-time constant injected via `electron-builder` `extraMetadata` or environment variable substitution at build time. Never ship `.env` in the binary.

### L3 — CSP unsafe-inline in main windows
**Files:** `src/renderer/index.html`, `src/renderer/login.html`
**Fix:** Move all inline `<script>` blocks to external `.js` files. Remove `'unsafe-inline'` from `script-src`. Match the `idle-alert.html` policy.

### L4 — 300ms keepalive polling
**File:** `src/main/index.js`
**Fix:** Replace `setInterval(_pinKeepalive, 300)` with event-driven re-assertion:
```javascript
app.on('browser-window-focus', () => { if (isPinned) win.setAlwaysOnTop(true, 'floating', 1); });
app.on('browser-window-blur', () => { if (isPinned) win.moveTop(); });
```

### L5 — Tray icon not cached
**File:** `src/main/tray-icons.js`
**Fix:** Generate both icon states (`tracking=true`, `tracking=false`) once at startup and cache in a module-level Map. `updateTrayIcon(state)` just reads from cache.

### L6 — xdotool broken on Wayland
**File:** `src/main/activity-monitor.js`
**Fix:** Detect Wayland with `process.env.WAYLAND_DISPLAY`. If set, use `ydotool` or `wlrctl` as fallback. If neither is available, return `null` and log a one-time warning.

### L7 — cleanupOrphanedFiles never called
**File:** `src/main/index.js`
**Fix:** Call `offlineQueue.cleanupOrphanedFiles()` on app startup (after `initializeApp()` completes) and also after each successful flush cycle.

### L8 — PostHog null distinctId
**File:** `src/main/index.js`
**Fix:** Replace `posthog.capture(null, ...)` with `posthog.capture(userId || 'anonymous', ...)` where `userId` comes from the authenticated user stored in `AppState`.

### L9 — Offline queue priority (screenshots starving heartbeats)
**File:** `src/main/offline-queue.js`
**Fix:** Add a `priority` column (INTEGER, default 0). Heartbeats get `priority=1` (higher), screenshots get `priority=0`. Flush query: `ORDER BY priority DESC, id ASC LIMIT 500`.

### L10 — No SQLite schema migration
**File:** `src/main/offline-queue.js`
**Fix:** Add a `schema_version` table. On startup, read current version and run incremental migrations (v1→v2, etc.) before any queue operations.

### L11 — No update retry scheduling
**File:** `src/main/index.js`
**Fix:** After a failed `checkForUpdates()`, schedule a retry with exponential backoff using `setTimeout`. Max 3 retries per session.

### L12 — Tray sends IPC to hidden popup
**File:** `src/main/index.js`
**Fix:** In `startTrayTimer()`, guard IPC sends with `if (popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible())`.

---

## Execution Instructions for desktop-engineer agent

When implementing, follow this order strictly:

1. **Create branch** `fix/desktop-agent-issues` from `feat/hr-phase-1`
2. **Phase 1 (B1-B3):** 3 targeted bug fixes, commit as `fix(desktop): critical bug fixes — stopTimer await, OAuth server leak, sync interval overlap`
3. **Phase 2 (H1, H4):** Security + error handling, commit as `fix(desktop): enforce sandbox unconditionally, structured error logging in sync`
4. **Phase 2 (H2, H3):** Refactor — extract modules + AppState, commit as `refactor(desktop): extract window/auth/timer/power managers, consolidate AppState`
5. **Phase 3 (M1-M9):** Medium fixes, commit in logical groups (activity, queue, windows, sync)
6. **Phase 4 (L1-L12):** Low priority, commit as `chore(desktop): low-priority hardening and cleanup`

### Testing checklist after each phase:
- [ ] App launches on macOS without errors
- [ ] Login + timer start/stop works
- [ ] Screenshot captured and queued
- [ ] Offline mode: queue items persist, flush on reconnect
- [ ] Idle detection fires after configured threshold
- [ ] Google OAuth completes without server leak
- [ ] `npm run build` produces valid DMG
- [ ] Memory stays under 150MB during 5-minute tracking session
