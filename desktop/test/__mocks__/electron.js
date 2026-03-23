// Mock Electron APIs for unit testing
const app = {
  getPath: jest.fn(() => '/tmp/trackflow-test'),
  quit: jest.fn(),
  exit: jest.fn(),
  isPackaged: false,
  requestSingleInstanceLock: jest.fn(() => true),
  setLoginItemSettings: jest.fn(),
  on: jest.fn(),
  dock: { hide: jest.fn(), show: jest.fn() },
};

const BrowserWindow = jest.fn().mockImplementation(() => ({
  loadFile: jest.fn(),
  show: jest.fn(),
  hide: jest.fn(),
  focus: jest.fn(),
  destroy: jest.fn(),
  close: jest.fn(),
  isDestroyed: jest.fn(() => false),
  isVisible: jest.fn(() => true),
  moveTop: jest.fn(),
  setVisibleOnAllWorkspaces: jest.fn(),
  on: jest.fn(),
  once: jest.fn(),
  webContents: {
    send: jest.fn(),
  },
  getBounds: jest.fn(() => ({ x: 0, y: 0, width: 320, height: 400 })),
}));
BrowserWindow.getAllWindows = jest.fn(() => []);

const Tray = jest.fn().mockImplementation(() => ({
  setToolTip: jest.fn(),
  setTitle: jest.fn(),
  setContextMenu: jest.fn(),
  popUpContextMenu: jest.fn(),
  getBounds: jest.fn(() => ({ x: 100, y: 0, width: 20, height: 20 })),
  on: jest.fn(),
}));

const Menu = {
  buildFromTemplate: jest.fn(() => ({})),
};

const nativeImage = {
  createFromPath: jest.fn(() => ({
    isEmpty: jest.fn(() => false),
  })),
  createFromBuffer: jest.fn(() => ({
    isEmpty: jest.fn(() => false),
  })),
};

const ipcMain = {
  handle: jest.fn(),
  removeHandler: jest.fn(),
  on: jest.fn(),
};

const ipcRenderer = {
  invoke: jest.fn(),
  on: jest.fn(),
  removeListener: jest.fn(),
};

const contextBridge = {
  exposeInMainWorld: jest.fn(),
};

const shell = {
  openExternal: jest.fn(),
};

const Notification = jest.fn().mockImplementation(() => ({
  show: jest.fn(),
  close: jest.fn(),
}));
Notification.isSupported = jest.fn(() => true);

const powerMonitor = {
  getSystemIdleTime: jest.fn(() => 0),
};

const desktopCapturer = {
  getSources: jest.fn(() => Promise.resolve([])),
};

const screen = {
  getDisplayNearestPoint: jest.fn(() => ({
    workArea: { x: 0, y: 0, width: 1920, height: 1080 },
  })),
  getPrimaryDisplay: jest.fn(() => ({
    size: { width: 1920, height: 1080 },
    scaleFactor: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    id: 1,
  })),
  getAllDisplays: jest.fn(() => ([{
    size: { width: 1920, height: 1080 },
    scaleFactor: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    id: 1,
  }])),
};

const safeStorage = {
  isEncryptionAvailable: jest.fn(() => true),
  // Mock encryption: just base64 encode/decode (simulates encrypt/decrypt round-trip)
  encryptString: jest.fn((str) => Buffer.from(str, 'utf8')),
  decryptString: jest.fn((buf) => buf.toString('utf8')),
};

const systemPreferences = {
  getMediaAccessStatus: jest.fn(() => 'granted'),
  isTrustedAccessibilityClient: jest.fn(() => true),
};

module.exports = {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  ipcRenderer,
  contextBridge,
  shell,
  Notification,
  powerMonitor,
  desktopCapturer,
  screen,
  safeStorage,
  systemPreferences,
};
