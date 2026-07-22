/**
 * Detect server-side "desktop agent too old" rejections (HTTP 426).
 * Used to block local-first timer fallback — upgrade is mandatory, not offline.
 */
function isAgentUpgradeRequiredError(error) {
  const status = error?.response?.status;
  const code = error?.response?.data?.code;
  return status === 426 || code === 'AGENT_UPGRADE_REQUIRED';
}

function getAgentUpgradePayload(error) {
  const data = error?.response?.data || {};
  return {
    message:
      data.message ||
      'This version of the TrackFlow desktop app is no longer supported. Please update to continue tracking time.',
    minVersion: data.min_version || null,
    yourVersion: data.your_version || null,
  };
}

module.exports = {
  isAgentUpgradeRequiredError,
  getAgentUpgradePayload,
};
