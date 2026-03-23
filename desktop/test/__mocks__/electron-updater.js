module.exports = {
  autoUpdater: {
    checkForUpdatesAndNotify: jest.fn(() => Promise.resolve()),
    on: jest.fn(),
  },
};
