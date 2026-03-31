# TrackFlow Desktop Agent -- E2E Test Plan

## Document Info

| Field | Value |
|---|---|
| Version | 1.0.0 |
| App Version | 1.0.20 |
| Date | 2026-03-31 |
| Author | TrackFlow QA |
| Test Framework | Jest 29 (Node environment) |
| Test Directory | `desktop/test/e2e/` |

---

## 1. Screen Inventory

### 1.1 Login Screen (`src/renderer/login.html`)

| Element ID | Type | Purpose |
|---|---|---|
| `loginView` | Container | Login form card |
| `loginForm` | Form | Email/password form |
| `email` | Input (email) | Email address field |
| `password` | Input (password) | Password field |
| `passwordToggle` | Button | Show/hide password toggle |
| `eyeIcon` | SVG | Eye icon (password hidden) |
| `eyeOffIcon` | SVG | Eye-off icon (password visible) |
| `submitBtn` | Button | "Sign In" submit button |
| `googleBtn` | Button | "Sign in with Google" button |
| `errorMsg` | Div | Error message display (hidden by default) |
| `closeBtn` | Button | Window close button in titlebar |
| `titlebar` | Div | Custom titlebar with TrackFlow logo |

### 1.2 Organization Selector Screen (`src/renderer/login.html` -- orgView)

| Element ID | Type | Purpose |
|---|---|---|
| `orgView` | Container | Organization selector card |
| `orgList` | Div | Container for dynamically generated org buttons |
| `.org-item` (dynamic) | Button | Individual organization button |
| `orgErrorMsg` | Div | Error message for org selection |
| `backBtn` | Button | "Back to login" button |

### 1.3 Main Timer Window (`src/renderer/index.html`)

| Element ID | Type | Purpose |
|---|---|---|
| `timerDisplay` | Div | Timer display (HH:MM:SS) |
| `statusDot` | Span | Green/gray status indicator dot |
| `statusText` | Span | "Tracking" / "Stopped" / "Today's Total" |
| `projectSelect` | Select | Project dropdown selector |
| `startBtn` | Button | Start timer button |
| `startBtnText` | Span | Start button label text |
| `stopBtn` | Button | Stop timer button (hidden when stopped) |
| `logoutBtn` | Button | Logout button in titlebar |
| `logoutLink` | Link | "Sign out" link in footer |
| `dashboardLink` | Link | "Open Dashboard" link in footer |
| `permissionBanner` | Div | Screenshot permission warning banner |
| `fixPermissionBtn` | Button | "Fix" button in permission banner |
| `wallpaperBanner` | Div | Wallpaper-only capture warning banner |
| `fixWallpaperBtn` | Button | "Fix" button in wallpaper banner |
| `updateOverlay` | Div | Update available dialog overlay |
| `updateTitle` | Div | Update dialog title |
| `updateBody` | Div | Update dialog description |
| `updateRestartBtn` | Button | "Restart Now" button |
| `updateLaterBtn` | Button | "Later" button |
| `updateBadge` | Span | Blue dot badge for pending update |

### 1.4 Idle Alert Popup (`src/renderer/idle-alert.html` + `idle-alert.js`)

| Element ID | Type | Purpose |
|---|---|---|
| `idleTime` | Div | Idle time display (HH:MM:SS) |
| `keepBtn` | Button | "Keep Idle Time" -- counts idle as work |
| `discardBtn` | Button | "Discard Idle Time" -- removes idle period |
| `reassignProject` | Select | Project dropdown for reassignment |
| `reassignBtn` | Button | "Reassign" button (disabled until project selected) |
| `stopBtn` | Button | "Stop Timer" -- stops tracking completely |
| `autoStopBar` | Div | Auto-stop countdown container |
| `autoStopCountdown` | Span | Auto-stop countdown timer display |

### 1.5 System Tray Menu (built in `main/index.js`)

