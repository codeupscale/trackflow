const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Ensure test directory exists
const testDir = app.getPath('userData');
if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

const { getToken, setToken, getRefreshToken, setRefreshToken, deleteToken } = require('../src/main/keychain');

describe('Keychain (crypto-based)', () => {
  const tokensPath = path.join(testDir, 'tokens.enc');

  beforeEach(async () => {
    // Clean up file AND in-memory state
    await deleteToken();
  });

  afterEach(async () => {
    await deleteToken();
  });

  test('setToken + getToken round-trip', async () => {
    await setToken('my-access-token');
    const token = await getToken();
    expect(token).toBe('my-access-token');
  });

  test('setRefreshToken + getRefreshToken round-trip', async () => {
    await setRefreshToken('my-refresh-token');
    const token = await getRefreshToken();
    expect(token).toBe('my-refresh-token');
  });

  test('getToken returns null when no file exists', async () => {
    const token = await getToken();
    expect(token).toBeNull();
  });

  test('deleteToken removes the file', async () => {
    await setToken('temp-token');
    expect(fs.existsSync(tokensPath)).toBe(true);
    await deleteToken();
    expect(fs.existsSync(tokensPath)).toBe(false);
  });

  test('deleteToken does not throw when no file exists', async () => {
    await expect(deleteToken()).resolves.not.toThrow();
  });

  test('both tokens persist in same file', async () => {
    await setToken('access-123');
    await setRefreshToken('refresh-456');
    expect(await getToken()).toBe('access-123');
    expect(await getRefreshToken()).toBe('refresh-456');
  });

  test('encrypted file is not plaintext readable', async () => {
    await setToken('secret-token-value');
    const raw = fs.readFileSync(tokensPath);
    // The file should NOT contain the plaintext token
    expect(raw.toString('utf8')).not.toContain('secret-token-value');
    // But we can still decrypt it
    expect(await getToken()).toBe('secret-token-value');
  });

  test('corrupted file returns null gracefully', async () => {
    await setToken('good-token');
    // Corrupt the file
    fs.writeFileSync(tokensPath, 'garbage data');
    // Should not throw, returns null
    const token = await getToken();
    expect(token).toBeNull();
  });

  // ── BUG A: stable, machine-bound device key ───────────────────────────────
  // The encryption key must derive from a persisted random secret (`.device-key`)
  // — NOT from the volatile set of network-interface MAC addresses, which changes
  // across launches (VPN/utun, Docker bridges, USB/BT adapters) and used to make
  // tokens.enc undecryptable, forcing the user to log in on every restart.
  describe('device key persistence (BUG A)', () => {
    const deviceKeyPath = path.join(testDir, '.device-key');

    // Start each test from a clean slate AND a fresh module instance so the
    // in-process key cache from earlier tests cannot mask first-run behavior.
    beforeEach(() => {
      try { fs.unlinkSync(tokensPath); } catch {}
      try { fs.unlinkSync(deviceKeyPath); } catch {}
      jest.resetModules();
    });

    afterEach(() => {
      try { fs.unlinkSync(deviceKeyPath); } catch {}
      jest.resetModules();
    });

    test('writing a token creates a persisted .device-key file', async () => {
      const kc = require('../src/main/keychain');
      await kc.setToken('access-abc');
      expect(fs.existsSync(deviceKeyPath)).toBe(true);
      // 32-byte random secret
      const secret = fs.readFileSync(deviceKeyPath);
      expect(secret.length).toBeGreaterThanOrEqual(32);
    });

    test('tokens decrypt across a fresh module load when device key persists', async () => {
      const kc = require('../src/main/keychain');
      await kc.setToken('persisted-access');
      await kc.setRefreshToken('persisted-refresh');

      // Simulate an app restart: drop the in-memory cached key + tokens by
      // re-requiring the module fresh. The persisted .device-key on disk must
      // re-derive the SAME key so tokens.enc still decrypts. (This is the exact
      // scenario the volatile-MAC key broke — the user re-logged in every quit.)
      jest.resetModules();
      const fresh = require('../src/main/keychain');
      expect(await fresh.getToken()).toBe('persisted-access');
      expect(await fresh.getRefreshToken()).toBe('persisted-refresh');
    });

    test('deleteToken removes tokens.enc but preserves the device key', async () => {
      const kc = require('../src/main/keychain');
      await kc.setToken('temp');
      expect(fs.existsSync(deviceKeyPath)).toBe(true);
      await kc.deleteToken();
      // Tokens are gone (logout), but the stable device key survives so the
      // next session is still decryptable once the user logs in again.
      expect(fs.existsSync(tokensPath)).toBe(false);
      expect(fs.existsSync(deviceKeyPath)).toBe(true);
    });
  });
});
