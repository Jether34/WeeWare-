const express = require('express');
const Comment = require('../models/Comment');
const Post = require('../models/Post');
const Notification = require('../models/Notification');
const ModerationRequest = require('../models/ModerationRequest');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();
const authorFields = 'fullName profilePicture role';

async function makeNotification(req, recipient, type, post, comment) {
  if (!recipient || String(recipient) === req.user.sub) return;
  const notification = await Notification.create({ recipient, actor: req.user.sub, type, post, comment });
  await notification.populate('actor', authorFields);
  req.app.get('io')?.to(`user:${recipient}`).emit('notification:new', notification);
}

router.post('/:id/replies', requireAuth, async (req, res, next) => {
  try {
    const parent = await Comment.findOne({ _id: req.params.id, deletedAt: null });
    if (!parent) return res.status(404).json({ success: false, message: 'Comment not found.' });
    const content = String(req.body.content || '').trim();
    if (!content) return res.status(400).json({ success: false, message: 'Reply text is required.' });
    const reply = await Comment.create({ post: parent.post, parent: parent._id, author: req.user.sub, content });
    await reply.populate('author', authorFields);
    await makeNotification(req, parent.author, 'reply', parent.post, reply._id);
    req.app.get('io')?.emit('comment:created', { post: parent.post, comment: reply });
    res.status(201).json({ success: true, comment: reply });
  } catch (error) { next(error); }
});

router.post('/:id/like', requireAuth, async (req, res, next) => {
  try {
    const comment = await Comment.findOne({ _id: req.params.id, deletedAt: null });
    if (!comment) return res.status(404).json({ success: false, message: 'Comment not found.' });
    const already = comment.likes.some((id) => String(id) === req.user.sub);
    if (already) comment.likes.pull(req.user.sub); else comment.likes.addToSet(req.user.sub);
    await comment.save();
    if (!already) await makeNotification(req, comment.author, 'comment_like', comment.post, comment._id);
    const result = { commentId: String(comment._id), postId: String(comment.post), liked: !already, likesCount: comment.likes.length };
    req.app.get('io')?.emit('comment:liked', result);
    res.json({ success: true, ...result });
  } catch (error) { next(error); }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const comment = await Comment.findOne({ _id: req.params.id, author: req.user.sub, deletedAt: null });
    if (!comment) return res.status(404).json({ success: false, message: 'Comment not found.' });
    const duplicate = await ModerationRequest.findOne({ kind: 'comment_deletion', post: comment.post, comment: comment._id, requester: req.user.sub, status: 'pending' });
    if (duplicate) return res.status(409).json({ success: false, message: 'A deletion request is already awaiting admin review.' });
    const request = await ModerationRequest.create({ kind: 'comment_deletion', post: comment.post, comment: comment._id, requester: req.user.sub });
    comment.deletionStatus = 'pending';
    await comment.save();
    req.app.get('io')?.emit('moderation:pending', { type: 'comment_deletion', requestId: String(request._id) });
    res.status(202).json({ success: true, message: 'Comment deletion request sent to the administrator for review.' });
  } catch (error) { next(error); }
});

module.exports = router;

