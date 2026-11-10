const mongoose = require('mongoose');

const groupMessageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  content: { type: String, default: '' },
  // Legacy ciphertext remains only so old records can be labeled as unavailable.
  ciphertext: { type: String, default: '' },
  attachment: { type: mongoose.Schema.Types.ObjectId, ref: 'GroupFile', default: null },
}, { timestamps: true });

groupMessageSchema.index({ createdAt: 1 });

module.exports = mongoose.model('GroupMessage', groupMessageSchema);
