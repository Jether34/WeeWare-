const mongoose = require('mongoose');

const deletedContentSchema = new mongoose.Schema({
  contentType: { type: String, enum: ['message', 'post', 'comment'], required: true, index: true },
  sourceId: { type: String, required: true, index: true },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  reason: { type: String, default: 'user_deleted', maxlength: 80 },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  deletedAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true, collection: 'deletedcontent' });

deletedContentSchema.index({ contentType: 1, sourceId: 1, reason: 1 }, { unique: true });
module.exports = mongoose.model('DeletedContent', deletedContentSchema);
