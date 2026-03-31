// Preload script — exposes safe API to renderer via contextBridge
const { contextBridge, ipcRenderer } = require('electron');

// Track listeners so we can remove old ones before adding new ones
// This prevents memory leaks when the popup window is shown/hidden repeatedly
const listenerCleanup = {};

function safeOn(channel, handler) {
  // Remove previous listener for this channel to prevent accumulation
  if (listenerCleanup[channel]) {
    ipcRenderer.removeListener(channel, listenerCleanup[channel]);
  }
  listenerCleanup[channel] = handler;
  ipcRenderer.on(channel, handler);
}

contextBridge.exposeInMainWorld('trackflow', {
  getTimerState: (projectId) => ipcRenderer.invoke('get-timer-state', projectId),
  startTimer: (projectId) => ipcRenderer.invoke('start-timer', projectId),
  stopTimer: () => ipcRenderer.invoke('stop-timer'),
  getProjects: () => ipcRenderer.invoke('get-projects'),
  getLastProject: () => ipcRenderer.invoke('get-last-project'),
  setLastProject: (projectId) => ipcRenderer.invoke('set-last-project', projectId),
  logout: () => ipcRenderer.invoke('logout'),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  login: (email, password) => ipcRenderer.invoke('login', email, password),
  googleLogin: () => ipcRenderer.invoke('google-login'),
  selectOrganization: (orgId, credentials) => ipcRenderer.invoke('select-organization', orgId, credentials),
  openDashboard: () => ipcRenderer.invoke('open-dashboard'),

  // Multi-org events from main process
  onOrgSelection: (callback) => safeOn('org-selection-required', (_, data) => callback(data)),
  onGoogleAuthError: (callback) => safeOn('google-auth-error', (_, data) => callback(data)),

  // Idle alert actions (action: 'keep'|'discard'|'stop'|'reassign'; projectId only for reassign)
  resolveIdle: (action, projectId) => ipcRenderer.invoke('resolve-idle', action, projectId),

  // Screen recording permission (macOS)
  checkScreenPermission: () => ipcRenderer.invoke('check-screen-permission'),
  requestScreenPermission: () => ipcRenderer.invoke('request-screen-permission'),
  openScreenRecordingSettings: () => ipcRenderer.invoke('open-screen-recording-settings'),
  onPermissionStatus: (callback) => safeOn('permission-status', (_, data) => callback(data)),
  onScreenshotPermissionIssue: (callback) => safeOn('screenshot-permission-issue', (_, data) => callback(data)),

  // OS theme detection
  getTheme: () => ipcRenderer.invoke('get-theme'),
  onThemeChange: (callback) => safeOn('theme-changed', (_, theme) => callback(theme)),

  // Events from main process — each call replaces the previous listener to prevent leaks
  onTimerStarted: (callback) => safeOn('timer-started', (_, data) => callback(data)),
  onTimerStopped: (callback) => safeOn('timer-stopped', (_, data) => callback(data)),
  onTimerTick: (callback) => safeOn('timer-tick', (_, data) => callback(data)),
  onSyncTimer: (callback) => safeOn('sync-timer', () => callback()),
  onProjectsReady: (callback) => safeOn('projects-ready', () => callback()),
  onIdleData: (callback) => safeOn('idle-data', (_, data) => callback(data)),

  // Auto-update
  onUpdateReady: (callback) => safeOn('update-ready', (_, data) => callback(data)),
  installUpdate: () => ipcRenderer.invoke('install-update'),
});
