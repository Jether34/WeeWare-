const express = require('express');
const mongoose = require('mongoose');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const User = require('../models/User');
const Notification = require('../models/Notification');
const ModerationRequest = require('../models/ModerationRequest');
const { optionalAuth, requireAuth } = require('../middleware/auth');
const router = express.Router();

const postFields = 'fullName profilePicture role accountStatus';
function io(req, event, payload) { req.app.get('io')?.emit(event, payload); }
async function notify(req, recipient, actor, type, post, comment) {
  if (!recipient || String(recipient) === String(actor)) return;
  const notification = await Notification.create({ recipient, actor, type, post, comment });
  const hydrated = await notification.populate('actor', postFields);
  req.app.get('io')?.to(`user:${recipient}`).emit('notification:new', hydrated);
}
async function findVisiblePost(id) {
  const post = await Post.findOne({ _id: id, deletedAt: null, $or: [{ publishStatus: 'approved' }, { publishStatus: { $exists: false } }] }).populate('author', 'accountStatus');
  return post?.author?.accountStatus === 'deactivated' ? null : post;
}

router.get('/search', optionalAuth, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ success: true, users: [], posts: [], hasMore: { users: false, posts: false } });
    const page = Math.max(0, Math.floor(Number(req.query.page) || 0));
    const limit = Math.min(50, Math.max(1, Math.floor(Number(req.query.limit) || 20)));
    const expression = new RegExp(q.slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const peopleFilter = { fullName: expression };
    if (req.user?.sub) peopleFilter._id = { $ne: req.user.sub };
    const unavailableAuthors = await User.find({ accountStatus: 'deactivated' }).distinct('_id');
    const postFilter = { deletedAt: null, author: { $nin: unavailableAuthors }, $or: [{ publishStatus: 'approved' }, { publishStatus: { $exists: false } }], content: expression };
    const [users, posts] = await Promise.all([
      User.find(peopleFilter).select(postFields).sort({ fullName: 1, _id: 1 }).skip(page * limit).limit(limit + 1),
      Post.find(postFilter).populate('author', postFields).sort({ createdAt: -1, _id: -1 }).skip(page * limit).limit(limit + 1),
    ]);
    const hasMore = { users: users.length > limit, posts: posts.length > limit };
    const resultUsers = users.slice(0, limit);
    const resultPosts = posts.slice(0, limit);
    const postIds = resultPosts.map((post) => post._id);
    const counts = postIds.length ? await Comment.aggregate([{ $match: { post: { $in: postIds }, deletedAt: null } }, { $group: { _id: '$post', count: { $sum: 1 } } }]) : [];
    const countMap = new Map(counts.map((row) => [String(row._id), row.count]));
    res.json({ success: true, users: resultUsers, hasMore, posts: resultPosts.map((post) => ({
      ...post.toObject(),
      likesCount: post.likes.length,
      commentCount: countMap.get(String(post._id)) || 0,
      isLikedByMe: req.user ? post.likes.some((id) => String(id) === req.user.sub) : false,
      isMine: req.user ? String(post.author?._id) === req.user.sub : false,
    })) });
  } catch (error) { next(error); }
});

router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 500)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    if (req.query.userId && !mongoose.isValidObjectId(req.query.userId)) return res.status(400).json({ success: false, message: 'Choose a valid user profile.' });
    const filter = { deletedAt: null, $or: [{ publishStatus: 'approved' }, { publishStatus: { $exists: false } }] };
    const unavailableAuthors = await User.find({ accountStatus: 'deactivated' }).distinct('_id');
    filter.author = { $nin: unavailableAuthors };
    if (req.query.q) filter.content = { $regex: String(req.query.q).slice(0, 80), $options: 'i' };
    let posts;
    if (req.query.userId) {
      if (!(await User.exists({ _id: req.query.userId, accountStatus: { $ne: 'deactivated' } }))) return res.json({ success: true, posts: [] });
      // Use find() here so Mongoose casts the author ID and the profile feed
      // can include the signed-in author's own pending submissions.
      filter.author = req.query.userId;
      const isOwnProfile = req.user && String(req.user.sub) === String(req.query.userId);
      if (isOwnProfile) filter.$or = [{ publishStatus: { $in: ['approved', 'pending'] } }, { publishStatus: { $exists: false } }];
      posts = await Post.find(filter).populate('author', postFields).sort({ createdAt: -1 }).skip(offset).limit(limit);
    } else {
      // Sample from all matching approved posts so each feed load gets a fresh, mixed order.
      const sampled = await Post.aggregate([{ $match: filter }, { $sample: { size: Math.max(1, offset + limit) } }, { $skip: offset }, { $limit: limit }, { $project: { _id: 1 } }]);
      const postById = new Map((await Post.find({ _id: { $in: sampled.map((row) => row._id) } }).populate('author', postFields)).map((post) => [String(post._id), post]));
      posts = sampled.map((row) => postById.get(String(row._id))).filter(Boolean);
    }
    const postIds = posts.map((post) => post._id);
    const counts = await Comment.aggregate([{ $match: { post: { $in: postIds }, deletedAt: null } }, { $group: { _id: '$post', count: { $sum: 1 } } }]);
    const countMap = new Map(counts.map((row) => [String(row._id), row.count]));
    res.json({ success: true, posts: posts.map((post) => ({ ...post.toObject(), likesCount: post.likes.length, commentCount: countMap.get(String(post._id)) || 0, isLikedByMe: req.user ? post.likes.some((id) => String(id) === req.user.sub) : false, isMine: req.user ? String(post.author?._id) === req.user.sub : false })) });
  } catch (error) { next(error); }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const content = String(req.body.content || '').trim();
    const media = Array.isArray(req.body.media) ? req.body.media.slice(0, 8) : [];
    if (!content && !media.length) return res.status(400).json({ success: false, message: 'Write a post or attach media.' });
    const post = await Post.create({ author: req.user.sub, content, media, publishStatus: 'pending' });
    await post.populate('author', postFields);
    io(req, 'moderation:pending', { type: 'post_publication', postId: String(post._id) });
    res.status(201).json({ success: true, post, message: 'Your post was sent to the admin for approval before it appears in the community.' });
  } catch (error) { next(error); }
});