| Menu Item | Condition | Action |
|---|---|---|
| "Sign In to TrackFlow" | Not authenticated | Opens login window |
| "Quit TrackFlow" | Always (unauthenticated) | Quits app |
| "Tracking: HH:MM" | Timer running | Status display (disabled) |
| "Project: [name]" | Timer running | Status display (disabled) |
| "Today: HH:MM" | Timer stopped, has time | Status display (disabled) |
| "Not tracking" | Timer stopped, no time | Status display (disabled) |
| "Stop Timer" | Timer running | Stops the timer |
| "Start Timer" (submenu) | Timer stopped, has projects | Start with project selection |
| "Start Timer" | Timer stopped, no projects | Start without project |
| "Open App Window" | Authenticated | Shows popup window |
| "Open Dashboard" | Authenticated | Opens web dashboard in browser |
| "Sign Out" | Authenticated | Logs out |
| "Quit TrackFlow" | Always (authenticated) | Quits app |

---

## 2. IPC Channel Inventory (Preload API Surface)

All IPC channels exposed via `contextBridge.exposeInMainWorld('trackflow', ...)`:

### 2.1 Invoke Channels (Request/Response via `ipcRenderer.invoke`)

| Channel | Preload Method | Direction | Purpose |
|---|---|---|---|
| `get-timer-state` | `getTimerState(projectId)` | Renderer -> Main | Get current timer state |
| `start-timer` | `startTimer(projectId)` | Renderer -> Main | Start time tracking |
| `stop-timer` | `stopTimer()` | Renderer -> Main | Stop time tracking |
| `get-projects` | `getProjects()` | Renderer -> Main | Fetch project list |
| `get-last-project` | `getLastProject()` | Renderer -> Main | Get last selected project ID |
| `set-last-project` | `setLastProject(projectId)` | Renderer -> Main | Persist selected project ID |
| `logout` | `logout()` | Renderer -> Main | Perform logout |
| `login` | `login(email, password)` | Renderer -> Main | Email/password login |
| `google-login` | `googleLogin()` | Renderer -> Main | Google OAuth login |
| `select-organization` | `selectOrganization(orgId, credentials)` | Renderer -> Main | Complete multi-org login |
| `open-dashboard` | `openDashboard()` | Renderer -> Main | Open web dashboard |
| `resolve-idle` | `resolveIdle(action, projectId)` | Renderer -> Main | Handle idle alert action |
| `check-screen-permission` | `checkScreenPermission()` | Renderer -> Main | Check macOS screen recording |
| `request-screen-permission` | `requestScreenPermission()` | Renderer -> Main | Request screen recording |
| `open-screen-recording-settings` | `openScreenRecordingSettings()` | Renderer -> Main | Open System Preferences |
| `get-theme` | `getTheme()` | Renderer -> Main | Get OS theme (light/dark) |
| `install-update` | `installUpdate()` | Renderer -> Main | Install downloaded update |

### 2.2 Event Channels (Push from Main via `ipcRenderer.on`)

| Channel | Preload Method | Direction | Purpose |
|---|---|---|---|
| `timer-started` | `onTimerStarted(cb)` | Main -> Renderer | Timer started notification |
| `timer-stopped` | `onTimerStopped(cb)` | Main -> Renderer | Timer stopped notification |
| `timer-tick` | `onTimerTick(cb)` | Main -> Renderer | Timer tick (every second) |
| `sync-timer` | `onSyncTimer(cb)` | Main -> Renderer | Full timer state resync |
| `projects-ready` | `onProjectsReady(cb)` | Main -> Renderer | Projects available after init |
| `idle-data` | `onIdleData(cb)` | Main -> Renderer | Idle alert data |
| `org-selection-required` | `onOrgSelection(cb)` | Main -> Renderer | Multi-org login detected |
| `google-auth-error` | `onGoogleAuthError(cb)` | Main -> Renderer | Google OAuth error |
| `permission-status` | `onPermissionStatus(cb)` | Main -> Renderer | Permission state change |
| `screenshot-permission-issue` | `onScreenshotPermissionIssue(cb)` | Main -> Renderer | Wallpaper-only detection |
| `theme-changed` | `onThemeChange(cb)` | Main -> Renderer | OS theme changed |
| `update-ready` | `onUpdateReady(cb)` | Main -> Renderer | Update downloaded and ready |

---

## 3. Test Cases

### 3.1 Login Screen Tests

