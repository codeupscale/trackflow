const listeners = {};

module.exports = {
  UiohookKey: {},
  uIOhook: {
    on: jest.fn((event, handler) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    }),
    removeListener: jest.fn((event, handler) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter(h => h !== handler);
      }
    }),
    start: jest.fn(),
    stop: jest.fn(),
    // Test helper: simulate events
    _emit: (event) => {
      if (listeners[event]) {
        listeners[event].forEach(h => h());
      }
    },
  },
};
