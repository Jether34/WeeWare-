const mongoose = require('mongoose');
const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  type: { type: String, enum: ['like', 'comment', 'reply', 'comment_like', 'post_approved', 'post_rejected', 'post_delete_approved', 'post_delete_rejected', 'comment_delete_approved', 'comment_delete_rejected', 'post_removed', 'comment_removed'], required: true },
  post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
  comment: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment' },
  isRead: { type: Boolean, default: false, index: true },
}, { timestamps: true });
module.exports = mongoose.model('Notification', notificationSchema);

