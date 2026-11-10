const mongoose = require('mongoose');
const commentSchema = new mongoose.Schema({
  post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
  parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null, index: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true, trim: true, maxlength: 2000 },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  deletedAt: { type: Date, default: null },
  deletionStatus: { type: String, enum: ['none', 'pending', 'rejected', 'approved'], default: 'none', index: true },
}, { timestamps: true });
module.exports = mongoose.model('Comment', commentSchema);

