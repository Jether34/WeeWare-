const mongoose = require('mongoose');

const directMessageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  content: { type: String, default: '' },
  // Legacy ciphertext remains only so old records can be labeled as unavailable.
  ciphertext: { type: String, default: '' },
}, { timestamps: true });

directMessageSchema.index({ sender: 1, recipient: 1, createdAt: -1 });

module.exports = mongoose.model('DirectMessage', directMessageSchema);