```
TC-001: Login form renders with all required elements
Priority: Critical
Type: UI
Expected: Email input, password input, submit button, Google button all present

TC-002: Empty email shows validation error
Priority: High
Type: UI
Expected: Error message "Please enter your email" displayed, email input focused

TC-003: Empty password shows validation error
Priority: High
Type: UI
Expected: Error message "Please enter your password" displayed, password input focused

TC-004: Successful email/password login calls trackflow.login
Priority: Critical
Type: IPC/Integration
Expected: trackflow.login called with email and password values

TC-005: Login error displays error message
Priority: High
Type: IPC/Integration
Expected: Error message displayed with text from API response

TC-006: Network failure shows connection error
Priority: High
Type: Integration
Expected: Error message "Connection failed. Please check your internet."

TC-007: Multi-org login shows organization selector
Priority: Critical
Type: IPC/Integration
Expected: Login view hidden, org selector visible with org list

TC-008: Password toggle shows/hides password
Priority: Medium
Type: UI
Expected: Password input type toggles between 'password' and 'text'

TC-009: Submit button disabled during login attempt
Priority: High
Type: UI
Expected: Button disabled and text changes to "Signing in..."

TC-010: Close button closes window
Priority: Medium
Type: UI
Expected: window.close() called

TC-011: Google Sign-In button triggers google-login IPC
Priority: Critical
Type: IPC
Expected: trackflow.googleLogin() called

TC-012: Google login button disabled during attempt
Priority: High
Type: UI
Expected: Button disabled and text changes to "Opening browser..."

TC-013: Google login multi-org triggers org selector
Priority: High
Type: IPC/Integration
Expected: Org selector shown with organizations from Google response

TC-014: Google login error shows error message
Priority: High
Type: Integration
Expected: Error message displayed

TC-015: Google login exception shows generic error
Priority: Medium
Type: Integration
Expected: "Google sign-in failed. Please try again."
```

### 3.2 Organization Selector Tests

```
TC-020: Org selector renders organizations dynamically
Priority: Critical
Type: UI
Expected: One button per org with initials, name, role, and plan

TC-021: Clicking an org calls selectOrganization with correct params
Priority: Critical
Type: IPC
Expected: trackflow.selectOrganization(orgId, credentials) called

TC-022: Org selection error displays error message
Priority: High
Type: Integration
Expected: orgErrorMsg visible with error text

TC-023: All org buttons disabled during selection attempt
Priority: Medium
Type: UI
Expected: All .org-item buttons disabled during API call

TC-024: Back button returns to login form
Priority: High
Type: UI
Expected: orgView hidden, loginView visible, pendingCredentials cleared

TC-025: Org initials computed correctly
Priority: Low
Type: UI
Expected: "Acme Corp" -> "AC", single word -> first letter
```

### 3.3 Main Timer Window Tests

