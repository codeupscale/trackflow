module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.test.js'],
  collectCoverageFrom: [
    'src/main/**/*.js',
    'src/preload/**/*.js',
    '!src/main/index.js', // Main process entry requires Electron runtime
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'lcov'],
  // Mock native modules that require Electron runtime
  moduleNameMapper: {
    '^electron$': '<rootDir>/test/__mocks__/electron.js',
    '^electron-updater$': '<rootDir>/test/__mocks__/electron-updater.js',
    '^keytar$': '<rootDir>/test/__mocks__/keytar.js',
    '^better-sqlite3$': '<rootDir>/test/__mocks__/better-sqlite3.js',
    '^uiohook-napi$': '<rootDir>/test/__mocks__/uiohook-napi.js',
    '^sharp$': '<rootDir>/test/__mocks__/sharp.js',
  },
};
