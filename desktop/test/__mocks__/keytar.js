// This mock is no longer needed since we replaced keytar with safeStorage.
// Kept for backwards compatibility in case any test still references it.
const store = {};

module.exports = {
  getPassword: jest.fn((service, account) => Promise.resolve(store[`${service}:${account}`] || null)),
  setPassword: jest.fn((service, account, password) => {
    store[`${service}:${account}`] = password;
    return Promise.resolve();
  }),
  deletePassword: jest.fn((service, account) => {
    delete store[`${service}:${account}`];
    return Promise.resolve(true);
  }),
};
