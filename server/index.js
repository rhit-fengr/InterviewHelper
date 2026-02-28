'use strict';

require('dotenv').config();
const http = require('http');
const app = require('./app');
const { initSocketServer } = require('./services/socket.service');

const PORT = process.env.PORT || 4000;

const httpServer = http.createServer(app);
initSocketServer(httpServer);

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[server] Port ${PORT} is already in use.`);
    console.error('[server] Stop the existing process or set a different PORT in .env.');
    process.exit(1);
  }

  console.error('[server] Failed to start:', err);
  process.exit(1);
});

httpServer.listen(PORT, () => {
  console.log(`Interview Hammer server running on port ${PORT}`);
});
