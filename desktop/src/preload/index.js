// Preload script — exposes safe API to renderer via contextBridge
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('trackflow', {
  getTimerState: (projectId) => ipcRenderer.invoke('get-timer-state', projectId),
  startTimer: (projectId) => ipcRenderer.invoke('start-timer', projectId),
  stopTimer: () => ipcRenderer.invoke('stop-timer'),
  getProjects: () => ipcRenderer.invoke('get-projects'),
  logout: () => ipcRenderer.invoke('logout'),
  login: (email, password) => ipcRenderer.invoke('login', email, password),
  openDashboard: () => ipcRenderer.invoke('open-dashboard'),

  // Idle alert actions (action: 'keep'|'discard'|'stop'|'reassign'; projectId only for reassign)
  resolveIdle: (action, projectId) => ipcRenderer.invoke('resolve-idle', action, projectId),

  // Events from main process
  onTimerStarted: (callback) => ipcRenderer.on('timer-started', (_, data) => callback(data)),
  onTimerStopped: (callback) => ipcRenderer.on('timer-stopped', (_, data) => callback(data)),
  onSyncTimer: (callback) => ipcRenderer.on('sync-timer', () => callback()),
  onIdleData: (callback) => ipcRenderer.on('idle-data', (_, data) => callback(data)),
});
