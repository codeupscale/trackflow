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
});
