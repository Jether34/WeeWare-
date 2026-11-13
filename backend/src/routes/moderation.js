const express = require('express');
const mongoose = require('mongoose');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const ModerationRequest = require('../models/ModerationRequest');
const Notification = require('../models/Notification');
const { recordDeletedContent } = require('../services/deletedContent');
const { requireAuth, requireRoles } = require('../middleware/auth');

const router = express.Router();
const adminOnly = [requireAuth, requireRoles('admin')];
const userFields = 'fullName profilePicture role';

async function notify(req, recipient, actor, type, post, comment = null) {
  if (!recipient || String(recipient) === String(actor)) return;
  const notification = await Notification.create({ recipient, actor, type, post, comment });
  await notification.populate('actor', userFields);
  req.app.get('io')?.to(`user:${recipient}`).emit('notification:new', notification);
}

async function removePost(req, post) {
  const comments = await Comment.find({ post: post._id, deletedAt: null }).lean();
  await recordDeletedContent([
    { contentType: 'post', sourceId: String(post._id), deletedBy: req.user.sub, reason: 'post_removed', snapshot: post.toObject ? post.toObject() : post },
    ...comments.map((comment) => ({ contentType: 'comment', sourceId: String(comment._id), deletedBy: req.user.sub, reason: 'post_removed', snapshot: comment })),
  ]);
  post.deletedAt = new Date();
  await post.save();
  await Comment.updateMany({ post: post._id, deletedAt: null }, { $set: { deletedAt: new Date() } });
  await ModerationRequest.updateMany({ post: post._id, status: 'pending' }, { $set: { status: 'approved', decidedBy: req.user.sub, decidedAt: new Date() } });
  for (const comment of comments) await notify(req, comment.author, req.user.sub, 'comment_removed', post._id, comment._id);
  req.app.get('io')?.emit('post:deleted', { postId: String(post._id) });
}

router.post('/deletions', requireAuth, async (req, res, next) => {
  try {
    const kind = String(req.body.kind || '');
    const postId = String(req.body.postId || '');
    const commentId = String(req.body.commentId || '');
    if (!mongoose.isValidObjectId(postId) || !['post', 'comment'].includes(kind)) return res.status(400).json({ success: false, message: 'Choose a valid post or comment to request deletion.' });
    const post = await Post.findOne({ _id: postId, deletedAt: null });
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
    let comment = null;
    if (kind === 'post') {
      if (String(post.author) !== req.user.sub) return res.status(403).json({ success: false, message: 'You can request deletion only for your own post.' });
    } else {
      if (!mongoose.isValidObjectId(commentId)) return res.status(400).json({ success: false, message: 'Choose a valid comment.' });
      comment = await Comment.findOne({ _id: commentId, post: post._id, deletedAt: null });
      if (!comment) return res.status(404).json({ success: false, message: 'Comment not found.' });
      if (String(comment.author) !== req.user.sub) return res.status(403).json({ success: false, message: 'You can request deletion only for your own comment.' });
    }
    const requestKind = `${kind}_deletion`;
    const duplicate = await ModerationRequest.findOne({ kind: requestKind, post: post._id, comment: comment?._id || null, requester: req.user.sub, status: 'pending' });
    if (duplicate) return res.status(409).json({ success: false, message: 'A deletion request for this content is already awaiting review.' });
    const request = await ModerationRequest.create({ kind: requestKind, post: post._id, comment: comment?._id || null, requester: req.user.sub });
    if (comment) { comment.deletionStatus = 'pending'; await comment.save(); }
    req.app.get('io')?.emit('moderation:pending', { type: requestKind, requestId: String(request._id) });
    res.status(201).json({ success: true, requestId: request._id, message: 'Deletion request sent to the administrator for review.' });
  } catch (error) { next(error); }
});

router.get('/admin/queue', ...adminOnly, async (_req, res, next) => {
  try {
    const [posts, deletions] = await Promise.all([
      Post.find({ publishStatus: 'pending', deletedAt: null }).populate('author', userFields).sort({ createdAt: 1 }).limit(250),
      ModerationRequest.find({ status: 'pending' }).populate('requester', userFields).populate({ path: 'post', populate: { path: 'author', select: userFields } }).populate({ path: 'comment', populate: { path: 'author', select: userFields } }).sort({ createdAt: 1 }).limit(500),
    ]);
    res.json({ success: true, posts, deletions });
  } catch (error) { next(error); }
});

