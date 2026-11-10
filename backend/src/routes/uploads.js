const express = require('express');
const upload = require('../middleware/upload');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

router.post('/', requireAuth, upload.array('files', 8), (req, res) => {
  const files = (req.files || []).map((file) => ({ url: `/uploads/${file.filename}`, type: file.mimetype.startsWith('video/') ? 'video' : 'image', mime: file.mimetype, size: file.size }));
  res.status(201).json({ success: true, files });
});
router.get('/limits', (_req, res) => res.json({ maxBytes: require('../config/env').maxUploadBytes, allowedTypes: ['image/*', 'video/*'] }));
module.exports = router;

