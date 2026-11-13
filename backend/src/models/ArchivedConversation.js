const mongoose = require('mongoose');

const archivedConversationSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  peer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  archivedAt: { type: Date, default: Date.now, required: true },
  expiresAt: { type: Date, required: true, index: true },
}, { timestamps: true, collection: 'archivedconversations' });

archivedConversationSchema.index({ owner: 1, peer: 1 }, { unique: true });
module.exports = mongoose.model('ArchivedConversation', archivedConversationSchema);