```
TC-030: Timer display shows 00:00:00 initially
Priority: Critical
Type: UI
Expected: Timer text is "00:00:00", class "stopped", status "Stopped"

TC-031: Start button calls startTimer with selected project
Priority: Critical
Type: IPC
Expected: trackflow.startTimer(projectId) called

TC-032: Start button disabled when no project selected
Priority: High
Type: UI
Expected: Button disabled, opacity 0.5, cursor not-allowed

TC-033: Stop button calls stopTimer
Priority: Critical
Type: IPC
Expected: trackflow.stopTimer() called

TC-034: Start/Stop button visibility toggles with timer state
Priority: Critical
Type: UI
Expected: Start visible when stopped, Stop visible when running

TC-035: Timer display updates on timer-tick event
Priority: Critical
Type: IPC/Integration
Expected: Display updates with formatted time from tick data

TC-036: Project dropdown populated from getProjects
Priority: High
Type: IPC
Expected: Select options match project list from API

TC-037: Project dropdown disabled while timer running
Priority: Medium
Type: UI
Expected: select.disabled = true during tracking

TC-038: Status text shows "Tracking" when running
Priority: Medium
Type: UI
Expected: statusText content is "Tracking"

TC-039: Status dot green when running, gray when stopped
Priority: Low
Type: UI
Expected: dot class toggles between "green" and "gray"

TC-040: Logout button calls logout
Priority: High
Type: IPC
Expected: trackflow.logout() called

TC-041: Dashboard link calls openDashboard
Priority: Medium
Type: IPC
Expected: trackflow.openDashboard() called

TC-042: Enter key starts/stops timer
Priority: Medium
Type: UI
Expected: Enter starts when stopped, stops when running

TC-043: Cmd/Ctrl+Q triggers logout
Priority: Medium
Type: UI
Expected: handleLogout called

TC-044: Escape key blurs window
Priority: Low
Type: UI
Expected: window.blur() called

TC-045: Timer-started event updates display to running state
Priority: Critical
Type: IPC
Expected: Display shows running, green dot, "Tracking" status

TC-046: Timer-stopped event updates display to stopped state
Priority: Critical
Type: IPC
Expected: Display shows stopped, gray dot, total time preserved

TC-047: Sync-timer event triggers full state resync
Priority: High
Type: IPC
Expected: syncTimerState called, display updated

TC-048: Projects-ready event reloads project list
Priority: Medium
Type: IPC
Expected: loadProjects called when projects-ready received

TC-049: Permission banner shown when screen recording not granted
Priority: High
Type: Integration
Expected: permissionBanner visible with "Fix" button

TC-050: Fix permission button calls requestScreenPermission
Priority: Medium
Type: IPC
Expected: trackflow.requestScreenPermission() called

TC-051: Wallpaper banner shown on screenshot-permission-issue event
Priority: Medium
Type: IPC
Expected: wallpaperBanner visible when type='wallpaper-detected'

TC-052: Last project restored on init
Priority: Medium
Type: Integration
Expected: getLastProject called, select value set if project exists

TC-053: Project change persists via setLastProject
Priority: Medium
Type: IPC
Expected: trackflow.setLastProject(value) called on change

TC-054: formatTime correctly formats seconds
Priority: High
Type: Unit
Expected: 3661 -> "01:01:01", 0 -> "00:00:00"
```

### 3.4 Update Dialog Tests

```
TC-060: Update dialog shown when update-ready event received
Priority: High
Type: IPC
Expected: updateOverlay visible with version in body text

TC-061: Restart Now button calls installUpdate
Priority: High
Type: IPC
Expected: trackflow.installUpdate() called

TC-062: Later button hides dialog and shows badge
Priority: Medium
Type: UI
Expected: Overlay hidden, updateBadge visible

TC-063: Badge click reopens update dialog
Priority: Medium
Type: UI
Expected: Dialog visible again with same version
```

### 3.5 Idle Alert Tests

```
TC-070: Idle time display updates every second
Priority: Critical
Type: UI/Integration
Expected: idleTime text increments every 1000ms

TC-071: Keep button calls resolveIdle('keep')
Priority: Critical
Type: IPC
Expected: trackflow.resolveIdle('keep') called

TC-072: Discard button calls resolveIdle('discard')
Priority: Critical
Type: IPC
Expected: trackflow.resolveIdle('discard') called

TC-073: Stop button calls resolveIdle('stop')
Priority: Critical
Type: IPC
Expected: trackflow.resolveIdle('stop') called

TC-074: Reassign button calls resolveIdle('reassign', projectId)
Priority: High
Type: IPC
Expected: trackflow.resolveIdle('reassign', selectedProjectId) called

TC-075: Reassign button disabled until project selected
Priority: Medium
Type: UI
Expected: button.disabled = true when select value is empty

TC-076: Project list populated from idle-data event
Priority: High
Type: IPC
Expected: reassignProject options match data.projects

TC-077: Keyboard shortcut K triggers Keep
Priority: Medium
Type: UI
Expected: keepBtn click fired

TC-078: Keyboard shortcut D triggers Discard
Priority: Medium
Type: UI
Expected: discardBtn click fired

TC-079: Keyboard shortcut S triggers Stop
Priority: Medium
Type: UI
Expected: stopBtn click fired

TC-080: Keyboard shortcut R triggers Reassign or focuses select
Priority: Medium
Type: UI
Expected: Reassign if project selected, focus select if not

TC-081: Auto-stop countdown displayed when autoStopTotalSec provided
Priority: Medium
Type: Integration
Expected: autoStopBar visible, countdown decrements

TC-082: Idle time formatted correctly
Priority: High
Type: Unit
Expected: 125 seconds -> "00:02:05"

TC-083: Theme applied from getTheme on load
Priority: Low
Type: Integration
Expected: data-theme attribute set based on OS theme
```

