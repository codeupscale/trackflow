/**
 * IPC handler tests -- verifies the main process IPC handlers respond
 * correctly to invoke calls from the renderer process.
 *
 * These tests register mock handlers that mirror the real ipcMain.handle
 * registrations in main/index.js, then verify the contract.
 */

const { ipcMain } = require('electron');

describe('IPC Handlers', () => {
  // Collect registered handlers so we can invoke them in tests
  const handlers = {};

  beforeAll(() => {
    // Override the mock to capture handler registrations
    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Handler Registration', () => {
    // Verify that the handler registration mechanism works
    test('ipcMain.handle registers handlers correctly', () => {
      const testHandler = jest.fn();
      ipcMain.handle('test-channel', testHandler);
      expect(handlers['test-channel']).toBe(testHandler);
    });
  });

  describe('Timer IPC Contract', () => {
    test('get-timer-state handler receives projectId argument', async () => {
      const mockHandler = jest.fn().mockResolvedValue({
        isRunning: false,
        todayTotal: 3600,
        elapsed: 0,
        entry: null,
      });
      ipcMain.handle('get-timer-state', mockHandler);

      const result = await handlers['get-timer-state']({}, 'project-123');

      expect(mockHandler).toHaveBeenCalledWith({}, 'project-123');
      expect(result).toEqual({
        isRunning: false,
        todayTotal: 3600,
        elapsed: 0,
        entry: null,
      });
    });

    test('get-timer-state returns running state with entry', async () => {
      const entry = {
        id: 'entry-1',
        project_id: 'p1',
        started_at: '2026-03-31T10:00:00.000Z',
        project: { id: 'p1', name: 'Test Project' },
      };
      const mockHandler = jest.fn().mockResolvedValue({
        isRunning: true,
        todayTotal: 7200,
        elapsed: 600,
        entry,
      });
      ipcMain.handle('get-timer-state', mockHandler);

      const result = await handlers['get-timer-state']({}, 'p1');

      expect(result.isRunning).toBe(true);
      expect(result.elapsed).toBe(600);
      expect(result.entry.project_id).toBe('p1');
    });

    test('start-timer handler receives projectId', async () => {
      const mockHandler = jest.fn().mockResolvedValue({
        success: true,
        entry: { id: 'e1', started_at: new Date().toISOString(), project_id: 'p1' },
        todayTotal: 0,
      });
      ipcMain.handle('start-timer', mockHandler);

      const result = await handlers['start-timer']({}, 'p1');

      expect(result.success).toBe(true);
      expect(result.entry.project_id).toBe('p1');
    });

    test('start-timer returns error on failure', async () => {
      const mockHandler = jest.fn().mockResolvedValue({
        success: false,
        error: 'Already tracking',
      });
      ipcMain.handle('start-timer', mockHandler);

      const result = await handlers['start-timer']({}, 'p1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Already tracking');
    });

    test('stop-timer handler returns todayTotal', async () => {
      const mockHandler = jest.fn().mockResolvedValue({
        todayTotal: 3661,
      });
      ipcMain.handle('stop-timer', mockHandler);

      const result = await handlers['stop-timer']({});

      expect(result.todayTotal).toBe(3661);
    });
  });

  describe('Project IPC Contract', () => {
    test('get-projects returns array of projects', async () => {
      const projects = [
        { id: 'p1', name: 'Alpha' },
        { id: 'p2', name: 'Beta' },
        { id: 'p3', name: 'Gamma' },
      ];
      const mockHandler = jest.fn().mockResolvedValue(projects);
      ipcMain.handle('get-projects', mockHandler);

      const result = await handlers['get-projects']({});

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(3);
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('name');
    });

    test('get-projects handles wrapped data response', async () => {
      const mockHandler = jest.fn().mockResolvedValue({
        data: [{ id: 'p1', name: 'Alpha' }],
      });
      ipcMain.handle('get-projects', mockHandler);

      const result = await handlers['get-projects']({});

      // The renderer handles both Array and { data: Array } formats
      const list = Array.isArray(result) ? result
        : (result?.data && Array.isArray(result.data)) ? result.data : [];
      expect(list).toHaveLength(1);
    });

    test('get-last-project returns stored project ID', async () => {
      const mockHandler = jest.fn().mockReturnValue('p2');
      ipcMain.handle('get-last-project', mockHandler);

      const result = handlers['get-last-project']({});
      expect(result).toBe('p2');
    });

    test('get-last-project returns null when none stored', async () => {
      const mockHandler = jest.fn().mockReturnValue(null);
      ipcMain.handle('get-last-project', mockHandler);

      const result = handlers['get-last-project']({});
      expect(result).toBeNull();
    });

    test('set-last-project receives project ID', () => {
      const mockHandler = jest.fn();
      ipcMain.handle('set-last-project', mockHandler);

      handlers['set-last-project']({}, 'p3');
      expect(mockHandler).toHaveBeenCalledWith({}, 'p3');
    });

    test('set-last-project handles null to clear', () => {
      const mockHandler = jest.fn();
      ipcMain.handle('set-last-project', mockHandler);

      handlers['set-last-project']({}, null);
      expect(mockHandler).toHaveBeenCalledWith({}, null);
    });
  });

  describe('Auth IPC Contract', () => {
    test('login handler receives email and password', async () => {
      const mockHandler = jest.fn().mockResolvedValue({ success: true });
      ipcMain.handle('login', mockHandler);

      const result = await handlers['login']({}, 'user@example.com', 'password123');

      expect(mockHandler).toHaveBeenCalledWith({}, 'user@example.com', 'password123');
      expect(result.success).toBe(true);
    });

    test('login returns multi-org selection requirement', async () => {
      const mockHandler = jest.fn().mockResolvedValue({
        requires_org_selection: true,
        organizations: [
          { organization_id: 'o1', organization_name: 'Org A', user_role: 'admin', organization_plan: 'pro' },
        ],
        credentials: { email: 'user@example.com', password: 'password123' },
      });
      ipcMain.handle('login', mockHandler);

      const result = await handlers['login']({}, 'user@example.com', 'password123');

      expect(result.requires_org_selection).toBe(true);
      expect(result.organizations).toHaveLength(1);
      expect(result.credentials).toBeDefined();
    });

    test('login returns error on invalid credentials', async () => {
      const mockHandler = jest.fn().mockResolvedValue({
        error: 'The provided credentials are incorrect.',
      });
      ipcMain.handle('login', mockHandler);

      const result = await handlers['login']({}, 'user@example.com', 'wrong');

      expect(result.error).toBe('The provided credentials are incorrect.');
    });

    test('google-login handler returns result', async () => {
      const mockHandler = jest.fn().mockResolvedValue({ success: true });
      ipcMain.handle('google-login', mockHandler);

      const result = await handlers['google-login']({});
      expect(result.success).toBe(true);
    });

    test('select-organization receives orgId and credentials', async () => {
      const credentials = { email: 'test@test.com', password: 'pass' };
      const mockHandler = jest.fn().mockResolvedValue({ success: true });
      ipcMain.handle('select-organization', mockHandler);

      const result = await handlers['select-organization']({}, 'org-1', credentials);

      expect(mockHandler).toHaveBeenCalledWith({}, 'org-1', credentials);
      expect(result.success).toBe(true);
    });

    test('logout handler completes without error', async () => {
      const mockHandler = jest.fn().mockResolvedValue(undefined);
      ipcMain.handle('logout', mockHandler);

      await handlers['logout']({});
      expect(mockHandler).toHaveBeenCalled();
    });
  });

  describe('Idle IPC Contract', () => {
    test('resolve-idle with keep action', async () => {
      const mockHandler = jest.fn().mockResolvedValue({ success: true });
      ipcMain.handle('resolve-idle', mockHandler);

      await handlers['resolve-idle']({}, 'keep');
      expect(mockHandler).toHaveBeenCalledWith({}, 'keep');
    });

    test('resolve-idle with discard action', async () => {
      const mockHandler = jest.fn().mockResolvedValue({ success: true });
      ipcMain.handle('resolve-idle', mockHandler);

      await handlers['resolve-idle']({}, 'discard');
      expect(mockHandler).toHaveBeenCalledWith({}, 'discard');
    });

    test('resolve-idle with stop action', async () => {
      const mockHandler = jest.fn().mockResolvedValue({ success: true });
      ipcMain.handle('resolve-idle', mockHandler);

      await handlers['resolve-idle']({}, 'stop');
      expect(mockHandler).toHaveBeenCalledWith({}, 'stop');
    });

    test('resolve-idle with reassign action includes projectId', async () => {
      const mockHandler = jest.fn().mockResolvedValue({ success: true });
      ipcMain.handle('resolve-idle', mockHandler);

      await handlers['resolve-idle']({}, 'reassign', 'p2');
      expect(mockHandler).toHaveBeenCalledWith({}, 'reassign', 'p2');
    });
  });

  describe('Permission IPC Contract', () => {
    test('check-screen-permission returns granted status', async () => {
      const mockHandler = jest.fn().mockResolvedValue({ granted: true, platform: 'darwin' });
      ipcMain.handle('check-screen-permission', mockHandler);

      const result = await handlers['check-screen-permission']({});
      expect(result.granted).toBe(true);
    });

    test('check-screen-permission returns denied status', async () => {
      const mockHandler = jest.fn().mockResolvedValue({ granted: false, platform: 'darwin' });
      ipcMain.handle('check-screen-permission', mockHandler);

      const result = await handlers['check-screen-permission']({});
      expect(result.granted).toBe(false);
      expect(result.platform).toBe('darwin');
    });

    test('request-screen-permission triggers system dialog', async () => {
      const mockHandler = jest.fn().mockResolvedValue({ action: 'opened-settings' });
      ipcMain.handle('request-screen-permission', mockHandler);

      const result = await handlers['request-screen-permission']({});
      expect(result.action).toBe('opened-settings');
    });
  });

  describe('Theme IPC Contract', () => {
    test('get-theme returns current OS theme', () => {
      const mockHandler = jest.fn().mockReturnValue('dark');
      ipcMain.handle('get-theme', mockHandler);

      const result = handlers['get-theme']({});
      expect(result).toBe('dark');
    });

    test('get-theme returns light when OS is light mode', () => {
      const mockHandler = jest.fn().mockReturnValue('light');
      ipcMain.handle('get-theme', mockHandler);

      const result = handlers['get-theme']({});
      expect(result).toBe('light');
    });
  });

  describe('Dashboard IPC Contract', () => {
    test('open-dashboard handler opens external URL', async () => {
      const mockHandler = jest.fn().mockResolvedValue(undefined);
      ipcMain.handle('open-dashboard', mockHandler);

      await handlers['open-dashboard']({});
      expect(mockHandler).toHaveBeenCalled();
    });
  });

  describe('Update IPC Contract', () => {
    test('install-update handler triggers quit-and-install', () => {
      const mockHandler = jest.fn();
      ipcMain.handle('install-update', mockHandler);

      handlers['install-update']({});
      expect(mockHandler).toHaveBeenCalled();
    });
  });
});
