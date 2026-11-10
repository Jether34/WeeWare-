const mongoose = require('mongoose');

const groupFileSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  message: { type: mongoose.Schema.Types.ObjectId, ref: 'GroupMessage', default: null, index: true },
  storageName: { type: String, required: true, unique: true },
  originalName: { type: String, required: true, maxlength: 255 },
  mimeType: { type: String, default: 'application/octet-stream', maxlength: 160 },
  size: { type: Number, required: true, min: 1, max: 1073741824 },
}, { timestamps: true });

module.exports = mongoose.model('GroupFile', groupFileSchema);
