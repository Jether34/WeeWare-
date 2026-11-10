const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 5021),
  bindHost: process.env.BIND_HOST || '127.0.0.1',
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/weeware',
  jwtSecret: process.env.JWT_SECRET || 'local-development-only-change-this-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5180,http://127.0.0.1:5180',
  trustProxy: process.env.TRUST_PROXY === '1' ? 1 : false,
  mlServiceUrl: process.env.ML_SERVICE_URL || 'http://127.0.0.1:8021',
  uploadDir: path.resolve(__dirname, '../../', process.env.UPLOAD_DIR || 'uploads'),
  groupUploadDir: path.resolve(__dirname, '../../', process.env.GROUP_UPLOAD_DIR || 'private-group-files'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 1073741824),
  ollamaUrl: (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, ''),
  ollamaModel: process.env.OLLAMA_MODEL || 'qwen2.5:1.5b',
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpSecure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1',
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  smtpFrom: process.env.SMTP_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER || '',
  smtpFromName: process.env.SMTP_FROM_NAME || 'WeeWare',
  frontendUrl: process.env.FRONTEND_URL || process.env.CLIENT_ORIGIN?.split(',')[0]?.trim() || 'http://localhost:5180',
};

