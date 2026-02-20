'use strict';

const { Server } = require('socket.io');

/** In-memory session store: sessionCode → { hostSocket, clientSocket } */
const sessions = new Map();

function initSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: process.env.CORS_ORIGIN || '*' },
  });

  io.on('connection', (socket) => {
    // Desktop creates a session
    socket.on('create-session', ({ sessionCode, deviceInfo }) => {
      sessions.set(sessionCode, {
        hostSocket: socket,
        clientSocket: null,
        deviceInfo,
        createdAt: Date.now(),
      });
      socket.emit('session-created', { sessionCode });
    });

    // Mobile joins an existing session
    socket.on('join-session', ({ sessionCode }) => {
      const session = sessions.get(sessionCode);
      if (!session) {
        socket.emit('error', { message: 'Session not found' });
        return;
      }
      session.clientSocket = socket;
      session.hostSocket.emit('client-connected', {
        deviceInfo: socket.handshake.headers['user-agent'],
      });
      socket.emit('session-joined', { status: 'connected' });
    });

    // Desktop streams answer chunk to mobile
    socket.on('stream-answer', ({ sessionCode, chunk, isDone }) => {
      const session = sessions.get(sessionCode);
      if (session?.clientSocket) {
        session.clientSocket.emit('answer-chunk', { chunk, isDone });
      }
    });

    // Desktop streams transcript update to mobile
    socket.on('transcript-update', ({ sessionCode, transcript }) => {
      const session = sessions.get(sessionCode);
      if (session?.clientSocket) {
        session.clientSocket.emit('transcript-update', { transcript });
      }
    });

    socket.on('disconnect', () => {
      sessions.forEach((session, code) => {
        if (session.hostSocket === socket) {
          // Notify mobile that host disconnected
          session.clientSocket?.emit('host-disconnected');
          sessions.delete(code);
        } else if (session.clientSocket === socket) {
          session.hostSocket?.emit('client-disconnected');
          session.clientSocket = null;
        }
      });
    });
  });

  return io;
}

module.exports = { initSocketServer };