router.get('/:id/comments', optionalAuth, async (req, res, next) => {
  try {
    const post = await findVisiblePost(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
    const comments = await Comment.find({ post: req.params.id }).populate('author', postFields).sort({ createdAt: 1 });
    const nodes = new Map(comments.map((comment) => [String(comment._id), { ...comment.toObject(), content: comment.deletedAt ? 'This comment was deleted.' : comment.content, isDeleted: Boolean(comment.deletedAt), isMine: req.user ? String(comment.author?._id) === req.user.sub : false, canAdminDelete: req.user?.role === 'admin', likesCount: comment.likes.length, isLikedByMe: req.user ? comment.likes.some((id) => String(id) === req.user.sub) : false, replies: [] }]));
    const roots = [];
    const commentsById = new Map(comments.map((comment) => [String(comment._id), comment]));
    for (const comment of comments) {
      const node = nodes.get(String(comment._id));
      const parent = comment.parent ? nodes.get(String(comment.parent)) : null;
      if (parent) {
        node.replyContext = { author: parent.author, content: parent.content, isDeleted: parent.isDeleted };
        let rootComment = comment;
        while (rootComment.parent && commentsById.has(String(rootComment.parent))) rootComment = commentsById.get(String(rootComment.parent));
        nodes.get(String(rootComment._id)).replies.push(node);
      } else roots.push(node);
    }
    res.json({ success: true, comments: roots });
  } catch (error) { next(error); }
});

router.post('/:id/comments', requireAuth, async (req, res, next) => {
  try {
    const post = await findVisiblePost(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
    const content = String(req.body.content || '').trim();
    if (!content) return res.status(400).json({ success: false, message: 'Comment text is required.' });
    const comment = await Comment.create({ post: post._id, author: req.user.sub, content });
    await comment.populate('author', postFields);
    await notify(req, post.author, req.user.sub, 'comment', post._id, comment._id);
    io(req, 'comment:created', { post: post._id, comment });
    res.status(201).json({ success: true, comment });
  } catch (error) { next(error); }
});

router.post('/:id/like', requireAuth, async (req, res, next) => {
  try {
    const post = await findVisiblePost(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
    const already = post.likes.some((id) => String(id) === req.user.sub);
    if (already) post.likes.pull(req.user.sub); else post.likes.addToSet(req.user.sub);
    await post.save();
    if (!already) await notify(req, post.author, req.user.sub, 'like', post._id, null);
    const result = { postId: String(post._id), liked: !already, likesCount: post.likes.length };
    io(req, 'post:liked', result);
    res.json({ success: true, ...result });
  } catch (error) { next(error); }
});

router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const post = await Post.findOne({ _id: req.params.id, author: req.user.sub, deletedAt: null, $or: [{ publishStatus: 'approved' }, { publishStatus: { $exists: false } }] });
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
    if (req.body.content !== undefined) post.content = String(req.body.content).trim();
    if (Array.isArray(req.body.media)) post.media = req.body.media.slice(0, 8);
    await post.save();
    io(req, 'post:updated', post);
    res.json({ success: true, post });
  } catch (error) { next(error); }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const post = await Post.findOne({ _id: req.params.id, author: req.user.sub, deletedAt: null });
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
    const duplicate = await ModerationRequest.findOne({ kind: 'post_deletion', post: post._id, comment: null, requester: req.user.sub, status: 'pending' });
    if (duplicate) return res.status(409).json({ success: false, message: 'A deletion request is already awaiting admin review.' });
    const request = await ModerationRequest.create({ kind: 'post_deletion', post: post._id, requester: req.user.sub });
    io(req, 'moderation:pending', { type: 'post_deletion', requestId: String(request._id) });
    res.status(202).json({ success: true, message: 'Post deletion request sent to the administrator for review.' });
  } catch (error) { next(error); }
});

router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const post = await findVisiblePost(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
    await post.populate('author', postFields);
    res.json({ success: true, post });
  } catch (error) { next(error); }
});

module.exports = router;

