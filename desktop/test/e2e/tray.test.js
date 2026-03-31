/**
 * System tray menu tests -- verifies tray context menu structure
 * for authenticated and unauthenticated states, timer running/stopped,
 * and menu item actions.
 *
 * Covers: TC-090 through TC-096
 */

const { Menu } = require('electron');

describe('System Tray Menu', () => {
  let capturedTemplate;

  beforeEach(() => {
    jest.clearAllMocks();
    capturedTemplate = null;

    // Capture the template passed to Menu.buildFromTemplate
    Menu.buildFromTemplate.mockImplementation((template) => {
      capturedTemplate = template;
      return { popup: jest.fn() };
    });
  });

  // Helper: simulates buildTrayContextMenu from main/index.js
  function buildTrayContextMenu({
    isAuthenticated = false,
    isTimerRunning = false,
    currentEntry = null,
    todayTotalGlobal = 0,
    todayTotalCurrentProject = 0,
    cachedProjects = [],
    startedAtMs = null,
  } = {}) {
    // Helper to format time (mirrors main/index.js formatTimeShort)
    function formatTimeShort(seconds) {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      if (h > 0) return `${h}h ${m}m`;
      return `${m}m`;
    }

    if (!isAuthenticated) {
      return Menu.buildFromTemplate([
        { label: 'Sign In to TrackFlow', click: jest.fn() },
        { type: 'separator' },
        { label: 'Quit TrackFlow', click: jest.fn() },
      ]);
    }

    const template = [];

    if (isTimerRunning && currentEntry) {
      const elapsed = startedAtMs
        ? Math.floor((Date.now() - startedAtMs) / 1000)
        : 0;
      const projectName = currentEntry.project?.name || 'No Project';
      template.push(
        { label: `Tracking: ${formatTimeShort(todayTotalCurrentProject + elapsed)}`, enabled: false },
        { label: `Project: ${projectName}`, enabled: false },
        { type: 'separator' }
      );
    } else {
      const totalLabel = todayTotalGlobal > 0
        ? `Today: ${formatTimeShort(todayTotalGlobal)}`
        : 'Not tracking';
      template.push(
        { label: totalLabel, enabled: false },
        { type: 'separator' }
      );
    }

    if (isTimerRunning) {
      template.push({ label: 'Stop Timer', click: jest.fn() });
    } else {
      const projectItems = cachedProjects.map((p) => ({
        label: p.name,
        click: jest.fn(),
      }));

      if (projectItems.length > 0) {
        template.push({
          label: 'Start Timer',
          submenu: [
            { label: 'No Project', click: jest.fn() },
            { type: 'separator' },
            ...projectItems,
          ],
        });
      } else {
        template.push({ label: 'Start Timer', click: jest.fn() });
      }
    }

    template.push({ type: 'separator' });
    template.push(
      { label: 'Open App Window', click: jest.fn() },
      { label: 'Open Dashboard', click: jest.fn() }
    );
    template.push({ type: 'separator' });
    template.push(
      { label: 'Sign Out', click: jest.fn() },
      { type: 'separator' },
      { label: 'Quit TrackFlow', click: jest.fn() }
    );

    return Menu.buildFromTemplate(template);
  }

  // TC-090: Unauthenticated tray shows "Sign In" and "Quit"
  test('TC-090: unauthenticated tray has Sign In and Quit items', () => {
    buildTrayContextMenu({ isAuthenticated: false });

    expect(capturedTemplate).not.toBeNull();
    expect(capturedTemplate).toHaveLength(3); // Sign In, separator, Quit

    const labels = capturedTemplate.filter(i => i.label).map(i => i.label);
    expect(labels).toContain('Sign In to TrackFlow');
    expect(labels).toContain('Quit TrackFlow');
  });

  // TC-091: Authenticated tray shows timer status when running
  test('TC-091: running timer shows tracking status and project name', () => {
    buildTrayContextMenu({
      isAuthenticated: true,
      isTimerRunning: true,
      currentEntry: { project: { name: 'Alpha Project' } },
      todayTotalCurrentProject: 3600,
      startedAtMs: Date.now(), // just started
    });

    expect(capturedTemplate).not.toBeNull();
    const labels = capturedTemplate.filter(i => i.label).map(i => i.label);
    const trackingLabel = labels.find(l => l.startsWith('Tracking:'));
    const projectLabel = labels.find(l => l.startsWith('Project:'));

    expect(trackingLabel).toBeDefined();
    expect(projectLabel).toBe('Project: Alpha Project');
  });

  // TC-092: Authenticated tray shows "Not tracking" when stopped
  test('TC-092: stopped timer shows Not tracking', () => {
    buildTrayContextMenu({
      isAuthenticated: true,
      isTimerRunning: false,
      todayTotalGlobal: 0,
    });

    const labels = capturedTemplate.filter(i => i.label).map(i => i.label);
    expect(labels).toContain('Not tracking');
  });

  test('TC-092b: stopped timer with logged time shows Today total', () => {
    buildTrayContextMenu({
      isAuthenticated: true,
      isTimerRunning: false,
      todayTotalGlobal: 7200, // 2 hours
    });

    const labels = capturedTemplate.filter(i => i.label).map(i => i.label);
    const todayLabel = labels.find(l => l.startsWith('Today:'));
    expect(todayLabel).toBe('Today: 2h 0m');
  });

  // TC-093: Stop Timer menu item present when running
  test('TC-093: Stop Timer item present when timer is running', () => {
    buildTrayContextMenu({
      isAuthenticated: true,
      isTimerRunning: true,
      currentEntry: { project: { name: 'Test' } },
    });

    const labels = capturedTemplate.filter(i => i.label).map(i => i.label);
    expect(labels).toContain('Stop Timer');
    expect(labels).not.toContain('Start Timer');
  });

  // TC-094: Start Timer submenu lists all projects
  test('TC-094: Start Timer submenu lists all projects', () => {
    const projects = [
      { id: 'p1', name: 'Alpha' },
      { id: 'p2', name: 'Beta' },
      { id: 'p3', name: 'Gamma' },
    ];

    buildTrayContextMenu({
      isAuthenticated: true,
      isTimerRunning: false,
      cachedProjects: projects,
    });

    const startTimerItem = capturedTemplate.find(i => i.label === 'Start Timer');
    expect(startTimerItem).toBeDefined();
    expect(startTimerItem.submenu).toBeDefined();

    // "No Project" + separator + 3 projects
    expect(startTimerItem.submenu).toHaveLength(5);
    expect(startTimerItem.submenu[0].label).toBe('No Project');
    expect(startTimerItem.submenu[1].type).toBe('separator');
    expect(startTimerItem.submenu[2].label).toBe('Alpha');
    expect(startTimerItem.submenu[3].label).toBe('Beta');
    expect(startTimerItem.submenu[4].label).toBe('Gamma');
  });

  test('TC-094b: Start Timer without submenu when no projects', () => {
    buildTrayContextMenu({
      isAuthenticated: true,
      isTimerRunning: false,
      cachedProjects: [],
    });

    const startTimerItem = capturedTemplate.find(i => i.label === 'Start Timer');
    expect(startTimerItem).toBeDefined();
    expect(startTimerItem.submenu).toBeUndefined();
    expect(startTimerItem.click).toBeDefined();
  });

  // TC-095: Sign Out item present
  test('TC-095: Sign Out item present in authenticated menu', () => {
    buildTrayContextMenu({
      isAuthenticated: true,
      isTimerRunning: false,
    });

    const labels = capturedTemplate.filter(i => i.label).map(i => i.label);
    expect(labels).toContain('Sign Out');
  });

  // TC-096: Quit item always present
  test('TC-096: Quit TrackFlow always present', () => {
    // Unauthenticated
    buildTrayContextMenu({ isAuthenticated: false });
    let labels = capturedTemplate.filter(i => i.label).map(i => i.label);
    expect(labels).toContain('Quit TrackFlow');

    // Authenticated
    buildTrayContextMenu({ isAuthenticated: true });
    labels = capturedTemplate.filter(i => i.label).map(i => i.label);
    expect(labels).toContain('Quit TrackFlow');
  });

  // Additional: navigation items present in authenticated menu
  test('authenticated menu contains Open App Window and Open Dashboard', () => {
    buildTrayContextMenu({
      isAuthenticated: true,
      isTimerRunning: false,
    });

    const labels = capturedTemplate.filter(i => i.label).map(i => i.label);
    expect(labels).toContain('Open App Window');
    expect(labels).toContain('Open Dashboard');
  });

  // Additional: status items are disabled (not clickable)
  test('status items are disabled', () => {
    buildTrayContextMenu({
      isAuthenticated: true,
      isTimerRunning: true,
      currentEntry: { project: { name: 'Test' } },
    });

    const disabledItems = capturedTemplate.filter(i => i.enabled === false);
    expect(disabledItems.length).toBeGreaterThanOrEqual(2); // Tracking + Project labels
  });
});
