// Secure token storage using Electron's safeStorage API
// safeStorage encrypts data using the OS keychain (macOS), DPAPI (Windows),
// or libsecret (Linux) — but tied to the app identity, so NO KEYCHAIN POPUP.
//
// Replaces keytar which caused macOS to show "TrackFlow wants to use your
// confidential information" on every launch for unsigned/dev builds.

const { safeStorage, app } = require('electron');
const path = require('path');
const fs = require('fs');

const TOKENS_FILE = 'tokens.enc';

// In-memory fallback for when safeStorage or file system unavailable
let _memoryTokens = {};

function getTokensPath() {
  return path.join(app.getPath('userData'), TOKENS_FILE);
}

function readTokensFromDisk() {
  try {
    const filePath = getTokensPath();
    if (!fs.existsSync(filePath)) return {};

    const encryptedBuffer = fs.readFileSync(filePath);
    if (!safeStorage.isEncryptionAvailable()) {
      // Can't decrypt — fall back to memory
      return _memoryTokens;
    }
    const decrypted = safeStorage.decryptString(encryptedBuffer);
    return JSON.parse(decrypted);
  } catch {
    return {};
  }
}

function writeTokensToDisk(tokens) {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      // Can't encrypt — store in memory only
      _memoryTokens = tokens;
      return;
    }
    const filePath = getTokensPath();
    const encrypted = safeStorage.encryptString(JSON.stringify(tokens));
    fs.writeFileSync(filePath, encrypted);
  } catch (e) {
    console.error('Failed to write tokens:', e.message);
    _memoryTokens = tokens;
  }
}

async function getToken() {
  const tokens = readTokensFromDisk();
  return tokens.access_token || null;
}

async function setToken(token) {
  const tokens = readTokensFromDisk();
  tokens.access_token = token;
  writeTokensToDisk(tokens);
}

async function getRefreshToken() {
  const tokens = readTokensFromDisk();
  return tokens.refresh_token || null;
}

async function setRefreshToken(token) {
  const tokens = readTokensFromDisk();
  tokens.refresh_token = token;
  writeTokensToDisk(tokens);
}

async function deleteToken() {
  _memoryTokens = {};
  try {
    const filePath = getTokensPath();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e) {
    console.error('Failed to delete tokens:', e.message);
  }
}

module.exports = { getToken, setToken, getRefreshToken, setRefreshToken, deleteToken };
