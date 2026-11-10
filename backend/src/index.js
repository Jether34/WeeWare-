const http = require('http');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const app = require('./app');
const env = require('./config/env');
const traffic = require('./services/traffic');

async function start() {
  await mongoose.connect(env.mongoUri, { monitorCommands: true });
  console.log('[db] MongoDB connected');
  mongoose.connection.getClient().on('commandSucceeded', (event) => traffic.recordFlow({ source: 'WeeWare API', destination: 'MongoDB', type: 'database', label: event.commandName, durationMs: event.duration }));
  mongoose.connection.getClient().on('commandFailed', (event) => traffic.recordFlow({ source: 'WeeWare API', destination: 'MongoDB', type: 'database', label: event.commandName, status: 'error', durationMs: event.duration }));
  const server = http.createServer(app);
  // Forum media can take several minutes to upload over mobile connections.
  // Keep the origin from cutting off a multipart request before Multer finishes.
  server.requestTimeout = 10 * 60 * 1000;
  server.headersTimeout = 65 * 1000;
  const io = new Server(server, { cors: { origin: env.clientOrigin.split(',').map((item) => item.trim()), credentials: true } });
  io.use((socket, next) => {
    try {
      const cookie = (socket.handshake.headers.cookie || '').split(';').map((item) => item.trim()).find((item) => item.startsWith('weeware_token='));
      const token = socket.handshake.auth?.token || cookie?.split('=').slice(1).join('=');
      const claims = token ? jwt.verify(decodeURIComponent(token), env.jwtSecret) : null;
      socket.data.userId = claims?.sub || claims?.id || null;
      socket.data.role = claims?.role === 'user' ? 'farmer' : claims?.role || null;
      next();
    } catch { next(); }
  });
  io.on('connection', (socket) => {
    if (socket.data.userId) socket.join(`user:${socket.data.userId}`);
    if (socket.data.role === 'admin') socket.join('role:admin');
  });
  app.set('io', io);
  traffic.attachSocket(io);
  server.listen(env.port, env.bindHost, () => console.log(`[api] WeeWare API listening on ${env.bindHost}:${env.port}`));
}

start().catch((error) => {
  console.error('[api] startup failed:', error.message);
  process.exit(1);
});

