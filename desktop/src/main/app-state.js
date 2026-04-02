// AppState — single source of truth for all shared mutable state (H3 fix)
// All mutations go through AppState.field = value, making state transitions auditable.

const AppState = {
  tray: null,
  popupWindow: null,
  loginWindow: null,
  idleAlertWindow: null,
  apiClient: null,
  activityMonitor: null,
  screenshotService: null,
  idleDetector: null,
  offlineQueue: null,
  isTimerRunning: false,
  currentEntry: null,
  todayTotalGlobal: 0,
  todayTotalCurrentProject: 0,
  config: {},
  cachedProjects: [],
  isAuthenticated: false,
  timerSyncInterval: null,
  trayTimerInterval: null,
  isQuitting: false,
  loginHandlerRegistered: false,
  isAlwaysOnTop: true,
  _cachedStartedAtMs: null,
  _forceLogoutInProgress: false,
  _suspendedAt: null,
  _configRefetchCycle: 0,
  _pinKeepalive: null,
  _screenPermissionDeclinedThisSession: false,
  _screenPermissionGranted: null,
  isSyncing: false,         // M6: guard against concurrent sync cycles
  isLoggingOut: false,       // M7: guard against stale closures after logout
  clockOffsetMs: 0,          // M8: server - local clock skew compensation
  currentUser: null,         // L8: for PostHog real userId
};

module.exports = AppState;