### 3.6 System Tray Menu Tests

```
TC-090: Unauthenticated tray shows "Sign In" and "Quit"
Priority: Critical
Type: Integration
Expected: Menu has 2 items + separator

TC-091: Authenticated tray shows timer status when running
Priority: High
Type: Integration
Expected: "Tracking: HH:MM" and "Project: [name]" labels

TC-092: Authenticated tray shows "Not tracking" when stopped
Priority: Medium
Type: Integration
Expected: "Not tracking" label displayed

TC-093: Stop Timer menu item calls stopTimer
Priority: High
Type: IPC/Integration
Expected: stopTimer() called

TC-094: Start Timer submenu lists all projects
Priority: High
Type: Integration
Expected: One menu item per project + "No Project"

TC-095: Sign Out menu item calls performLogout
Priority: High
Type: Integration
Expected: performLogout() called

TC-096: Quit menu item calls app.quit
Priority: Medium
Type: Integration
Expected: app.quit() called
```

### 3.7 Preload Script Tests

```
TC-100: contextBridge.exposeInMainWorld called with 'trackflow'
Priority: Critical
Type: Unit
Expected: All API methods registered under 'trackflow' namespace

TC-101: Each invoke method maps to correct IPC channel
Priority: Critical
Type: Unit
Expected: ipcRenderer.invoke called with matching channel name

TC-102: Event listeners replace previous listener (no leaks)
Priority: High
Type: Unit
Expected: removeListener called for previous handler on same channel

TC-103: safeOn prevents listener accumulation
Priority: High
Type: Unit
Expected: Only one listener active per channel at any time
```

---

## 4. Test Categories Summary

| Category | Test Count | Priority Distribution |
|---|---|---|
| Login Screen | TC-001 to TC-015 (15) | 3 Critical, 7 High, 4 Medium, 1 Low |
| Org Selector | TC-020 to TC-025 (6) | 2 Critical, 2 High, 1 Medium, 1 Low |
| Main Timer | TC-030 to TC-054 (25) | 5 Critical, 8 High, 9 Medium, 3 Low |
| Update Dialog | TC-060 to TC-063 (4) | 0 Critical, 2 High, 2 Medium |
| Idle Alert | TC-070 to TC-083 (14) | 3 Critical, 3 High, 6 Medium, 2 Low |
| System Tray | TC-090 to TC-096 (7) | 1 Critical, 4 High, 2 Medium |
| Preload/IPC | TC-100 to TC-103 (4) | 2 Critical, 2 High |
| **Total** | **75 test cases** | **16 Critical, 26 High, 24 Medium, 7 Low** |

---

## 5. Test Infrastructure

### 5.1 Test Runner
- Jest 29 with Node test environment
- Existing mocks in `test/__mocks__/` (electron, better-sqlite3, sharp, etc.)

### 5.2 Test Scripts
```json
{
  "test:e2e": "jest test/e2e/ --testEnvironment=node",
  "dev:inspect": "NODE_ENV=development electron . --remote-debugging-port=9222"
}
```

### 5.3 Mock Strategy
- Electron APIs: Use existing `test/__mocks__/electron.js`
- IPC communication: Mock `ipcRenderer.invoke` / `ipcRenderer.on` per test
- API calls: Not tested (mocked at IPC boundary)
- DOM: Use JSDOM-like simulation for renderer logic tests
- File system: Mock via Jest

### 5.4 Coverage Targets
| Area | Target |
|---|---|
| IPC handlers | 100% of channels covered |
| Preload API | 100% of exposed methods |
| Idle alert logic | 100% of actions and keyboard shortcuts |
| Timer display logic | 100% of state transitions |
| Tray menu | All menu configurations |

---

## 6. Known Limitations

1. **No true E2E with running Electron** -- Tests mock Electron APIs rather than launching a real app window. The `dev:inspect` script enables Chrome DevTools MCP connection for manual live testing.
2. **Renderer DOM tests** -- The renderer uses plain HTML/JS with inline scripts, which makes isolated DOM testing challenging. Tests focus on the IPC contract and logic rather than pixel-perfect UI.
3. **macOS-specific features** -- Screen recording permission tests use mocks; actual permission flow requires manual testing on macOS.
