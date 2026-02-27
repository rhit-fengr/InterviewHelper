'use strict';

const { Server } = require('socket.io');

/** session code → { hostSocket, clientSocket, deviceInfo, createdAt } */
const sessions = new Map();
/** socket.id → sessionCode (for O(1) cleanup on disconnect) */
const socketToSession = new Map();
const SESSION_CODE_PATTERN = /^[A-Z]{3,10}-\d{4}$/;

/**
 * Parse CORS_ORIGIN env var into a value accepted by Socket.io/cors.
 */
function parseCorsOrigin(raw) {
  if (!raw || !raw.trim()) return '*';
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return '*';
  return parts.length === 1 ? parts[0] : parts;
}

function normalizeSessionCode(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().toUpperCase();
}

function isValidSessionCode(code) {
  return SESSION_CODE_PATTERN.test(code);
}

function cleanupSocketSession(socket) {
  const code = socketToSession.get(socket.id);
  socketToSession.delete(socket.id);

  if (!code) return;
  const session = sessions.get(code);
  if (!session) return;

  if (session.hostSocket === socket) {
    session.clientSocket?.emit('host-disconnected');
    sessions.delete(code);
  } else if (session.clientSocket === socket) {
    session.hostSocket?.emit('client-disconnected');
    session.clientSocket = null;
  }
}

function initSocketServer(httpServer) {
  // Prevent stale in-memory state when the server is re-initialized in tests.
  sessions.clear();
  socketToSession.clear();

  const io = new Server(httpServer, {
    cors: { origin: parseCorsOrigin(process.env.CORS_ORIGIN) },
  });

  io.on('connection', (socket) => {
    // Desktop creates a session
    socket.on('create-session', (payload = {}) => {
      const { deviceInfo } = payload;
      const sessionCode = normalizeSessionCode(payload.sessionCode);
      if (!isValidSessionCode(sessionCode)) {
        socket.emit('session-error', { message: 'Invalid session code format' });
        return;
      }

      cleanupSocketSession(socket);

      const existing = sessions.get(sessionCode);
      if (existing?.hostSocket?.connected) {
        socket.emit('session-error', { message: 'Session code already in use' });
        return;
      }

      sessions.set(sessionCode, {
        hostSocket: socket,
        clientSocket: null,
        deviceInfo,
        createdAt: Date.now(),
      });
      socketToSession.set(socket.id, sessionCode);
      socket.emit('session-created', { sessionCode });
    });

    // Mobile joins an existing session
    socket.on('join-session', (payload = {}) => {
      const sessionCode = normalizeSessionCode(payload.sessionCode);
      if (!isValidSessionCode(sessionCode)) {
        socket.emit('session-error', { message: 'Invalid session code format' });
        return;
      }

      cleanupSocketSession(socket);

      const session = sessions.get(sessionCode);
      if (!session) {
        socket.emit('session-error', { message: 'Session not found' });
        return;
      }

      if (session.hostSocket === socket) {
        socket.emit('session-error', { message: 'Host cannot join as mobile client' });
        return;
      }

      if (session.clientSocket) {
        socket.emit('session-error', { message: 'Session already has a connected client' });
        return;
      }

      session.clientSocket = socket;
      socketToSession.set(socket.id, sessionCode);
      session.hostSocket.emit('client-connected', {
        deviceInfo: socket.handshake.headers['user-agent'],
      });
      socket.emit('session-joined', { status: 'connected' });
    });

    // Desktop streams answer chunk (delta) to mobile
    socket.on('stream-answer', (payload = {}) => {
      const sessionCode = normalizeSessionCode(payload.sessionCode);
      const { chunk, isDone } = payload;
      if (!isValidSessionCode(sessionCode)) return;
      const session = sessions.get(sessionCode);
      if (session?.hostSocket === socket && session.clientSocket) {
        session.clientSocket.emit('answer-chunk', { chunk, isDone });
      }
    });

    // Desktop streams transcript update to mobile
    socket.on('transcript-update', (payload = {}) => {
      const sessionCode = normalizeSessionCode(payload.sessionCode);
      const { transcript } = payload;
      if (!isValidSessionCode(sessionCode)) return;
      const session = sessions.get(sessionCode);
      if (session?.hostSocket === socket && session.clientSocket) {
        session.clientSocket.emit('transcript-update', { transcript });
      }
    });

    socket.on('disconnect', () => {
      cleanupSocketSession(socket);
    });
  });

  return io;
}

module.exports = {
  initSocketServer,
  parseCorsOrigin,
  normalizeSessionCode,
  isValidSessionCode,
};
