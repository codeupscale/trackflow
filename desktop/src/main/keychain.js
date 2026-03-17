// AGENT-10: Keychain credential storage using keytar
// Never store tokens in plain text files

const SERVICE_NAME = 'TrackFlow';
const ACCOUNT_ACCESS = 'access_token';
const ACCOUNT_REFRESH = 'refresh_token';

async function getToken() {
  try {
    const keytar = require('keytar');
    return await keytar.getPassword(SERVICE_NAME, ACCOUNT_ACCESS);
  } catch {
    // Fallback to in-memory if keytar unavailable
    return global._trackflowToken || null;
  }
}

async function setToken(token) {
  try {
    const keytar = require('keytar');
    await keytar.setPassword(SERVICE_NAME, ACCOUNT_ACCESS, token);
  } catch {
    global._trackflowToken = token;
  }
}

async function getRefreshToken() {
  try {
    const keytar = require('keytar');
    return await keytar.getPassword(SERVICE_NAME, ACCOUNT_REFRESH);
  } catch {
    return global._trackflowRefreshToken || null;
  }
}

async function setRefreshToken(token) {
  try {
    const keytar = require('keytar');
    await keytar.setPassword(SERVICE_NAME, ACCOUNT_REFRESH, token);
  } catch {
    global._trackflowRefreshToken = token;
  }
}

async function deleteToken() {
  try {
    const keytar = require('keytar');
    await keytar.deletePassword(SERVICE_NAME, ACCOUNT_ACCESS);
    await keytar.deletePassword(SERVICE_NAME, ACCOUNT_REFRESH);
  } catch {
    global._trackflowToken = null;
    global._trackflowRefreshToken = null;
  }
}

module.exports = { getToken, setToken, getRefreshToken, setRefreshToken, deleteToken };
