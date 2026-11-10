const mongoose = require('mongoose');

const moderationRequestSchema = new mongoose.Schema({
  kind: { type: String, enum: ['post_deletion', 'comment_deletion'], required: true, index: true },
  post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
  comment: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
  requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  decidedAt: { type: Date, default: null },
}, { timestamps: true });

moderationRequestSchema.index({ status: 1, createdAt: -1 });
module.exports = mongoose.model('ModerationRequest', moderationRequestSchema);
