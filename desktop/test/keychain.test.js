const fs = require('fs');
const path = require('path');
const { safeStorage, app } = require('electron');

// Ensure test directory exists
const testDir = app.getPath('userData');
if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

const { getToken, setToken, getRefreshToken, setRefreshToken, deleteToken } = require('../src/main/keychain');

describe('Keychain (safeStorage)', () => {
  const tokensPath = path.join(testDir, 'tokens.enc');

  beforeEach(() => {
    jest.clearAllMocks();
    // Re-enable encryption for each test
    safeStorage.isEncryptionAvailable.mockReturnValue(true);
    try { fs.unlinkSync(tokensPath); } catch {}
  });

  afterEach(() => {
    try { fs.unlinkSync(tokensPath); } catch {}
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

  test('falls back to memory when encryption unavailable', async () => {
    safeStorage.isEncryptionAvailable.mockReturnValue(false);
    await setToken('memory-token');
    // File should NOT be created
    expect(fs.existsSync(tokensPath)).toBe(false);
    // safeStorage.encryptString should NOT be called
    expect(safeStorage.encryptString).not.toHaveBeenCalled();
  });
});
