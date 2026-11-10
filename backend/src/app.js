const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const env = require('./config/env');
const { trafficMiddleware } = require('./services/traffic');

const app = express();
app.set('trust proxy', env.trustProxy);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
app.use(cors({ origin: env.clientOrigin.split(',').map((item) => item.trim()), credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
fs.mkdirSync(env.uploadDir, { recursive: true });
app.use('/uploads', express.static(env.uploadDir, { maxAge: '7d', immutable: true }));
app.use('/api', trafficMiddleware);

app.get('/api/health', (_req, res) => res.json({ success: true, service: 'weeware-api', time: new Date().toISOString() }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/ai/conversations', require('./routes/aiConversations'));
app.use('/api/uploads', require('./routes/uploads'));
app.use('/api/climate', require('./routes/climate'));
app.use('/api/predictions', require('./routes/predictions'));
app.use('/api/ml', require('./routes/ml'));
app.use('/api/saved-predictions', require('./routes/savedPredictions'));
app.use('/api/posts', require('./routes/posts'));
app.use('/api/comments', require('./routes/comments'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/moderation', require('./routes/moderation'));
app.use('/api/system', require('./routes/system'));

const frontendDist = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
  // The authenticated SPA shell must be revalidated on mobile browsers so a
  // previous JavaScript bundle cannot leave messaging behavior stale.
  app.use((req, res, next) => {
    if (req.path.startsWith('/app/')) res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    next();
  });
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => req.path.startsWith('/api/') ? next() : res.sendFile(path.join(frontendDist, 'index.html')));
}
app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found.' }));
app.use((err, req, res, _next) => {
  console.error(`[api:error] ${req.method} ${req.originalUrl}`, err.stack || err.message);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ success: false, message: status >= 500 ? 'The request could not be completed.' : err.message });
});

module.exports = app;

