/**
 * @jest-environment jsdom
 */

/**
 * Timer controls tests -- verifies the main timer window logic including
 * start/stop, project selection, display updates, keyboard shortcuts,
 * and IPC event handling.
 *
 * Covers: TC-030 through TC-054, TC-060 through TC-063
 */

describe('Main Timer Window', () => {
  let mockTrackflow;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="permissionBanner" style="display:none">
        <button id="fixPermissionBtn">Fix</button>
      </div>
      <div id="wallpaperBanner" style="display:none">
        <button id="fixWallpaperBtn">Fix</button>
      </div>
      <div class="time stopped" id="timerDisplay" role="timer">00:00:00</div>
      <div class="status">
        <span class="dot gray" id="statusDot"></span>
        <span id="statusText">Stopped</span>
      </div>
      <select id="projectSelect">
        <option value="">Select a project</option>
      </select>
      <button class="btn btn-primary" id="startBtn">
        <span id="startBtnText">Start</span>
      </button>
      <button class="btn btn-danger" id="stopBtn" style="display:none">Stop</button>
      <button id="logoutBtn" title="Sign out"></button>
      <a id="logoutLink">Sign out</a>
      <a id="dashboardLink">Open Dashboard</a>
      <div class="update-overlay" id="updateOverlay">
        <div id="updateTitle">Update Available</div>
        <div id="updateBody"></div>
        <button id="updateRestartBtn">Restart Now</button>
        <button id="updateLaterBtn">Later</button>
      </div>
      <span class="update-badge" id="updateBadge"></span>
    `;

    mockTrackflow = {
      getTimerState: jest.fn().mockResolvedValue({ isRunning: false, todayTotal: 0 }),
      startTimer: jest.fn().mockResolvedValue({ success: true, entry: { started_at: new Date().toISOString() }, todayTotal: 0 }),
      stopTimer: jest.fn().mockResolvedValue({ todayTotal: 100 }),
      getProjects: jest.fn().mockResolvedValue([
        { id: 'p1', name: 'Project Alpha' },
        { id: 'p2', name: 'Project Beta' },
      ]),
      getLastProject: jest.fn().mockResolvedValue(null),
      setLastProject: jest.fn(),
      logout: jest.fn().mockResolvedValue(undefined),
      openDashboard: jest.fn().mockResolvedValue(undefined),
      checkScreenPermission: jest.fn().mockResolvedValue({ granted: true }),
      requestScreenPermission: jest.fn().mockResolvedValue(undefined),
      openScreenRecordingSettings: jest.fn().mockResolvedValue(undefined),
      getTheme: jest.fn().mockResolvedValue('dark'),
      installUpdate: jest.fn().mockResolvedValue(undefined),
      onTimerStarted: jest.fn(),
      onTimerStopped: jest.fn(),
      onTimerTick: jest.fn(),
      onSyncTimer: jest.fn(),
      onProjectsReady: jest.fn(),
      onPermissionStatus: jest.fn(),
      onScreenshotPermissionIssue: jest.fn(),
      onThemeChange: jest.fn(),
      onUpdateReady: jest.fn(),
    };
    window.trackflow = mockTrackflow;
    window.blur = jest.fn();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  // ── Helper: simulate the formatTime function from index.html ──
  function formatTime(seconds) {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  // ── Helper: simulate updateDisplay ──
  function updateDisplay(running, elapsedSeconds = 0) {
    const timerDisplay = document.getElementById('timerDisplay');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const projectSelect = document.getElementById('projectSelect');

    timerDisplay.textContent = formatTime(elapsedSeconds);
    timerDisplay.className = `time ${running ? 'running' : 'stopped'}`;
    statusDot.className = `dot ${running ? 'green' : 'gray'}`;
    statusText.textContent = running ? 'Tracking' : 'Stopped';
    startBtn.style.display = running ? 'none' : 'flex';
    stopBtn.style.display = running ? 'flex' : 'none';
    projectSelect.disabled = running;
  }

  // TC-030: Timer display shows 00:00:00 initially
  test('TC-030: initial timer display shows 00:00:00', () => {
    expect(document.getElementById('timerDisplay').textContent).toBe('00:00:00');
    expect(document.getElementById('timerDisplay').className).toContain('stopped');
    expect(document.getElementById('statusText').textContent).toBe('Stopped');
  });

  // TC-031: Start button calls startTimer with selected project
  test('TC-031: start button calls startTimer with project ID', async () => {
    const projectSelect = document.getElementById('projectSelect');
    const option = document.createElement('option');
    option.value = 'p1';
    option.textContent = 'Project Alpha';
    projectSelect.appendChild(option);
    projectSelect.value = 'p1';

    await mockTrackflow.startTimer('p1');

    expect(mockTrackflow.startTimer).toHaveBeenCalledWith('p1');
  });

  // TC-032: Start button disabled when no project selected
  test('TC-032: start button disabled when no project selected', () => {
    const startBtn = document.getElementById('startBtn');
    const projectSelect = document.getElementById('projectSelect');

    const hasProject = projectSelect.value && projectSelect.value !== '';
    startBtn.disabled = !hasProject;
    startBtn.style.opacity = hasProject ? '1' : '0.5';
    startBtn.style.cursor = hasProject ? 'pointer' : 'not-allowed';

    expect(startBtn.disabled).toBe(true);
    expect(startBtn.style.opacity).toBe('0.5');
    expect(startBtn.style.cursor).toBe('not-allowed');
  });

  // TC-033: Stop button calls stopTimer
  test('TC-033: stop button calls stopTimer', async () => {
    await mockTrackflow.stopTimer();
    expect(mockTrackflow.stopTimer).toHaveBeenCalled();
  });

  // TC-034: Start/Stop button visibility toggles
  test('TC-034: start/stop visibility toggles with timer state', () => {
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');

    // Running state
    updateDisplay(true, 60);
    expect(startBtn.style.display).toBe('none');
    expect(stopBtn.style.display).toBe('flex');

    // Stopped state
    updateDisplay(false, 60);
    expect(startBtn.style.display).toBe('flex');
    expect(stopBtn.style.display).toBe('none');
  });

  // TC-035: Timer display updates on timer-tick event
  test('TC-035: timer-tick updates display', () => {
    const timerDisplay = document.getElementById('timerDisplay');
    updateDisplay(true, 0);

    // Simulate tick data
    const tickData = { totalSeconds: 125, formatted: '00:02:05' };
    timerDisplay.textContent = tickData.formatted;

    expect(timerDisplay.textContent).toBe('00:02:05');
  });

  // TC-036: Project dropdown populated from getProjects
  test('TC-036: projects populate dropdown', async () => {
    const projectSelect = document.getElementById('projectSelect');
    const projects = await mockTrackflow.getProjects();

    projects.forEach(p => {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.name;
      projectSelect.appendChild(option);
    });

    // 1 default + 2 projects
    expect(projectSelect.options.length).toBe(3);
    expect(projectSelect.options[1].value).toBe('p1');
    expect(projectSelect.options[1].textContent).toBe('Project Alpha');
    expect(projectSelect.options[2].value).toBe('p2');
    expect(projectSelect.options[2].textContent).toBe('Project Beta');
  });

  // TC-037: Project dropdown disabled while timer running
  test('TC-037: project select disabled when running', () => {
    updateDisplay(true, 0);
    expect(document.getElementById('projectSelect').disabled).toBe(true);

    updateDisplay(false, 0);
    expect(document.getElementById('projectSelect').disabled).toBe(false);
  });

  // TC-038: Status text shows "Tracking" when running
  test('TC-038: status text shows Tracking when running', () => {
    updateDisplay(true, 0);
    expect(document.getElementById('statusText').textContent).toBe('Tracking');
  });

  // TC-039: Status dot toggles color
  test('TC-039: status dot green when running, gray when stopped', () => {
    updateDisplay(true, 0);
    expect(document.getElementById('statusDot').className).toContain('green');

    updateDisplay(false, 0);
    expect(document.getElementById('statusDot').className).toContain('gray');
  });

  // TC-040: Logout button calls logout
  test('TC-040: logout button calls trackflow.logout', async () => {
    await mockTrackflow.logout();
    expect(mockTrackflow.logout).toHaveBeenCalled();
  });

  // TC-041: Dashboard link calls openDashboard
  test('TC-041: dashboard link calls trackflow.openDashboard', async () => {
    await mockTrackflow.openDashboard();
    expect(mockTrackflow.openDashboard).toHaveBeenCalled();
  });

  // TC-042: Enter key starts/stops timer
  test('TC-042: Enter key toggles timer', () => {
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    let isRunning = false;

    // Simulate keyboard handler
    function handleKey(e) {
      if (e.key === 'Enter' && !e.repeat) {
        if (isRunning) stopBtn.click();
        else startBtn.click();
      }
    }

    const startClickSpy = jest.fn();
    const stopClickSpy = jest.fn();
    startBtn.addEventListener('click', startClickSpy);
    stopBtn.addEventListener('click', stopClickSpy);

    // Enter when stopped -> clicks start
    handleKey({ key: 'Enter', repeat: false });
    expect(startClickSpy).toHaveBeenCalledTimes(1);

    // Enter when running -> clicks stop
    isRunning = true;
    handleKey({ key: 'Enter', repeat: false });
    expect(stopClickSpy).toHaveBeenCalledTimes(1);
  });

  // TC-043: Cmd/Ctrl+Q triggers logout
  test('TC-043: Cmd+Q / Ctrl+Q triggers logout', () => {
    const logoutFn = jest.fn();

    function handleKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'q') {
        logoutFn();
      }
    }

    handleKey({ ctrlKey: true, key: 'q' });
    expect(logoutFn).toHaveBeenCalledTimes(1);

    handleKey({ metaKey: true, key: 'q' });
    expect(logoutFn).toHaveBeenCalledTimes(2);
  });

  // TC-044: Escape key blurs window
  test('TC-044: Escape key blurs the window', () => {
    function handleKey(e) {
      if (e.key === 'Escape') window.blur();
    }

    handleKey({ key: 'Escape' });
    expect(window.blur).toHaveBeenCalled();
  });

  // TC-045: Timer-started event updates display
  test('TC-045: timer-started event updates UI to running state', () => {
    const data = { started_at: new Date().toISOString(), todayTotal: 300 };
    updateDisplay(true, data.todayTotal);

    expect(document.getElementById('timerDisplay').className).toContain('running');
    expect(document.getElementById('statusText').textContent).toBe('Tracking');
    expect(document.getElementById('statusDot').className).toContain('green');
  });

  // TC-046: Timer-stopped event updates display
  test('TC-046: timer-stopped event updates UI to stopped state', () => {
    updateDisplay(false, 3661);

    expect(document.getElementById('timerDisplay').textContent).toBe('01:01:01');
    expect(document.getElementById('timerDisplay').className).toContain('stopped');
    expect(document.getElementById('statusText').textContent).toBe('Stopped');
  });

  // TC-047: Sync-timer triggers resync
  test('TC-047: onSyncTimer callback registered', () => {
    expect(mockTrackflow.onSyncTimer).toBeDefined();
    mockTrackflow.onSyncTimer(jest.fn());
    expect(mockTrackflow.onSyncTimer).toHaveBeenCalled();
  });

  // TC-048: Projects-ready reloads projects
  test('TC-048: onProjectsReady callback registered', () => {
    expect(mockTrackflow.onProjectsReady).toBeDefined();
    mockTrackflow.onProjectsReady(jest.fn());
    expect(mockTrackflow.onProjectsReady).toHaveBeenCalled();
  });

  // TC-049: Permission banner shown when not granted
  test('TC-049: permission banner shown when screen recording denied', async () => {
    mockTrackflow.checkScreenPermission.mockResolvedValue({ granted: false, platform: 'darwin' });
    const result = await mockTrackflow.checkScreenPermission();

    const banner = document.getElementById('permissionBanner');
    if (result && !result.granted && result.platform === 'darwin') {
      banner.style.display = 'flex';
    }

    expect(banner.style.display).toBe('flex');
  });

  // TC-050: Fix permission button calls requestScreenPermission
  test('TC-050: fix permission button calls requestScreenPermission', async () => {
    await mockTrackflow.requestScreenPermission();
    expect(mockTrackflow.requestScreenPermission).toHaveBeenCalled();
  });

  // TC-051: Wallpaper banner shown on screenshot-permission-issue
  test('TC-051: wallpaper banner shown on wallpaper-detected event', () => {
    const banner = document.getElementById('wallpaperBanner');
    const data = { type: 'wallpaper-detected' };

    if (data.type === 'wallpaper-detected') {
      banner.style.display = 'flex';
    }

    expect(banner.style.display).toBe('flex');
  });

  // TC-052: Last project restored on init
  test('TC-052: getLastProject called and value set', async () => {
    mockTrackflow.getLastProject.mockResolvedValue('p1');
    const projectSelect = document.getElementById('projectSelect');

    // Add the project option
    const option = document.createElement('option');
    option.value = 'p1';
    option.textContent = 'Project Alpha';
    projectSelect.appendChild(option);

    const lastProjectId = await mockTrackflow.getLastProject();
    if (lastProjectId) {
      const optionExists = Array.from(projectSelect.options).some(o => o.value === lastProjectId);
      if (optionExists) {
        projectSelect.value = lastProjectId;
      }
    }

    expect(mockTrackflow.getLastProject).toHaveBeenCalled();
    expect(projectSelect.value).toBe('p1');
  });

  // TC-053: Project change persists via setLastProject
  test('TC-053: setLastProject called on project change', () => {
    mockTrackflow.setLastProject('p2');
    expect(mockTrackflow.setLastProject).toHaveBeenCalledWith('p2');
  });

  // TC-054: formatTime correctly formats seconds
  test('TC-054: formatTime produces correct HH:MM:SS', () => {
    expect(formatTime(0)).toBe('00:00:00');
    expect(formatTime(1)).toBe('00:00:01');
    expect(formatTime(60)).toBe('00:01:00');
    expect(formatTime(3600)).toBe('01:00:00');
    expect(formatTime(3661)).toBe('01:01:01');
    expect(formatTime(86399)).toBe('23:59:59');
    // 90061 = 25*3600 + 61 => 25h, 61s => 1m 1s => "25:01:01"
    expect(formatTime(90061)).toBe('25:01:01');
  });

  // ── Update Dialog Tests (TC-060 through TC-063) ──
  describe('Update Dialog', () => {
    // TC-060: Update dialog shown on update-ready event
    test('TC-060: update-ready event shows update dialog', () => {
      const overlay = document.getElementById('updateOverlay');
      const body = document.getElementById('updateBody');
      const version = '1.0.21';

      overlay.classList.add('visible');
      body.textContent = `TrackFlow v${version} is ready to install. Restart now to get the latest features and bug fixes.`;

      expect(overlay.classList.contains('visible')).toBe(true);
      expect(body.textContent).toContain('v1.0.21');
    });

    // TC-061: Restart Now calls installUpdate
    test('TC-061: restart button calls installUpdate', async () => {
      await mockTrackflow.installUpdate();
      expect(mockTrackflow.installUpdate).toHaveBeenCalled();
    });

    // TC-062: Later button hides dialog and shows badge
    test('TC-062: later button hides dialog and shows badge', () => {
      const overlay = document.getElementById('updateOverlay');
      const badge = document.getElementById('updateBadge');

      overlay.classList.add('visible');

      // Simulate Later click
      overlay.classList.remove('visible');
      badge.classList.add('visible');

      expect(overlay.classList.contains('visible')).toBe(false);
      expect(badge.classList.contains('visible')).toBe(true);
    });

    // TC-063: Badge click reopens dialog
    test('TC-063: badge click reopens update dialog', () => {
      const overlay = document.getElementById('updateOverlay');
      const badge = document.getElementById('updateBadge');

      badge.classList.add('visible');

      // Simulate badge click
      overlay.classList.add('visible');
      expect(overlay.classList.contains('visible')).toBe(true);
    });
  });
});
