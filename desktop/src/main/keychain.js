// Secure token storage using Node.js crypto (AES-256-GCM)
//
// Does NOT use macOS Keychain, Electron safeStorage, or keytar.
// All three trigger the macOS "wants to use your keychain" password popup
// for ad-hoc signed / unsigned apps without an Apple Developer certificate.
//
// Instead, we encrypt tokens ourselves with a key derived from a STABLE,
// machine-bound secret:
//   - A persisted random 32-byte device secret (`.device-key` in userData),
//     generated once on first run with crypto.randomBytes
//   - The userData path as salt (unique per user + app install)
//
// This is the same approach used by VS Code, Slack, and Discord for
// unsigned/development builds. For production with a real Apple Developer
// cert, safeStorage would work without popups — but we don't have one.
//
// ── Why a persisted random secret (BUG A FIX) ────────────────────────────────
// The previous implementation derived the key from the SET of all network
// interface MAC addresses (os.networkInterfaces()). That set is VOLATILE across
// launches on real machines: iCloud Private Relay / VPN `utun` interfaces,
// Docker bridge interfaces, and USB/Bluetooth adapters appear and disappear.
// When the MAC set changed, the derived key changed, so `tokens.enc` could no
// longer be decrypted and the user was forced to log in again on every restart.
//
// A random secret written to disk once is stable across launches, bound to this
// machine + install, needs no OS keychain, and behaves identically on
// Windows / macOS / Linux. Existing users encrypted under the old volatile key
// will fail to decrypt ONCE (handled gracefully as "no token" → re-login), then
// the new key is stable forever.

const { app } = require('electron');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const TOKENS_FILE = 'tokens.enc';
const DEVICE_KEY_FILE = '.device-key';
const DEVICE_SECRET_LENGTH = 32;
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const PBKDF2_ITERATIONS = 100000;

function getDeviceKeyPath() {
  return path.join(app.getPath('userData'), DEVICE_KEY_FILE);
}

// Load the persisted device secret, generating + persisting it on first run.
// Cross-platform: pure Node.js fs + crypto, no OS keychain, no native modules.
// The returned value is a 32-byte Buffer that is stable across launches.
function loadOrCreateDeviceSecret() {
  const keyPath = getDeviceKeyPath();
  try {
    if (fs.existsSync(keyPath)) {
      const existing = fs.readFileSync(keyPath);
      if (existing.length >= DEVICE_SECRET_LENGTH) {
        console.log('[keychain] Device key loaded (stable across restarts)');
        return existing.subarray(0, DEVICE_SECRET_LENGTH);
      }
      // File exists but is truncated/corrupt — regenerate below.
      console.warn('[keychain] Device key file truncated — regenerating');
    }
  } catch {
    // Fall through to generation; if reads keep failing we degrade to an
    // in-memory secret (see catch on write) rather than crashing.
  }

  const secret = crypto.randomBytes(DEVICE_SECRET_LENGTH);
  console.log('[keychain] Device key created (first run) — token will now persist across restarts');
  try {
    // Ensure userData exists (it normally does, but be defensive).
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    // Write atomically-ish and restrict permissions on POSIX. The mode is a
    // no-op on Windows, which is fine — the file lives in the per-user profile.
    fs.writeFileSync(keyPath, secret, { mode: 0o600 });
    try { fs.chmodSync(keyPath, 0o600); } catch {}
  } catch (e) {
    // If we cannot persist the secret, fall back to a process-lifetime secret.
    // Tokens written this session won't survive a restart, but the app still
    // works and never crashes. (No secret material is logged.)
    console.error('[keychain] Could not persist device key, using ephemeral key:', e.message);
  }
  return secret;
}

// Derive the AES-256-GCM key from the stable device secret + userData salt.
function deriveKey() {
  const secret = loadOrCreateDeviceSecret();
  const salt = app.getPath('userData'); // unique per user + app install
  return crypto.pbkdf2Sync(secret, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
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
    if (!fs.existsSync(filePath)) {
      console.log('[keychain] No stored token file — login required (expected on first run / after logout)');
      return _memoryTokens;
    }

    const encryptedBuffer = fs.readFileSync(filePath);
    if (encryptedBuffer.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) return {};

    const decrypted = decrypt(encryptedBuffer);
    const tokens = JSON.parse(decrypted);
    _memoryTokens = tokens; // Keep in-memory copy in sync
    console.log('[keychain] Stored token decrypted OK — session restored (no re-login needed)');
    return tokens;
  } catch {
    // Decryption failed (key changed, corrupted file, etc.) — start fresh
    console.warn('[keychain] Token decrypt FAILED — login required (key mismatch or corrupt file)');
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

function getDeviceId() {
  const secret = loadOrCreateDeviceSecret();
  return crypto.createHash('sha256').update(secret).digest('hex');
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

module.exports = { getToken, setToken, getRefreshToken, setRefreshToken, deleteToken, getDeviceId };
