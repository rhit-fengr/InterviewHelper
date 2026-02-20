'use strict';

require('dotenv').config();
const http = require('http');
const app = require('./app');
const { initSocketServer } = require('./services/socket.service');

const PORT = process.env.PORT || 4000;

const httpServer = http.createServer(app);
initSocketServer(httpServer);

httpServer.listen(PORT, () => {
  console.log(`Interview Hammer server running on port ${PORT}`);
});
