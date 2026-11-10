const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const env = require('../config/env');

fs.mkdirSync(env.uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, env.uploadDir),
  filename: (_req, file, callback) => callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).slice(0, 12).toLowerCase()}`),
});

const upload = multer({
  storage,
  limits: { fileSize: env.maxUploadBytes, files: 8 },
  fileFilter: (_req, file, callback) => {
    if (!file.mimetype.startsWith('image/') && !file.mimetype.startsWith('video/')) return callback(new Error('Only images and videos are supported.'));
    callback(null, true);
  },
});

module.exports = upload;

