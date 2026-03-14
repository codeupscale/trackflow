// AGENT-10: Keychain credential storage using keytar
// Never store tokens in plain text files

const SERVICE_NAME = 'TrackFlow';
const ACCOUNT_NAME = 'access_token';

async function getToken() {
  try {
    const keytar = require('keytar');
    return await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
  } catch {
    // Fallback to in-memory if keytar unavailable
    return global._trackflowToken || null;
  }
}

async function setToken(token) {
  try {
    const keytar = require('keytar');
    await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, token);
  } catch {
    global._trackflowToken = token;
  }
}

async function deleteToken() {
  try {
    const keytar = require('keytar');
    await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
  } catch {
    global._trackflowToken = null;
  }
}

module.exports = { getToken, setToken, deleteToken };