router.patch('/admin/posts/:id/publication', ...adminOnly, async (req, res, next) => {
  try {
    const status = String(req.body.status || '');
    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ success: false, message: 'Choose approve or reject.' });
    const post = await Post.findOne({ _id: req.params.id, publishStatus: 'pending', deletedAt: null }).populate('author', userFields);
    if (!post) return res.status(404).json({ success: false, message: 'Pending post not found.' });
    post.publishStatus = status;
    await post.save();
    await notify(req, post.author._id, req.user.sub, status === 'approved' ? 'post_approved' : 'post_rejected', post._id);
    if (status === 'approved') {
      const published = await Post.findById(post._id).populate('author', userFields);
      req.app.get('io')?.emit('post:created', published);
    }
    req.app.get('io')?.emit('moderation:resolved', { type: 'post_publication', postId: String(post._id), status });
    res.json({ success: true, status });
  } catch (error) { next(error); }
});

router.patch('/admin/deletions/:id', ...adminOnly, async (req, res, next) => {
  try {
    const status = String(req.body.status || '');
    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ success: false, message: 'Choose approve or reject.' });
    const request = await ModerationRequest.findOne({ _id: req.params.id, status: 'pending' }).populate('post').populate('comment');
    if (!request) return res.status(404).json({ success: false, message: 'Pending deletion request not found.' });
    if (!request.post || request.post.deletedAt || (request.kind === 'comment_deletion' && (!request.comment || request.comment.deletedAt))) return res.status(409).json({ success: false, message: 'The content was already removed. Refresh the moderation queue.' });
    request.status = status;
    request.decidedBy = req.user.sub;
    request.decidedAt = new Date();
    await request.save();
    if (status === 'approved') {
      if (request.kind === 'post_deletion') await removePost(req, request.post);
      else if (request.comment && !request.comment.deletedAt) {
        await recordDeletedContent([{ contentType: 'comment', sourceId: String(request.comment._id), deletedBy: req.user.sub, reason: 'comment_removed', snapshot: request.comment.toObject() }]);
        request.comment.deletedAt = new Date();
        request.comment.deletionStatus = 'approved';
        await request.comment.save();
        req.app.get('io')?.emit('comment:deleted', { post: String(request.post._id), commentId: String(request.comment._id) });
      }
    } else if (request.comment) {
      request.comment.deletionStatus = 'rejected';
      await request.comment.save();
    }
    const isPost = request.kind === 'post_deletion';
    await notify(req, request.requester, req.user.sub, `${isPost ? 'post' : 'comment'}_delete_${status}`, request.post._id, request.comment?._id || null);
    req.app.get('io')?.emit('moderation:resolved', { type: request.kind, requestId: String(request._id), status });
    res.json({ success: true, status });
  } catch (error) { next(error); }
});

router.delete('/admin/content/:kind/:id', ...adminOnly, async (req, res, next) => {
  try {
    const { kind, id } = req.params;
    if (!mongoose.isValidObjectId(id) || !['post', 'comment'].includes(kind)) return res.status(400).json({ success: false, message: 'Choose a valid post or comment.' });
    if (kind === 'post') {
      const post = await Post.findOne({ _id: id, deletedAt: null });
      if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
      await removePost(req, post);
      await notify(req, post.author, req.user.sub, 'post_removed', post._id);
    } else {
      const comment = await Comment.findOne({ _id: id, deletedAt: null });
      if (!comment) return res.status(404).json({ success: false, message: 'Comment not found.' });
      await recordDeletedContent([{ contentType: 'comment', sourceId: String(comment._id), deletedBy: req.user.sub, reason: 'comment_removed', snapshot: comment.toObject() }]);
      comment.deletedAt = new Date();
      await comment.save();
      await ModerationRequest.updateMany({ comment: comment._id, status: 'pending' }, { $set: { status: 'approved', decidedBy: req.user.sub, decidedAt: new Date() } });
      req.app.get('io')?.emit('comment:deleted', { post: String(comment.post), commentId: String(comment._id) });
      await notify(req, comment.author, req.user.sub, 'comment_removed', comment.post, comment._id);
    }
    res.json({ success: true });
  } catch (error) { next(error); }
});

module.exports = router;
