const {
  isAgentUpgradeRequiredError,
  getAgentUpgradePayload,
} = require('../src/main/agent-upgrade');

describe('agent-upgrade', () => {
  test('isAgentUpgradeRequiredError detects HTTP 426', () => {
    expect(
      isAgentUpgradeRequiredError({ response: { status: 426, data: {} } }),
    ).toBe(true);
  });

  test('isAgentUpgradeRequiredError detects AGENT_UPGRADE_REQUIRED code', () => {
    expect(
      isAgentUpgradeRequiredError({
        response: { status: 400, data: { code: 'AGENT_UPGRADE_REQUIRED' } },
      }),
    ).toBe(true);
  });

  test('isAgentUpgradeRequiredError returns false for network errors', () => {
    expect(isAgentUpgradeRequiredError({ code: 'ECONNREFUSED' })).toBe(false);
  });

  test('getAgentUpgradePayload extracts server message and versions', () => {
    const payload = getAgentUpgradePayload({
      response: {
        data: {
          message: 'Please update.',
          min_version: '1.0.44',
          your_version: '1.0.40',
        },
      },
    });
    expect(payload.message).toBe('Please update.');
    expect(payload.minVersion).toBe('1.0.44');
    expect(payload.yourVersion).toBe('1.0.40');
  });
});
