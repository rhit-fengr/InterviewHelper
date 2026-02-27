/**
 * Manual Jest mock for socket.io-client.
 * Exposes a factory that returns a controllable fake socket so tests can
 * trigger events and assert on emissions without a real network connection.
 */

const createMockSocket = () => {
  const listeners = {};

  const socket = {
    connected: false,
    id: 'mock-socket-id',

    on: jest.fn((event, fn) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
      return socket;
    }),

    off: jest.fn((event, fn) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((l) => l !== fn);
      }
      return socket;
    }),

    emit: jest.fn((event, ...args) => {
      return socket;
    }),

    disconnect: jest.fn(() => {
      socket.connected = false;
      socket._trigger('disconnect');
      return socket;
    }),

    /** Test helper — fire an event as if it came from the server */
    _trigger: (event, ...args) => {
      (listeners[event] || []).forEach((fn) => fn(...args));
    },
  };

  return socket;
};

let _lastSocket = null;

const io = jest.fn((url, opts) => {
  _lastSocket = createMockSocket();
  return _lastSocket;
});

/** Get the most recently created socket (for test assertions) */
io.getLastSocket = () => _lastSocket;

module.exports = { io };
module.exports.default = io;
