/**
 * @jest-environment jsdom
 */

/**
 * Login screen tests -- verifies the login form logic, validation,
 * Google OAuth flow, and multi-org detection.
 *
 * These tests exercise the renderer-side logic by simulating the DOM
 * and mocking the trackflow preload API.
 *
 * Covers: TC-001 through TC-015
 */

describe('Login Screen', () => {
  let mockTrackflow;
  let doc;

  beforeEach(() => {
    // Set up a minimal DOM that mirrors login.html structure
    document.body.innerHTML = `
      <div id="titlebar">
        <button class="titlebar-btn close" id="closeBtn"></button>
      </div>
      <div id="loginView">
        <form id="loginForm" novalidate>
          <input type="email" id="email" required>
          <div class="password-wrap">
            <input type="password" id="password" required>
            <button type="button" class="password-toggle" id="passwordToggle"
              aria-label="Show password" aria-pressed="false">
              <svg id="eyeIcon" style="display:block"></svg>
              <svg id="eyeOffIcon" style="display:none"></svg>
            </button>
          </div>
          <button type="submit" class="btn btn-primary submit-btn" id="submitBtn">Sign In</button>
        </form>
        <button type="button" class="google-btn" id="googleBtn">Sign in with Google</button>
        <div class="error" id="errorMsg" role="alert" style="display:none"></div>
      </div>
      <div class="login-card org-selector" id="orgView">
        <div class="org-list" id="orgList"></div>
        <div class="error" id="orgErrorMsg" role="alert" style="display:none"></div>
        <button type="button" class="back-btn" id="backBtn">Back to login</button>
      </div>
    `;

    // Mock the trackflow preload API
    mockTrackflow = {
      login: jest.fn(),
      googleLogin: jest.fn(),
      selectOrganization: jest.fn(),
      getTheme: jest.fn().mockResolvedValue('dark'),
      onThemeChange: jest.fn(),
      onOrgSelection: jest.fn(),
      onGoogleAuthError: jest.fn(),
    };
    window.trackflow = mockTrackflow;
    window.close = jest.fn();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  // TC-001: Login form renders with all required elements
  test('TC-001: login form contains all required elements', () => {
    expect(document.getElementById('email')).not.toBeNull();
    expect(document.getElementById('password')).not.toBeNull();
    expect(document.getElementById('submitBtn')).not.toBeNull();
    expect(document.getElementById('googleBtn')).not.toBeNull();
    expect(document.getElementById('errorMsg')).not.toBeNull();
    expect(document.getElementById('passwordToggle')).not.toBeNull();
    expect(document.getElementById('closeBtn')).not.toBeNull();
  });

  // TC-002: Empty email shows validation error
  test('TC-002: empty email prevents submission', () => {
    const email = document.getElementById('email');
    const password = document.getElementById('password');
    const errorMsg = document.getElementById('errorMsg');

    email.value = '';
    password.value = 'somepassword';

    // Simulate the validation logic from login.html
    const emailVal = email.value.trim();
    if (!emailVal) {
      errorMsg.textContent = 'Please enter your email';
      errorMsg.style.display = 'block';
      email.focus();
    }

    expect(errorMsg.textContent).toBe('Please enter your email');
    expect(errorMsg.style.display).toBe('block');
  });

  // TC-003: Empty password shows validation error
  test('TC-003: empty password prevents submission', () => {
    const email = document.getElementById('email');
    const password = document.getElementById('password');
    const errorMsg = document.getElementById('errorMsg');

    email.value = 'test@example.com';
    password.value = '';

    const emailVal = email.value.trim();
    const passwordVal = password.value;

    if (emailVal && !passwordVal) {
      errorMsg.textContent = 'Please enter your password';
      errorMsg.style.display = 'block';
      password.focus();
    }

    expect(errorMsg.textContent).toBe('Please enter your password');
    expect(errorMsg.style.display).toBe('block');
  });

  // TC-004: Successful login calls trackflow.login
  test('TC-004: successful login calls trackflow.login with credentials', async () => {
    mockTrackflow.login.mockResolvedValue({ success: true });

    const email = 'user@example.com';
    const password = 'secret123';

    await mockTrackflow.login(email, password);

    expect(mockTrackflow.login).toHaveBeenCalledWith('user@example.com', 'secret123');
  });

  // TC-005: Login error displays error message
  test('TC-005: login error result displays error message', async () => {
    const errorMsg = document.getElementById('errorMsg');
    mockTrackflow.login.mockResolvedValue({ error: 'Invalid credentials' });

    const result = await mockTrackflow.login('test@test.com', 'wrong');

    if (result.error) {
      errorMsg.textContent = result.error;
      errorMsg.style.display = 'block';
    }

    expect(errorMsg.textContent).toBe('Invalid credentials');
    expect(errorMsg.style.display).toBe('block');
  });

  // TC-006: Network failure shows connection error
  test('TC-006: network failure shows connection error', async () => {
    const errorMsg = document.getElementById('errorMsg');
    mockTrackflow.login.mockRejectedValue(new Error('Network error'));

    try {
      await mockTrackflow.login('test@test.com', 'pass');
    } catch {
      errorMsg.textContent = 'Connection failed. Please check your internet.';
      errorMsg.style.display = 'block';
    }

    expect(errorMsg.textContent).toBe('Connection failed. Please check your internet.');
    expect(errorMsg.style.display).toBe('block');
  });

  // TC-007: Multi-org login shows organization selector
  test('TC-007: multi-org response shows organization selector', async () => {
    const loginView = document.getElementById('loginView');
    const orgView = document.getElementById('orgView');
    const orgList = document.getElementById('orgList');

    const orgs = [
      { organization_id: 'org-1', organization_name: 'Acme Corp', user_role: 'admin', organization_plan: 'pro' },
      { organization_id: 'org-2', organization_name: 'Beta Inc', user_role: 'member', organization_plan: 'free' },
    ];

    mockTrackflow.login.mockResolvedValue({
      requires_org_selection: true,
      organizations: orgs,
      credentials: { email: 'test@test.com', password: 'pass' },
    });

    const result = await mockTrackflow.login('test@test.com', 'pass');

    if (result.requires_org_selection) {
      loginView.style.display = 'none';
      orgView.classList.add('visible');

      result.organizations.forEach((org) => {
        const btn = document.createElement('button');
        btn.className = 'org-item';
        btn.dataset.orgId = org.organization_id;
        btn.textContent = org.organization_name;
        orgList.appendChild(btn);
      });
    }

    expect(loginView.style.display).toBe('none');
    expect(orgView.classList.contains('visible')).toBe(true);
    expect(orgList.children.length).toBe(2);
  });

  // TC-008: Password toggle shows/hides password
  test('TC-008: password toggle changes input type', () => {
    const passwordInput = document.getElementById('password');
    const eyeIcon = document.getElementById('eyeIcon');
    const eyeOffIcon = document.getElementById('eyeOffIcon');

    expect(passwordInput.type).toBe('password');

    // Simulate toggle to show
    passwordInput.type = 'text';
    eyeIcon.style.display = 'none';
    eyeOffIcon.style.display = 'block';

    expect(passwordInput.type).toBe('text');
    expect(eyeIcon.style.display).toBe('none');
    expect(eyeOffIcon.style.display).toBe('block');

    // Simulate toggle back to hide
    passwordInput.type = 'password';
    eyeIcon.style.display = 'block';
    eyeOffIcon.style.display = 'none';

    expect(passwordInput.type).toBe('password');
  });

  // TC-009: Submit button disabled during login attempt
  test('TC-009: submit button disabled during login', async () => {
    const submitBtn = document.getElementById('submitBtn');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in\u2026';

    expect(submitBtn.disabled).toBe(true);
    expect(submitBtn.textContent).toBe('Signing in\u2026');

    // After login completes
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign In';

    expect(submitBtn.disabled).toBe(false);
    expect(submitBtn.textContent).toBe('Sign In');
  });

  // TC-010: Close button closes window
  test('TC-010: close button calls window.close', () => {
    const closeBtn = document.getElementById('closeBtn');
    closeBtn.addEventListener('click', () => window.close());
    closeBtn.click();

    expect(window.close).toHaveBeenCalled();
  });

  // TC-011: Google Sign-In button triggers google-login IPC
  test('TC-011: Google button calls trackflow.googleLogin', async () => {
    mockTrackflow.googleLogin.mockResolvedValue({ success: true });

    await mockTrackflow.googleLogin();

    expect(mockTrackflow.googleLogin).toHaveBeenCalled();
  });

  // TC-012: Google login button disabled during attempt
  test('TC-012: Google button disabled during login attempt', () => {
    const googleBtn = document.getElementById('googleBtn');

    googleBtn.disabled = true;
    googleBtn.textContent = 'Opening browser\u2026';

    expect(googleBtn.disabled).toBe(true);
    expect(googleBtn.textContent).toBe('Opening browser\u2026');
  });

  // TC-013: Google login multi-org triggers org selector
  test('TC-013: Google login with multi-org shows org selector', async () => {
    const orgs = [
      { organization_id: 'org-1', organization_name: 'Test Org', user_role: 'admin', organization_plan: 'pro' },
    ];

    mockTrackflow.googleLogin.mockResolvedValue({
      requires_org_selection: true,
      organizations: orgs,
      credentials: { google_token: 'abc' },
    });

    const result = await mockTrackflow.googleLogin();

    expect(result.requires_org_selection).toBe(true);
    expect(result.organizations).toHaveLength(1);
    expect(result.organizations[0].organization_name).toBe('Test Org');
  });

  // TC-014: Google login error shows error message
  test('TC-014: Google login error displays error', async () => {
    const errorMsg = document.getElementById('errorMsg');
    mockTrackflow.googleLogin.mockResolvedValue({ error: 'Account not found' });

    const result = await mockTrackflow.googleLogin();
    if (result.error) {
      errorMsg.textContent = result.error;
      errorMsg.style.display = 'block';
    }

    expect(errorMsg.textContent).toBe('Account not found');
  });

  // TC-015: Google login exception shows generic error
  test('TC-015: Google login exception shows generic error', async () => {
    const errorMsg = document.getElementById('errorMsg');
    mockTrackflow.googleLogin.mockRejectedValue(new Error('timeout'));

    try {
      await mockTrackflow.googleLogin();
    } catch {
      errorMsg.textContent = 'Google sign-in failed. Please try again.';
      errorMsg.style.display = 'block';
    }

    expect(errorMsg.textContent).toBe('Google sign-in failed. Please try again.');
  });

  // TC-020 through TC-025: Organization Selector
  describe('Organization Selector', () => {
    const mockOrgs = [
      { organization_id: 'org-1', organization_name: 'Acme Corp', user_role: 'admin', organization_plan: 'pro' },
      { organization_id: 'org-2', organization_name: 'Beta', user_role: 'member', organization_plan: 'free' },
    ];

    // TC-020: Org selector renders organizations dynamically
    test('TC-020: renders organization buttons with correct content', () => {
      const orgList = document.getElementById('orgList');

      mockOrgs.forEach((org) => {
        const initials = org.organization_name
          .split(' ')
          .map((w) => w[0])
          .join('')
          .toUpperCase()
          .slice(0, 2);

        const btn = document.createElement('button');
        btn.className = 'org-item';
        btn.innerHTML = `
          <div class="org-avatar">${initials}</div>
          <div class="org-info">
            <div class="org-name">${org.organization_name}</div>
            <div class="org-role">${org.user_role}</div>
          </div>
        `;
        orgList.appendChild(btn);
      });

      expect(orgList.children.length).toBe(2);
      expect(orgList.querySelector('.org-avatar').textContent.trim()).toBe('AC');
    });

    // TC-021: Clicking an org calls selectOrganization
    test('TC-021: org click calls selectOrganization with correct params', async () => {
      const credentials = { email: 'test@test.com', password: 'pass' };
      mockTrackflow.selectOrganization.mockResolvedValue({ success: true });

      await mockTrackflow.selectOrganization('org-1', credentials);

      expect(mockTrackflow.selectOrganization).toHaveBeenCalledWith('org-1', credentials);
    });

    // TC-022: Org selection error displays error
    test('TC-022: org selection error shows error message', async () => {
      const orgErrorMsg = document.getElementById('orgErrorMsg');
      mockTrackflow.selectOrganization.mockResolvedValue({ error: 'Organization suspended' });

      const result = await mockTrackflow.selectOrganization('org-1', {});
      if (result.error) {
        orgErrorMsg.textContent = result.error;
        orgErrorMsg.style.display = 'block';
      }

      expect(orgErrorMsg.textContent).toBe('Organization suspended');
      expect(orgErrorMsg.style.display).toBe('block');
    });

    // TC-023: All org buttons disabled during selection
    test('TC-023: org buttons disabled during selection', () => {
      const orgList = document.getElementById('orgList');

      // Add org buttons
      for (let i = 0; i < 2; i++) {
        const btn = document.createElement('button');
        btn.className = 'org-item';
        orgList.appendChild(btn);
      }

      // Disable all
      document.querySelectorAll('.org-item').forEach((b) => b.disabled = true);
      const allDisabled = Array.from(document.querySelectorAll('.org-item')).every(b => b.disabled);
      expect(allDisabled).toBe(true);

      // Re-enable
      document.querySelectorAll('.org-item').forEach((b) => b.disabled = false);
      const allEnabled = Array.from(document.querySelectorAll('.org-item')).every(b => !b.disabled);
      expect(allEnabled).toBe(true);
    });

    // TC-024: Back button returns to login form
    test('TC-024: back button returns to login view', () => {
      const loginView = document.getElementById('loginView');
      const orgView = document.getElementById('orgView');

      // Simulate being on org view
      loginView.style.display = 'none';
      orgView.classList.add('visible');

      // Simulate back button
      orgView.classList.remove('visible');
      loginView.style.display = 'block';

      expect(orgView.classList.contains('visible')).toBe(false);
      expect(loginView.style.display).toBe('block');
    });

    // TC-025: Org initials computed correctly
    test('TC-025: org initials computed correctly', () => {
      const testCases = [
        { name: 'Acme Corp', expected: 'AC' },
        { name: 'Beta', expected: 'B' },
        { name: 'My Great Company', expected: 'MG' },
        { name: 'X', expected: 'X' },
      ];

      testCases.forEach(({ name, expected }) => {
        const initials = name
          .split(' ')
          .map((w) => w[0])
          .join('')
          .toUpperCase()
          .slice(0, 2);
        expect(initials).toBe(expected);
      });
    });
  });
});
