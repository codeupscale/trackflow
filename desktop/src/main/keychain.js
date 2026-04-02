// Secure token storage using Node.js crypto (AES-256-GCM)
//
// Does NOT use macOS Keychain, Electron safeStorage, or keytar.
// All three trigger the macOS "wants to use your keychain" password popup
// for ad-hoc signed / unsigned apps without an Apple Developer certificate.
//
// Instead, we encrypt tokens ourselves with a key derived from:
//   - A static app secret (embedded in the binary)
//   - The userData path (unique per user + app)
//
// This is the same approach used by VS Code, Slack, and Discord for
// unsigned/development builds. For production with a real Apple Developer
// cert, safeStorage would work without popups — but we don't have one.

const { app } = require('electron');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const TOKENS_FILE = 'tokens.enc';
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// L1 FIX: Derive encryption key from a combination of machine-specific data
// instead of a hardcoded string. This is "obscurity not security" — the goal
// is keychain-popup-free operation on macOS, not Keychain-grade protection.
function deriveKey() {
  // Build a machine-specific secret from network interfaces MAC hash + app version
  const os = require('os');
  let machineId = 'trackflow-agent-token-encryption-v2';
  try {
    const interfaces = os.networkInterfaces();
    const macs = [];
    for (const [, addrs] of Object.entries(interfaces)) {
      for (const addr of addrs) {
        if (addr.mac && addr.mac !== '00:00:00:00:00:00') {
          macs.push(addr.mac);
        }
      }
    }
    if (macs.length > 0) {
      macs.sort(); // Stable order
      const macHash = crypto.createHash('sha256').update(macs.join(':')).digest('hex');
      machineId = `trackflow-${macHash}-v2`;
    }
  } catch {
    // Fallback to static string if MAC reading fails
  }
  const salt = app.getPath('userData'); // unique per user + app install
  return crypto.pbkdf2Sync(machineId, salt, 100000, KEY_LENGTH, 'sha256');
}

let _cachedKey = null;
function getKey() {
  if (!_cachedKey) _cachedKey = deriveKey();
  return _cachedKey;
}

function getTokensPath() {
  return path.join(app.getPath('userData'), TOKENS_FILE);
}

function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: iv (16) + authTag (16) + ciphertext
  return Buffer.concat([iv, authTag, encrypted]);
}

function decrypt(buffer) {
  const key = getKey();
  const iv = buffer.subarray(0, IV_LENGTH);
  const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext, null, 'utf8') + decipher.final('utf8');
}

// In-memory fallback if file I/O fails
let _memoryTokens = {};

function readTokensFromDisk() {
  try {
    const filePath = getTokensPath();
    if (!fs.existsSync(filePath)) return _memoryTokens;

    const encryptedBuffer = fs.readFileSync(filePath);
    if (encryptedBuffer.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) return {};

    const decrypted = decrypt(encryptedBuffer);
    const tokens = JSON.parse(decrypted);
    _memoryTokens = tokens; // Keep in-memory copy in sync
    return tokens;
  } catch {
    // Decryption failed (key changed, corrupted file, etc.) — start fresh
    return _memoryTokens;
  }
}

function writeTokensToDisk(tokens) {
  _memoryTokens = tokens;
  try {
    const filePath = getTokensPath();
    const encrypted = encrypt(JSON.stringify(tokens));
    fs.writeFileSync(filePath, encrypted);
  } catch (e) {
    console.error('Failed to write tokens:', e.message);
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
